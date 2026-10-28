import copy
import io
import json

from PIL import Image

from studio import thumbnails
from studio.config import REPO_ROOT

from .conftest import png

ID = "t-0000000001"


def case(name: str) -> dict:
    return json.loads((REPO_ROOT / "schema" / "cases" / f"{name}.json").read_text())["document"]


def titled(text: str) -> dict:
    doc = case("valid-new-thumbnail")
    title = next(layer for layer in doc["layers"] if layer["kind"] == "title")
    template = title["words"][0]
    title["text"] = text
    title["words"] = [{**template, "text": w} for w in text.split()]
    return doc


def put(client, doc, base, parent=None, thumbnail_id=ID):
    return client.put(
        f"/api/thumbnails/{thumbnail_id}",
        json={"base_version": base, "parent_version": parent, "document": doc},
    )


def jpeg_bytes(width=640, height=360) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (30, 30, 30)).save(out, "JPEG")
    return out.getvalue()


def test_the_first_save_creates_the_thumbnail_and_each_save_is_a_version(client):
    first = put(client, titled("UNO"), 0)
    assert first.status_code == 201
    assert first.json()["version"] == 1
    second = put(client, titled("UNO DOS"), 1, parent=1)
    assert second.status_code == 200
    assert second.json()["version"] == 2
    got = client.get(f"/api/thumbnails/{ID}").json()
    assert got["version"] == 2
    assert got["title"] == "UNO DOS"
    assert got["document"] == titled("UNO DOS")


def test_a_save_based_on_an_old_version_is_refused_with_the_current_one(client):
    put(client, titled("UNO"), 0)
    put(client, titled("DOS"), 1, parent=1)
    stale = put(client, titled("DESDE OTRA PESTAÑA"), 1, parent=1)
    assert stale.status_code == 409
    assert stale.json()["version"] == 2
    assert client.get(f"/api/thumbnails/{ID}").json()["title"] == "DOS"


def test_a_document_the_frontend_would_reject_is_rejected_here_too(client):
    doc = titled("NADIE LO VIO")
    bad = copy.deepcopy(doc)
    next(la for la in bad["layers"] if la["kind"] == "title")["words"][1]["text"] = "LA"
    response = put(client, bad, 0)
    assert response.status_code == 422
    assert any("exactly the words" in e for e in response.json()["errors"])
    assert client.get(f"/api/thumbnails/{ID}").status_code == 404


def test_numbers_that_json_cannot_carry_are_rejected(client):
    raw = json.dumps({"base_version": 0, "document": titled("HOLA")}, allow_nan=True).replace(
        '"scale": 1', '"scale": NaN', 1
    )
    assert "NaN" in raw
    response = client.put(
        f"/api/thumbnails/{ID}", content=raw, headers={"content-type": "application/json"}
    )
    assert response.status_code == 422


def test_undo_survives_a_reload_by_following_each_version_back_one_step(client):
    """A, B, C saved; undo to B is saved as D (its parent is B's parent, A).
    The history after a reload is A then D's own state, never C."""
    put(client, titled("A"), 0)
    put(client, titled("B"), 1, parent=1)
    put(client, titled("C"), 2, parent=2)
    put(client, titled("B"), 3, parent=1)
    got = client.get(f"/api/thumbnails/{ID}", params={"history": 60}).json()
    assert got["version"] == 4
    assert [h["version"] for h in got["history"]] == [1]
    assert got["history"][0]["document"] == titled("A")


def test_old_versions_beyond_the_undo_depth_are_dropped(client, settings):
    put(client, titled("V"), 0)
    total = thumbnails.KEEP_VERSIONS + 15
    for version in range(1, total):
        put(client, titled(f"V {version}"), version, parent=version)
    got = client.get(f"/api/thumbnails/{ID}", params={"history": 1000}).json()
    assert got["version"] == total
    assert len(got["history"]) == thumbnails.KEEP_VERSIONS - 1
    from studio.db import Database

    with Database(settings.db_path).connection() as conn:
        (count,) = conn.execute("SELECT count(*) FROM thumbnail_versions").fetchone()
    assert count == thumbnails.KEEP_VERSIONS


def test_the_history_lists_the_newest_first_without_the_deleted(client):
    put(client, titled("PRIMERA"), 0, thumbnail_id="t-first-0001")
    put(client, titled("SEGUNDA"), 0, thumbnail_id="t-second-001")
    put(client, titled("PRIMERA OTRA VEZ"), 1, parent=1, thumbnail_id="t-first-0001")
    titles = [t["title"] for t in client.get("/api/thumbnails").json()["thumbnails"]]
    assert titles == ["PRIMERA OTRA VEZ", "SEGUNDA"]
    assert client.delete("/api/thumbnails/t-second-001").status_code == 204
    titles = [t["title"] for t in client.get("/api/thumbnails").json()["thumbnails"]]
    assert titles == ["PRIMERA OTRA VEZ"]
    # Soft: it cannot be saved over or opened, and its versions are kept.
    assert put(client, titled("X"), 1, thumbnail_id="t-second-001").status_code == 404


def test_another_like_this_starts_from_the_same_document_with_nothing_to_undo(client):
    put(client, titled("A"), 0)
    put(client, titled("B"), 1, parent=1)
    copy_ = client.post(f"/api/thumbnails/{ID}/duplicate")
    assert copy_.status_code == 201
    got = client.get(f"/api/thumbnails/{copy_.json()['id']}", params={"history": 60}).json()
    assert got["document"] == titled("B")
    assert got["version"] == 1 and got["history"] == []


def test_the_download_is_stored_and_becomes_the_history_picture(client):
    put(client, titled("A"), 0)
    preview = client.put(
        f"/api/thumbnails/{ID}/preview",
        params={"version": 1},
        files={"file": ("p.jpg", jpeg_bytes(), "image/jpeg")},
    )
    assert preview.status_code == 200
    assert preview.json()["downloaded"] is False
    export = client.put(
        f"/api/thumbnails/{ID}/export",
        params={"version": 1},
        files={"file": ("m.png", png(1280, 720), "image/png")},
    )
    assert export.status_code == 200
    (listed,) = client.get("/api/thumbnails").json()["thumbnails"]
    assert listed["downloaded"] is True
    assert listed["preview_url"] == listed["export_url"]
    served = client.get(listed["export_url"])
    assert served.status_code == 200
    assert "immutable" in served.headers["cache-control"]
    # Editing after the download: it no longer counts as downloaded.
    put(client, titled("A B"), 1, parent=1)
    (listed,) = client.get("/api/thumbnails").json()["thumbnails"]
    assert listed["downloaded"] is False


def test_a_download_that_is_not_a_1280x720_png_is_refused(client):
    put(client, titled("A"), 0)
    for name, data in [("small.png", png(640, 360)), ("photo.jpg", jpeg_bytes(1280, 720))]:
        response = client.put(
            f"/api/thumbnails/{ID}/export",
            params={"version": 1},
            files={"file": (name, data, "image/png")},
        )
        assert response.status_code == 422


def test_a_late_preview_of_an_older_version_does_not_replace_a_newer_one(client, settings):
    put(client, titled("A"), 0)
    put(client, titled("B"), 1, parent=1)

    def preview(version, color):
        out = io.BytesIO()
        Image.new("RGB", (64, 36), color).save(out, "JPEG")
        return client.put(
            f"/api/thumbnails/{ID}/preview",
            params={"version": version},
            files={"file": ("p.jpg", out.getvalue(), "image/jpeg")},
        ).json()["preview_url"]

    newer = preview(2, (255, 0, 0))
    assert preview(1, (0, 0, 255)) == newer
    # Only the preview in use stays on disk.
    newest = preview(2, (0, 255, 0))
    assert client.get(newest).status_code == 200
    assert not (settings.media_dir / newer.removeprefix("/api/files/")).exists()


def test_the_thumbnail_revalidates_and_answers_304_when_nothing_changed(client):
    put(client, titled("A"), 0)
    first = client.get(f"/api/thumbnails/{ID}")
    assert first.headers["cache-control"] == "no-cache"
    again = client.get(f"/api/thumbnails/{ID}", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304
    put(client, titled("B"), 1, parent=1)
    changed = client.get(f"/api/thumbnails/{ID}", headers={"If-None-Match": first.headers["etag"]})
    assert changed.status_code == 200


def test_ids_that_could_be_paths_are_not_thumbnails(client):
    assert put(client, titled("A"), 0, thumbnail_id="..").status_code in (404, 405)
    assert put(client, titled("A"), 0, thumbnail_id="short").status_code == 404
