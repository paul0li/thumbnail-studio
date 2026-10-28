from PIL import Image

from studio.cutout import RembgCutout, build_provider
from studio.images import alpha_box

from .conftest import jpeg, png, upload


def test_the_app_says_when_cutting_out_is_off(client):
    assert client.get("/api/config").json()["cutout"]["available"] is False


def test_asking_for_a_cutout_when_it_is_off_says_so_instead_of_doing_nothing(client):
    photo = upload(client, "person", ("p.jpg", jpeg(), "image/jpeg")).json()["photos"][0]
    response = client.post(f"/api/photos/{photo['id']}/cutout")
    assert response.status_code == 409
    assert response.json()["detail"] == "El recorte automático no está activo en este equipo."


def fake_removal(image: Image.Image) -> Image.Image:
    """Keeps a 20x30 block at (10, 5) and leaves faint noise elsewhere, the way
    a segmentation model does."""
    out = Image.new("RGBA", image.size, (0, 0, 0, 3))
    out.paste(image.crop((10, 5, 30, 35)).convert("RGBA"), (10, 5))
    return out


def test_a_cutout_replaces_what_the_canvas_draws_and_is_trimmed(make_client):
    client = make_client(RembgCutout(remove=fake_removal))
    assert client.get("/api/config").json()["cutout"]["available"] is True
    photo = upload(client, "person", ("p.jpg", jpeg(), "image/jpeg")).json()["photos"][0]
    assert photo["cut_out"] is False

    response = client.post(f"/api/photos/{photo['id']}/cutout")
    assert response.status_code == 200
    cut = response.json()
    assert cut["cut_out"] is True
    assert (cut["width"], cut["height"]) == (20, 30)
    assert cut["url"].endswith(".png")
    assert cut["original_url"] == photo["original_url"]
    assert client.get(cut["url"]).status_code == 200


def test_only_people_can_be_cut_out(make_client):
    client = make_client(RembgCutout(remove=fake_removal))
    photo = upload(client, "logo", ("l.png", png(), "image/png")).json()["photos"][0]
    assert client.post(f"/api/photos/{photo['id']}/cutout").status_code == 422


def test_building_the_rembg_provider_does_not_import_rembg():
    import sys

    provider = build_provider("rembg")
    assert provider.available is True
    assert "rembg" not in sys.modules


def test_the_trim_ignores_near_transparent_pixels():
    image = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    image.paste(Image.new("RGBA", (10, 10), (255, 0, 0, 255)), (45, 45))
    image.putpixel((0, 0), (255, 255, 255, 8))
    image.putpixel((99, 99), (255, 255, 255, 8))
    assert alpha_box(image) == (45, 45, 55, 55)
    # getbbox on alpha > 0 would have taken the whole canvas.
    assert image.getchannel("A").getbbox() == (0, 0, 100, 100)
