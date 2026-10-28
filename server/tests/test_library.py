from pathlib import Path

from PIL import Image

from studio.config import Settings

from .conftest import jpeg, person_with_padding, png, upload


def media_files(settings: Settings) -> list[Path]:
    root = settings.media_dir
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


def test_uploads_several_photos_and_lists_them_by_role(client):
    response = upload(
        client,
        "background",
        ("a.png", png(color=(1, 2, 3, 255)), "image/png"),
        ("b.jpg", jpeg(), "image/jpeg"),
    )
    assert response.status_code == 201
    assert len(response.json()["photos"]) == 2
    upload(client, "logo", ("logo.png", png(color=(9, 9, 9, 255)), "image/png"))

    backgrounds = client.get("/api/photos", params={"role": "background"}).json()["photos"]
    assert {p["role"] for p in backgrounds} == {"background"}
    assert len(backgrounds) == 2
    assert len(client.get("/api/photos").json()["photos"]) == 3


def test_format_is_decided_by_the_content_not_the_name_or_content_type(client, settings):
    response = upload(client, "background", ("photo.gif", jpeg(), "text/plain"))
    assert response.status_code == 201
    url = response.json()["photos"][0]["url"]
    assert url.endswith(".jpg")
    served = client.get(url)
    assert served.headers["content-type"] == "image/jpeg"


def test_text_named_like_an_image_is_rejected_and_leaves_nothing_behind(client, settings):
    response = upload(client, "background", ("x.png", b"not an image at all", "image/png"))
    assert response.status_code == 422
    assert response.json()["errors"][0]["detail"] == "Eso no parece una imagen."
    assert media_files(settings) == []


def test_unsupported_format_is_rejected(client, settings):
    import io

    out = io.BytesIO()
    Image.new("RGB", (8, 8)).save(out, "GIF")
    response = upload(client, "background", ("x.gif", out.getvalue(), "image/gif"))
    assert response.status_code == 422
    assert "Formato no soportado" in response.json()["errors"][0]["detail"]
    assert media_files(settings) == []


def test_a_decompression_bomb_is_rejected_before_decoding(make_client, settings):
    small_limit = Settings(
        _env_file=None,
        data_dir=settings.data_dir,
        web_dist=settings.web_dist,
        max_image_pixels=100 * 100,
    )
    from fastapi.testclient import TestClient

    from studio.app import create_app

    client = TestClient(create_app(small_limit))
    # A few hundred bytes that declare 4000 x 4000 pixels.
    bomb = png(4000, 4000, mode="L", color=(0,))
    assert len(bomb) < 100_000
    response = upload(client, "background", ("bomb.png", bomb, "image/png"))
    assert response.status_code == 422
    assert response.json()["errors"][0]["detail"] == "Esa imagen tiene demasiados píxeles."
    assert media_files(small_limit) == []


def test_a_file_over_the_byte_limit_is_rejected_and_its_temp_file_removed(settings):
    from fastapi.testclient import TestClient

    from studio.app import create_app

    tight = Settings(
        _env_file=None, data_dir=settings.data_dir, web_dist=settings.web_dist, max_upload_bytes=50
    )
    client = TestClient(create_app(tight))
    response = upload(client, "background", ("big.png", png(), "image/png"))
    assert response.status_code == 422
    assert response.json()["errors"][0]["detail"] == "Ese archivo pesa demasiado."
    assert media_files(tight) == []


def test_one_bad_file_does_not_sink_the_rest_of_the_upload(client):
    response = upload(
        client,
        "background",
        ("good.png", png(), "image/png"),
        ("bad.png", b"nope", "image/png"),
    )
    assert response.status_code == 201
    body = response.json()
    assert len(body["photos"]) == 1
    assert body["errors"] == [{"filename": "bad.png", "detail": "Eso no parece una imagen."}]


def test_the_same_picture_uploaded_twice_is_stored_once(client, settings):
    data = png(color=(5, 6, 7, 255))
    first = upload(client, "background", ("a.png", data, "image/png")).json()["photos"][0]
    second = upload(client, "background", ("b.png", data, "image/png")).json()["photos"][0]
    assert first["id"] != second["id"]
    assert first["url"] == second["url"]
    assert len(media_files(settings)) == 1


def test_files_are_stored_by_content_hash(client, settings):
    upload(client, "background", ("../../etc/passwd.png", png(), "image/png"))
    (file,) = media_files(settings)
    relative = file.relative_to(settings.media_dir).as_posix()
    prefix, name = relative.split("/")
    assert len(name.split(".")[0]) == 64 and name.startswith(prefix)


def test_unknown_role_is_rejected(client):
    response = upload(client, "objeto", ("a.png", png(), "image/png"))
    assert response.status_code == 422


def test_deleting_hides_the_photo_but_keeps_its_file(client, settings):
    photo = upload(client, "logo", ("a.png", png(), "image/png")).json()["photos"][0]
    assert client.delete(f"/api/photos/{photo['id']}").status_code == 204
    assert client.get("/api/photos", params={"role": "logo"}).json()["photos"] == []
    assert client.get(f"/api/photos/{photo['id']}").status_code == 404
    assert client.delete(f"/api/photos/{photo['id']}").status_code == 404
    assert len(media_files(settings)) == 1
    # A design that still points at it keeps drawing.
    assert client.get(photo["url"]).status_code == 200


def test_files_whose_url_carries_the_hash_are_cached_forever_and_revalidate(client):
    photo = upload(client, "background", ("a.png", png(), "image/png")).json()["photos"][0]
    served = client.get(photo["url"])
    assert served.status_code == 200
    assert "immutable" in served.headers["cache-control"]
    etag = served.headers["etag"]
    again = client.get(photo["url"], headers={"If-None-Match": etag})
    assert again.status_code == 304


def test_only_files_of_the_library_are_served(client, settings):
    upload(client, "background", ("a.png", png(), "image/png"))
    assert client.get("/api/files/00/" + "0" * 64 + ".png").status_code == 404
    assert client.get("/api/files/..%2F..%2Fstudio.sqlite3/x").status_code == 404


def test_a_person_with_transparency_is_trimmed_to_their_pixels(client):
    photo = upload(client, "person", ("p.png", person_with_padding(), "image/png")).json()[
        "photos"
    ][0]
    # Faint specks in the corners do not count: the box is the person.
    assert (photo["width"], photo["height"]) == (40, 60)
    assert photo["original_url"] != photo["url"]


def test_a_background_keeps_its_own_size(client):
    photo = upload(client, "background", ("p.png", person_with_padding(), "image/png")).json()[
        "photos"
    ][0]
    assert (photo["width"], photo["height"]) == (200, 200)
    assert photo["original_url"] == photo["url"]


def test_unknown_api_paths_are_404_not_the_frontend(client):
    assert client.get("/api/nothing").status_code == 404


def test_the_built_frontend_is_served_from_the_same_origin(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Thumbnail Studio" in response.text


def test_the_page_revalidates_so_a_phone_never_keeps_an_old_version(client):
    assert client.get("/").headers["cache-control"] == "no-cache"
