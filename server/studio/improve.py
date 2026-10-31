"""«Mejorar»: one pass of the image engine over today's scene (ADR 0010).

What goes to the engine is the scene: background, people and the title in its
plain style, drawn by the browser without the frame and the logo. What comes
back is fitted to 1280x720, gets the original faces put back by registration,
is checked (every face restored, nobody added, the title's words exactly as
typed), and only then gets the browser's overlay (frame and logo) pasted on
top. Any failure on the way is the result: there is no fallback, and nothing
is shown as if it were the improvement (ADR 0006).

A run takes a minute or two, so it runs in the background and the browser
asks how it is going. Each run is a row in `improvements`, tied to the
version of the thumbnail it was made from.
"""

from __future__ import annotations

import io
import json
import logging
import secrets
import time
import unicodedata
from collections.abc import Callable
from concurrent.futures import Executor, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, BinaryIO

import cv2
import numpy as np
from PIL import Image, ImageOps

from studio import document, faces, images, storage
from studio.config import Settings
from studio.db import Database
from studio.engine import EngineError, ImageEngine
from studio.library import Conflict, LibraryError, NotFound, now
from studio.readback import ReadbackError, TitleReader

log = logging.getLogger("studio.improve")

WIDTH, HEIGHT = faces.CANVAS
_ID_PREFIX = "imp"

# The instruction, in English for the model. Fixed for now; a later slice has
# Opus write it from what it sees.
PROMPT = """Edit this image into one coherent, cinematic YouTube thumbnail.

The image is a rough collage: real people cut out and placed over a background
illustration, with a title in plain white letters. Turn it into a single
believable scene that makes someone scrolling on a phone want to click.

People:
- Keep exactly the same people. Keep every face recognisable and unchanged:
  same identity, same expression, same glasses and hair. Do not beautify,
  age or restyle faces.
- Where a body is cut off by the edge of a cutout, complete it naturally.
- Unify the lighting on everyone so they belong in the same scene, with a
  strong rim light separating them from the background.
- Add no people and no faces, and do not remove anyone, even someone who is
  only partly visible. Do not duplicate anyone.

Background:
- Keep the background's subject, but darken and simplify it behind the
  people so they stand out. Keep its characters as they are; do not turn any
  of them into a real person.

Title:
- Restyle the title so it stands out, and place it where it reads best
  without covering faces.
- Play with the sizes of its words: make the one or two words that carry the
  story clearly bigger, and keep short words (articles, prepositions,
  conjunctions) small.
- Lettering style, strictly: flat letters in a heavy condensed sans serif,
  with ONE solid colour fill per word (white, yellow or red), a clean solid
  dark outline and a soft drop shadow. No texture, no grain, no gradient
  inside the letters, no metallic, grunge, glow, bevel or 3D extrusion.
- Keep its words exactly, letter by letter, in the same order, including
  accents and Ñ: "{title}".
- Add no other text anywhere: no captions, no logos, no watermarks.

Framing: keep the 16:9 landscape framing of the input.
"""

STAGES = ("engine", "faces", "checks", "frame", "done")


class Failure(Exception):
    def __init__(self, code: str, reason: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.reason = reason
        self.detail = detail


class Running(Conflict):
    def __init__(self) -> None:
        super().__init__("Ya se está mejorando una miniatura. Espera a que termine.")


# --- Pictures -------------------------------------------------------------------


def fit(data: bytes) -> Image.Image:
    """Whatever the engine returns, as 1280x720 RGB: scaled to cover and
    centred, so a slightly different aspect loses a sliver of edge instead of
    gaining bars."""
    with Image.open(io.BytesIO(data)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    return ImageOps.fit(image, (WIDTH, HEIGHT), Image.Resampling.LANCZOS, centering=(0.5, 0.5))


def _bgr(image: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)


def _pil(bgr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))


def _png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def compose(restored: Image.Image, overlay: Image.Image | None) -> Image.Image:
    """The overlay (frame and logo, as the browser drew them) on top. It is
    pasted, never sent to the engine."""
    base = restored.convert("RGBA")
    if overlay is not None:
        base.alpha_composite(overlay.convert("RGBA").resize((WIDTH, HEIGHT)))
    return base.convert("RGB")


def _same_words(read: str, typed: str) -> bool:
    """The title's words, in order, letter by letter. Case is styling (the
    frontend's rule too); accents and Ñ are letters."""
    read = unicodedata.normalize("NFC", read)
    typed = unicodedata.normalize("NFC", typed)
    return document.words_match_text(document.split_words(read), typed)


# --- What the document says -------------------------------------------------


def _media(settings: Settings, src: str) -> Image.Image:
    prefix = "/api/files/"
    relative = src[len(prefix) :] if src.startswith(prefix) else ""
    if not storage.is_relative_path(relative):
        raise Failure("bad_document", "Una foto de la miniatura no se encontró.", src)
    path = settings.media_dir / relative
    if not path.exists():
        raise Failure("bad_document", "Una foto de la miniatura no se encontró.", src)
    with Image.open(path) as image:
        image.load()
        return image.copy()


def placements(settings: Settings, doc: dict) -> list[faces.Placement]:
    """The people, in drawing order, as the canvas places them."""
    found = []
    for layer in doc["layers"]:
        if layer["kind"] != "person":
            continue
        photo = layer["photo"]
        found.append(
            faces.Placement(
                layer_id=layer["id"],
                image=_media(settings, photo["src"]),
                x=float(layer["x"]),
                y=float(layer["y"]),
                scale=float(layer["scale"]),
                width=float(photo["width"]),
                height=float(photo["height"]),
                flip_x=bool(layer.get("flipX")),
            )
        )
    return found


def _who(doc: dict, layer_id: str) -> str:
    for layer in doc["layers"]:
        if layer["id"] == layer_id:
            return "del conductor" if layer.get("slot") == "host" else "de un invitado"
    return "de una persona"


# --- The table ----------------------------------------------------------------


def _new_id() -> str:
    return f"{_ID_PREFIX}{int(time.time() * 1000):012x}{secrets.token_hex(5)}"


def as_json(row) -> dict:
    return {
        "id": row["id"],
        "thumbnail_id": row["thumbnail_id"],
        "version": row["version"],
        "status": row["status"],
        "stage": row["stage"],
        "failure": row["failure"],
        "reason": row["reason"],
        "final_url": f"/api/files/{row['final_path']}" if row["final_path"] else None,
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
        "chosen": row["chosen_at"] is not None,
    }


def get(db: Database, improvement_id: str) -> dict:
    with db.connection() as conn:
        row = conn.execute("SELECT * FROM improvements WHERE id = ?", (improvement_id,)).fetchone()
    if row is None:
        raise NotFound("Esa mejora no existe.")
    return as_json(row)


def latest(conn, thumbnail_id: str) -> dict | None:
    row = conn.execute(
        """SELECT * FROM improvements WHERE thumbnail_id = ?
           ORDER BY created_at DESC, id DESC LIMIT 1""",
        (thumbnail_id,),
    ).fetchone()
    return as_json(row) if row else None


def kept(conn, thumbnail_id: str) -> dict | None:
    """The thumbnail's improved picture: the final picture of its latest run
    that ended well, chosen with «Usar esta» or not. A later run that fails
    does not take it away, and neither does downloading her own."""
    row = conn.execute(
        """SELECT * FROM improvements
           WHERE thumbnail_id = ? AND status = 'ready' AND final_path IS NOT NULL
           ORDER BY created_at DESC, id DESC LIMIT 1""",
        (thumbnail_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "version": row["version"],
        "url": f"/api/files/{row['final_path']}",
        "finished_at": row["finished_at"],
        "chosen": row["chosen_at"] is not None,
    }


def interrupted(db: Database) -> int:
    """Runs left `running` by a server that stopped. They will never finish."""
    with db.transaction() as conn:
        cursor = conn.execute(
            """UPDATE improvements SET status = 'failed', failure = 'interrupted',
                   reason = ?, finished_at = ? WHERE status = 'running'""",
            ("El servidor se reinició mientras se mejoraba la miniatura.", now()),
        )
    return cursor.rowcount


def _update(db: Database, improvement_id: str, **values: Any) -> None:
    columns = ", ".join(f"{k} = ?" for k in values)
    with db.transaction() as conn:
        conn.execute(
            f"UPDATE improvements SET {columns} WHERE id = ?", (*values.values(), improvement_id)
        )


# --- The run --------------------------------------------------------------------


@dataclass
class Pipeline:
    db: Database
    settings: Settings
    engine: ImageEngine
    reader: TitleReader
    detector: faces.Detector | None = None
    # Where runs happen. One at a time: the engine is slow and paid for, and
    # the host makes one thumbnail at a time.
    executor: Executor = field(default_factory=lambda: ThreadPoolExecutor(max_workers=1))
    prompt: Callable[[str], str] = field(default=lambda title: PROMPT.format(title=title))

    def _store(self, data: bytes, image_format: str = "PNG") -> str:
        _, relative = storage.store_bytes(
            data, media_dir=self.settings.media_dir, image_format=image_format
        )
        return relative

    def _picture(self, stream: BinaryIO, *, overlay: bool) -> tuple[str, Image.Image]:
        """An upload from the browser: a 1280x720 PNG, stored by its hash."""
        try:
            temp, sha, _ = storage.spool(
                stream, media_dir=self.settings.media_dir, max_bytes=self.settings.max_upload_bytes
            )
        except storage.TooLarge as exc:
            raise LibraryError("Esa imagen pesa demasiado.") from exc
        try:
            info = images.inspect(temp, self.settings.max_image_pixels)
        except (images.NotAnImage, images.UnsupportedFormat, images.TooManyPixels) as exc:
            temp.unlink(missing_ok=True)
            raise LibraryError("Eso no parece una imagen.") from exc
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
        if (info.format, info.width, info.height) != ("PNG", WIDTH, HEIGHT):
            temp.unlink(missing_ok=True)
            raise LibraryError("La escena tiene que ser un PNG de 1280×720.")
        if overlay and not info.has_alpha:
            temp.unlink(missing_ok=True)
            raise LibraryError("El marco tiene que venir con transparencia.")
        relative = storage.relative_path(sha, info.format)
        path = storage.commit(temp, media_dir=self.settings.media_dir, relative=relative)
        with Image.open(path) as image:
            image.load()
            return relative, image.copy()

    def start(
        self,
        thumbnail_id: str,
        version: int,
        scene: BinaryIO,
        overlay: BinaryIO | None,
    ) -> dict:
        """Records a run for `version` and starts it. The engine not being set
        up is a failure like any other, recorded and shown, not a 500."""
        from studio import thumbnails  # thumbnails reads this module's table

        doc = thumbnails.document_at(self.db, thumbnail_id, version)
        scene_path, _ = self._picture(scene, overlay=False)
        overlay_path = self._picture(overlay, overlay=True)[0] if overlay else None
        improvement_id = _new_id()
        stamp = now()
        with self.db.transaction() as conn:
            busy = conn.execute(
                "SELECT 1 FROM improvements WHERE status = 'running' LIMIT 1"
            ).fetchone()
            if busy:
                raise Running()
            conn.execute(
                """INSERT INTO improvements (id, thumbnail_id, version, status, stage, engine,
                       model, scene_path, overlay_path, created_at)
                   VALUES (?, ?, ?, 'running', 'engine', ?, ?, ?, ?, ?)""",
                (
                    improvement_id,
                    thumbnail_id,
                    version,
                    self.engine.name,
                    getattr(self.engine, "model", None),
                    scene_path,
                    overlay_path,
                    stamp,
                ),
            )
        if not self.engine.configured:
            self._fail(
                improvement_id,
                Failure(
                    "not_configured",
                    "La mejora no está configurada en este equipo: falta la clave del servicio "
                    "de imágenes (OPENAI_API_KEY).",
                ),
                {},
            )
        else:
            self.executor.submit(self._run_logged, improvement_id, doc)
        return get(self.db, improvement_id)

    def _run_logged(self, improvement_id: str, doc: dict) -> None:
        report: dict = {}
        try:
            self.run(improvement_id, doc, report)
        except Failure as failure:
            self._fail(improvement_id, failure, report)
        except Exception as exc:
            log.exception(
                "improvement crashed", exc_info=exc, extra={"improvement": improvement_id}
            )
            self._fail(
                improvement_id,
                Failure("crashed", "Algo salió mal en el servidor mientras se mejoraba."),
                report,
            )

    def _fail(self, improvement_id: str, failure: Failure, report: dict) -> None:
        log.warning(
            "improvement failed",
            extra={"improvement": improvement_id, "failure": failure.code, "why": failure.detail},
        )
        report["failure"] = {"code": failure.code, "detail": failure.detail}
        _update(
            self.db,
            improvement_id,
            status="failed",
            failure=failure.code,
            reason=failure.reason,
            report=json.dumps(report, ensure_ascii=False),
            finished_at=now(),
        )

    def run(self, improvement_id: str, doc: dict, report: dict) -> None:
        with self.db.connection() as conn:
            row = conn.execute(
                "SELECT * FROM improvements WHERE id = ?", (improvement_id,)
            ).fetchone()
        with Image.open(self.settings.media_dir / row["scene_path"]) as image:
            scene_image = image.convert("RGB")
        overlay = None
        if row["overlay_path"]:
            with Image.open(self.settings.media_dir / row["overlay_path"]) as image:
                overlay = image.convert("RGBA")
        scene_png = (self.settings.media_dir / row["scene_path"]).read_bytes()
        title = document.title_text(doc)

        # Where the faces are, from the layers, before spending anything.
        people = placements(self.settings, doc)
        found = faces.faces_in_layers(people, self.detector)
        report["faces"] = [f.as_json() for f in found]

        try:
            result = self.engine.edit(scene_png, self.prompt(title))
        except EngineError as exc:
            raise Failure(exc.code, exc.reason, exc.detail) from None
        report["engine"] = result.info
        try:
            fitted = fit(result.data)
        except (OSError, ValueError, Image.DecompressionBombError) as exc:
            raise Failure(
                "bad_response",
                "El servicio de imágenes devolvió algo que no es una imagen.",
                str(exc),
            ) from None
        raw, raw_format = _as_stored(result.data)
        _update(self.db, improvement_id, raw_path=self._store(raw, raw_format), stage="faces")

        scene_bgr = _bgr(scene_image)
        try:
            restored = faces.restore(scene_bgr, _bgr(fitted), found, people)
        except faces.FaceNotRestored as exc:
            report["unrestored"] = {**exc.face.as_json(), "why": exc.reason}
            raise Failure(
                "face_not_restored",
                f"La IA cambió demasiado la cara {_who(doc, exc.face.layer_id)} y no se pudo "
                "devolver la original.",
                exc.reason,
            ) from None
        report["restored"] = [r.as_json() for r in restored.registrations]
        extra = faces.extra_faces(
            scene_bgr, restored.image, found, restored.registrations, self.detector
        )
        report["extra_faces"] = [e.as_json() for e in extra]
        restored_image = _pil(restored.image)
        restored_png = _png(restored_image)
        _update(self.db, improvement_id, restored_path=self._store(restored_png), stage="checks")
        if extra:
            raise Failure(
                "added_person",
                "La IA agregó una persona que no estaba en la miniatura.",
                f"{len(extra)} faces",
            )

        try:
            reading = self.reader.read(scene_png, restored_png)
        except ReadbackError as exc:
            raise Failure(f"readback_{exc.code}", exc.reason, exc.detail) from None
        report["reading"] = reading.as_json()
        if reading.added_people:
            raise Failure(
                "added_person",
                "La IA agregó una persona que no estaba en la miniatura.",
                reading.notes,
            )
        if not _same_words(reading.title, title):
            shown = " ".join(reading.title.split())
            raise Failure(
                "title_changed",
                f"La IA cambió el título: en la imagen se lee «{shown}»."
                if shown
                else "La IA quitó el título de la imagen.",
                reading.notes,
            )

        _update(self.db, improvement_id, stage="frame")
        final_path = self._store(_png(compose(restored_image, overlay)))
        _update(
            self.db,
            improvement_id,
            final_path=final_path,
            status="ready",
            stage="done",
            report=json.dumps(report, ensure_ascii=False, default=str),
            finished_at=now(),
        )


def _as_stored(data: bytes) -> tuple[bytes, str]:
    """The engine's bytes as they came, if they are a format the media store
    serves; otherwise the same picture as PNG."""
    with Image.open(io.BytesIO(data)) as image:
        if image.format in storage.EXTENSIONS:
            return data, image.format
        return _png(image), "PNG"
