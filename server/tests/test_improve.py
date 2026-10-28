"""«Mejorar» end to end through the API, with a fake engine, a fake reader and
a fake face detector: there are no real faces in the repository and no real
engine calls in tests."""

import io
import json
from concurrent.futures import Future

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from studio import faces
from studio.app import create_app
from studio.engine import EngineError, EngineResult
from studio.readback import ReadbackError, Reading

from .conftest import texture, upload
from .test_thumbnails import case, put

ID = "t-improve-001"
TITLE = "EL AÑO QUE NADIE VIO"
# The person's cutout, and where the fake detector says their face is in it.
CUTOUT = (300, 400)
FACE_IN_CUTOUT = faces.Box(90, 60, 210, 200)
# Where the document places them.
PLACE = {"x": 900.0, "y": 420.0, "scale": 1.0}


class Inline:
    """Runs a background job at once, so a test reads its outcome next."""

    def submit(self, fn, *args):
        future: Future = Future()
        future.set_result(fn(*args))
        return future


def cutout_png() -> bytes:
    person = texture(CUTOUT, seed=1).convert("RGBA")
    out = io.BytesIO()
    person.save(out, "PNG")
    return out.getvalue()


def scene_with(person: Image.Image) -> Image.Image:
    scene = texture((1280, 720), seed=2)
    x = round(PLACE["x"] - CUTOUT[0] / 2)
    y = round(PLACE["y"] - CUTOUT[1] / 2)
    scene.paste(person.convert("RGB"), (x, y))
    return scene


def png_bytes(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def overlay_png() -> bytes:
    """A frame: an opaque band at the bottom, transparent elsewhere."""
    frame = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rectangle((0, 660, 1280, 720), fill=(233, 40, 39, 255))
    return png_bytes(frame)


def moved(scene_png: bytes, dx=30, dy=-12, scale=1.06, size=(1536, 864)) -> bytes:
    """What an engine does: reframe a little, change the light, return
    another size."""
    with Image.open(io.BytesIO(scene_png)) as image:
        scene = image.convert("RGB")
    w, h = scene.size
    bigger = scene.resize((round(w * scale), round(h * scale)), Image.Resampling.BICUBIC)
    canvas = Image.new("RGB", (w, h))
    canvas.paste(bigger, (round(dx - (bigger.width - w) / 2), round(dy - (bigger.height - h) / 2)))
    lighter = Image.eval(canvas, lambda v: min(255, int(v * 0.85 + 30)))
    return png_bytes(lighter.resize(size, Image.Resampling.BICUBIC))


class FakeEngine:
    name = "fake"
    model = "fake-model"

    def __init__(self, respond=None, configured=True):
        self.respond = respond or (lambda scene: EngineResult(moved(scene), {"engine": "fake"}))
        self._configured = configured
        self.calls: list[str] = []

    @property
    def configured(self):
        return self._configured

    def edit(self, scene_png, prompt):
        self.calls.append(prompt)
        return self.respond(scene_png)


class FakeReader:
    def __init__(self, title=TITLE, added=False, error=None):
        self.title, self.added, self.error = title, added, error
        self.seen: list[tuple[bytes, bytes]] = []

    def read(self, scene_png, result_png):
        self.seen.append((scene_png, result_png))
        if self.error:
            raise self.error
        return Reading(self.title, self.added, "fake")


class FakeDetector:
    """The cutout's face where FACE_IN_CUTOUT says; on 1280x720 pictures,
    whatever the test puts in `extra` (in the result only)."""

    def __init__(self):
        self.extra: list[faces.Detection] = []
        self.pictures = 0

    def __call__(self, bgr, min_score):
        h, w = bgr.shape[:2]
        if (w, h) == CUTOUT:
            return [faces.Detection(FACE_IN_CUTOUT, 0.95)]
        self.pictures += 1
        # The scene is looked at first, then the result.
        return [d for d in self.extra if d.score >= min_score] if self.pictures > 1 else []


@pytest.fixture
def setup(settings):
    def build(engine=None, reader=None, detector=None):
        engine = engine or FakeEngine()
        reader = reader or FakeReader()
        detector = detector or FakeDetector()
        client = TestClient(
            create_app(settings, engine=engine, reader=reader, detector=detector, executor=Inline())
        )
        photo = upload(client, "host", ("host.png", cutout_png(), "image/png")).json()["photos"][0]
        doc = case("valid-new-thumbnail")
        title = next(layer for layer in doc["layers"] if layer["kind"] == "title")
        title["text"] = TITLE
        title["words"] = [{**title["words"][0], "text": w} for w in TITLE.split()]
        doc["layers"].insert(
            1,
            {
                "id": "person-host",
                "kind": "person",
                "slot": "host",
                "photo": {
                    "photoId": photo["id"],
                    "src": photo["url"],
                    "width": photo["width"],
                    "height": photo["height"],
                },
                **PLACE,
                "flipX": False,
                "effects": [],
            },
        )
        assert put(client, doc, 0, thumbnail_id=ID).status_code == 201
        with Image.open(io.BytesIO(cutout_png())) as person:
            scene = png_bytes(scene_with(person))
        return client, engine, reader, detector, scene

    return build


def start(client, scene, overlay=True, version=1):
    files = {"scene": ("scene.png", scene, "image/png")}
    if overlay:
        files["overlay"] = ("overlay.png", overlay_png(), "image/png")
    return client.post(f"/api/thumbnails/{ID}/improvements?version={version}", files=files)


def picture(client, url) -> Image.Image:
    response = client.get(url)
    assert response.status_code == 200
    return Image.open(io.BytesIO(response.content))


def test_an_improvement_restores_the_face_checks_and_puts_the_frame_on_top(setup, settings):
    client, engine, reader, _, scene = setup()
    started = start(client, scene)
    assert started.status_code == 202
    improvement = client.get(f"/api/improvements/{started.json()['id']}").json()
    assert improvement["status"] == "ready", improvement
    assert improvement["version"] == 1

    # The prompt asks for the title's exact words; the reader saw the scene
    # that was sent and the restored result, never the frame.
    assert f'"{TITLE}"' in engine.calls[0]
    sent, read = reader.seen[0]
    assert sent == scene
    with Image.open(io.BytesIO(read)) as restored:
        assert restored.size == (1280, 720)
        assert restored.getpixel((640, 700))[:3] != (233, 40, 39)

    final = picture(client, improvement["final_url"])
    assert final.size == (1280, 720)
    assert final.convert("RGB").getpixel((640, 700)) == (233, 40, 39)

    row = sqlite_row(settings, improvement["id"])
    assert row["raw_path"] and row["restored_path"] and row["final_path"]
    report = json.loads(row["report"])
    # The face was found where the engine moved and scaled it.
    (restored,) = report["restored"]
    assert restored["scale"] == pytest.approx(1.06, abs=0.02)
    assert restored["in_result"] != restored["box"]


def sqlite_row(settings, improvement_id):
    import sqlite3

    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute("SELECT * FROM improvements WHERE id = ?", (improvement_id,)).fetchone()
    finally:
        conn.close()


def test_using_the_improvement_makes_it_the_download_and_the_history_picture(setup):
    client, _, _, _, scene = setup()
    improvement = start(client, scene).json()
    ready = client.get(f"/api/improvements/{improvement['id']}").json()
    used = client.post(f"/api/improvements/{improvement['id']}/use")
    assert used.status_code == 200
    summary = used.json()
    assert summary["export_url"] == ready["final_url"]
    assert summary["preview_url"] == ready["final_url"]
    assert summary["downloaded"] is True
    assert summary["export_improved"] is True
    state = client.get(f"/api/thumbnails/{ID}").json()
    assert state["improvement"]["chosen"] is True

    # Downloading her own afterwards replaces it.
    own = png_bytes(Image.new("RGB", (1280, 720), (10, 10, 10)))
    client.put(
        f"/api/thumbnails/{ID}/export?version=1", files={"file": ("m.png", own, "image/png")}
    )
    assert client.get(f"/api/thumbnails/{ID}").json()["export_improved"] is False


def test_an_improvement_of_an_older_version_cannot_be_used(setup):
    client, _, _, _, scene = setup()
    improvement = start(client, scene).json()
    doc = client.get(f"/api/thumbnails/{ID}").json()["document"]
    doc["layers"][1]["x"] = 800
    put(client, doc, 1, parent=1, thumbnail_id=ID)
    refused = client.post(f"/api/improvements/{improvement['id']}/use")
    assert refused.status_code == 409
    assert "cambió" in refused.json()["detail"]


def failed(client, scene, **kwargs) -> dict:
    started = start(client, scene, **kwargs)
    assert started.status_code == 202, started.text
    improvement = client.get(f"/api/improvements/{started.json()['id']}").json()
    assert improvement["status"] == "failed", improvement
    assert improvement["final_url"] is None
    return improvement


def test_without_a_key_the_improvement_fails_and_says_why(setup):
    engine = FakeEngine(configured=False)
    client, *_, scene = setup(engine=engine)
    improvement = failed(client, scene)
    assert improvement["failure"] == "not_configured"
    assert "OPENAI_API_KEY" in improvement["reason"]
    assert engine.calls == []
    # Her own thumbnail is untouched and can still be downloaded.
    assert client.get(f"/api/thumbnails/{ID}").json()["export_url"] is None


def test_an_engine_error_is_the_result_shown(setup):
    def broken(_):
        raise EngineError("network", "No se pudo conectar con el servicio de imágenes.")

    client, *_, scene = setup(engine=FakeEngine(respond=broken))
    improvement = failed(client, scene)
    assert improvement["failure"] == "network"
    assert improvement["reason"] == "No se pudo conectar con el servicio de imágenes."


def test_an_engine_answer_that_is_not_an_image_fails(setup):
    client, *_, scene = setup(engine=FakeEngine(respond=lambda _: EngineResult(b"nope", {})))
    assert failed(client, scene)["failure"] == "bad_response"


def test_a_face_the_engine_replaced_cannot_be_restored_and_rejects_the_result(setup):
    other = png_bytes(texture((1536, 864), seed=99))
    client, _, reader, _, scene = setup(engine=FakeEngine(respond=lambda _: EngineResult(other)))
    improvement = failed(client, scene)
    assert improvement["failure"] == "face_not_restored"
    assert "conductor" in improvement["reason"]
    assert reader.seen == []


def test_an_added_face_rejects_the_result(setup):
    detector = FakeDetector()
    detector.extra = [faces.Detection(faces.Box(100, 200, 230, 380), 0.93)]
    client, _, reader, _, scene = setup(detector=detector)
    improvement = failed(client, scene)
    assert improvement["failure"] == "added_person"
    assert reader.seen == []


def test_a_small_face_in_the_background_is_not_a_new_person(setup):
    detector = FakeDetector()
    detector.extra = [faces.Detection(faces.Box(100, 200, 140, 250), 0.93)]
    client, *_, scene = setup(detector=detector)
    started = start(client, scene).json()
    assert client.get(f"/api/improvements/{started['id']}").json()["status"] == "ready"


def test_the_reader_seeing_an_added_person_rejects_the_result(setup):
    client, *_, scene = setup(reader=FakeReader(added=True))
    assert failed(client, scene)["failure"] == "added_person"


def test_a_changed_title_rejects_the_result_and_says_what_it_reads(setup):
    client, *_, scene = setup(reader=FakeReader(title="EL ANO QUE NADIE VIO"))
    improvement = failed(client, scene)
    assert improvement["failure"] == "title_changed"
    assert "«EL ANO QUE NADIE VIO»" in improvement["reason"]


def test_the_title_check_ignores_case_and_line_breaks_but_not_letters(setup):
    client, *_, scene = setup(reader=FakeReader(title="El año que\nnadie vio"))
    started = start(client, scene).json()
    assert client.get(f"/api/improvements/{started['id']}").json()["status"] == "ready"


def test_a_reader_that_cannot_run_fails_the_improvement(setup):
    error = ReadbackError("missing", "No está instalado Claude Code en el servidor.")
    client, *_, scene = setup(reader=FakeReader(error=error))
    improvement = failed(client, scene)
    assert improvement["failure"] == "readback_missing"
    assert "Claude Code" in improvement["reason"]


def test_the_scene_must_be_a_1280x720_png(setup):
    client, *_ = setup()
    small = png_bytes(Image.new("RGB", (640, 360)))
    assert start(client, small).status_code == 422


def test_an_unknown_thumbnail_or_version_is_refused(setup):
    client, *_, scene = setup()
    assert start(client, scene, version=7).status_code == 422
    missing = client.post(
        "/api/thumbnails/t-nothing-here/improvements?version=1",
        files={"scene": ("s.png", scene, "image/png")},
    )
    assert missing.status_code == 404


def test_a_run_left_running_by_a_stopped_server_is_marked_failed(setup, settings):
    class Never:
        def submit(self, fn, *args):
            return Future()

    client, *_, scene = setup()
    # Rebuild the app with a runner that never runs: the run stays `running`.
    stuck = TestClient(
        create_app(settings, engine=FakeEngine(), reader=FakeReader(), executor=Never())
    )
    improvement = start(stuck, scene).json()
    assert improvement["status"] == "running"
    # A second one is refused while the first runs.
    assert start(stuck, scene).status_code == 409
    restarted = TestClient(create_app(settings, engine=FakeEngine(), reader=FakeReader()))
    after = restarted.get(f"/api/improvements/{improvement['id']}").json()
    assert after["status"] == "failed"
    assert after["failure"] == "interrupted"


def test_the_pictures_of_a_run_are_served(setup, settings):
    client, *_, scene = setup()
    improvement = start(client, scene).json()
    row = sqlite_row(settings, improvement["id"])
    for column in ("scene_path", "overlay_path", "raw_path", "restored_path", "final_path"):
        assert client.get(f"/api/files/{row[column]}").status_code == 200


def test_a_title_that_disappeared_is_said_plainly(setup):
    client, *_, scene = setup(reader=FakeReader(title=""))
    improvement = failed(client, scene)
    assert improvement["reason"] == "La IA quitó el título de la imagen."
