"""Saved thumbnails: the design document with its versions, a preview for the
history, the PNG of the last download (ADR 0009) and the improved picture, if
«Mejorar» made one (ADR 0011).

A save names the version it was based on. If the thumbnail has moved on since
(another tab, another device), the save is refused with the current version,
so a stale tab can never overwrite a newer thumbnail without being told.
"""

import json
import math
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any, BinaryIO

from studio import document, images, improve, storage
from studio.config import Settings
from studio.db import Database
from studio.library import Conflict, LibraryError, NotFound, now

# How many undo steps survive a reload. Older versions, and versions that are
# no longer on the head's undo path, are dropped on every save.
KEEP_VERSIONS = 60
MAX_DOCUMENT_BYTES = 256 * 1024
RECENT = 30
_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class Invalid(LibraryError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("Esa miniatura no es válida.")
        self.errors = errors

    def body(self) -> dict:
        return {"detail": self.message, "errors": self.errors}


class Stale(Conflict):
    """The thumbnail changed since the version the save was based on."""

    def __init__(self, version: int, updated_at: str) -> None:
        super().__init__("Esta miniatura cambió en otro lugar.")
        self.version = version
        self.updated_at = updated_at

    def body(self) -> dict:
        return {"detail": self.message, "version": self.version, "updated_at": self.updated_at}


@dataclass(frozen=True)
class Saved:
    id: str
    version: int
    updated_at: str
    created: bool


def new_id() -> str:
    return f"{int(time.time() * 1000):012x}{secrets.token_hex(5)}"


def check_id(thumbnail_id: str) -> None:
    if not _ID.match(thumbnail_id):
        raise NotFound("Esa miniatura no existe.")


def _finite(value: Any) -> bool:
    """JSON from Python's parser may carry NaN or Infinity, which a schema's
    number checks let through."""
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(_finite(v) for v in value.values())
    if isinstance(value, list):
        return all(_finite(v) for v in value)
    return True


def _encode(doc: Any) -> str:
    if not _finite(doc):
        raise Invalid(["document: numbers must be finite"])
    errors = document.validate(doc)
    if errors:
        raise Invalid(errors)
    encoded = json.dumps(doc, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode()) > MAX_DOCUMENT_BYTES:
        raise Invalid(["document: too large"])
    return encoded


def _compact(conn, thumbnail_id: str, head: int) -> None:
    """Keeps the head's undo path, KEEP_VERSIONS deep, and nothing else."""
    conn.execute(
        """WITH RECURSIVE path(version, depth) AS (
               SELECT ?, 1
               UNION ALL
               SELECT v.parent, path.depth + 1
               FROM thumbnail_versions v JOIN path ON v.version = path.version
               WHERE v.thumbnail_id = ? AND v.parent IS NOT NULL AND path.depth < ?
           )
           DELETE FROM thumbnail_versions
           WHERE thumbnail_id = ? AND version NOT IN (SELECT version FROM path)""",
        (head, thumbnail_id, KEEP_VERSIONS, thumbnail_id),
    )


def save(db: Database, thumbnail_id: str, base_version: int, parent: int | None, doc: Any) -> Saved:
    """Stores `doc` as the next version. `base_version` 0 creates the thumbnail
    (with an id the client chose, so a save made offline can be replayed)."""
    check_id(thumbnail_id)
    encoded = _encode(doc)
    title = document.title_text(doc)
    stamp = now()
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT version, updated_at, deleted_at FROM thumbnails WHERE id = ?",
            (thumbnail_id,),
        ).fetchone()
        if row is None:
            if base_version != 0:
                raise NotFound("Esa miniatura ya no existe.")
            conn.execute(
                """INSERT INTO thumbnails (id, version, title, created_at, updated_at)
                   VALUES (?, 1, ?, ?, ?)""",
                (thumbnail_id, title, stamp, stamp),
            )
            conn.execute(
                """INSERT INTO thumbnail_versions (thumbnail_id, version, parent, document,
                       created_at) VALUES (?, 1, NULL, ?, ?)""",
                (thumbnail_id, encoded, stamp),
            )
            return Saved(thumbnail_id, 1, stamp, created=True)
        if row["deleted_at"] is not None:
            raise NotFound("Esa miniatura se borró.")
        if row["version"] != base_version:
            raise Stale(row["version"], row["updated_at"])
        if parent is not None:
            known = conn.execute(
                "SELECT 1 FROM thumbnail_versions WHERE thumbnail_id = ? AND version = ?",
                (thumbnail_id, parent),
            ).fetchone()
            # A parent that was compacted away just ends the undo path there.
            parent = parent if known else None
        version = base_version + 1
        conn.execute(
            """INSERT INTO thumbnail_versions (thumbnail_id, version, parent, document, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (thumbnail_id, version, parent, encoded, stamp),
        )
        conn.execute(
            "UPDATE thumbnails SET version = ?, title = ?, updated_at = ? WHERE id = ?",
            (version, title, stamp, thumbnail_id),
        )
        _compact(conn, thumbnail_id, version)
    return Saved(thumbnail_id, version, stamp, created=False)


def _summary(conn, row) -> dict:
    preview = row["preview_path"]
    preview_version = row["preview_version"] or 0
    # The download is the best picture of the thumbnail, unless it was edited
    # after: then the newer preview is.
    if row["export_path"] and (row["export_version"] or 0) >= preview_version:
        preview = row["export_path"]
    return {
        "id": row["id"],
        "version": row["version"],
        "title": row["title"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "preview_url": f"/api/files/{preview}" if preview else None,
        "downloaded": row["export_version"] == row["version"],
        "export_url": f"/api/files/{row['export_path']}" if row["export_path"] else None,
        "exported_at": row["exported_at"],
        # The download is the improved picture («Usar esta»), not her render.
        "export_improved": row["export_improvement"] is not None,
        # The improved picture stays with the thumbnail, used or not; the
        # history shows it rather than her render (ADR 0011).
        "improved": improve.kept(conn, row["id"]),
    }


def _row(conn, thumbnail_id: str):
    check_id(thumbnail_id)
    row = conn.execute(
        "SELECT * FROM thumbnails WHERE id = ? AND deleted_at IS NULL", (thumbnail_id,)
    ).fetchone()
    if row is None:
        raise NotFound("Esa miniatura no existe.")
    return row


def document_at(db: Database, thumbnail_id: str, version: int) -> dict:
    """The document as it was saved in `version`, if that version is still kept."""
    with db.connection() as conn:
        _row(conn, thumbnail_id)
        found = conn.execute(
            "SELECT document FROM thumbnail_versions WHERE thumbnail_id = ? AND version = ?",
            (thumbnail_id, version),
        ).fetchone()
    if found is None:
        raise LibraryError("Esa versión de la miniatura no existe.")
    return json.loads(found["document"])


def head_version(db: Database, thumbnail_id: str) -> int:
    with db.connection() as conn:
        return _row(conn, thumbnail_id)["version"]


def get(db: Database, thumbnail_id: str, history: int = 0) -> dict:
    """The head document, and up to `history` versions of its undo path
    (oldest first, not including the head)."""
    history = max(0, min(history, KEEP_VERSIONS))
    with db.connection() as conn:
        row = _row(conn, thumbnail_id)
        path = conn.execute(
            """WITH RECURSIVE path(version, parent, document, depth) AS (
                   SELECT version, parent, document, 0 FROM thumbnail_versions
                   WHERE thumbnail_id = ?1 AND version = ?2
                   UNION ALL
                   SELECT v.version, v.parent, v.document, path.depth + 1
                   FROM thumbnail_versions v JOIN path ON v.version = path.parent
                   WHERE v.thumbnail_id = ?1 AND path.depth < ?3
               )
               SELECT version, document FROM path ORDER BY depth DESC""",
            (thumbnail_id, row["version"], history),
        ).fetchall()
        last_improvement = improve.latest(conn, thumbnail_id)
        summary = _summary(conn, row)
    head = path[-1]
    return {
        **summary,
        "improvement": last_improvement,
        "document": json.loads(head["document"]),
        "history": [
            {"version": r["version"], "document": json.loads(r["document"])} for r in path[:-1]
        ],
    }


def recent(db: Database, limit: int = RECENT) -> list[dict]:
    with db.connection() as conn:
        rows = conn.execute(
            """SELECT * FROM thumbnails WHERE deleted_at IS NULL
               ORDER BY updated_at DESC, id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [_summary(conn, r) for r in rows]


def duplicate(db: Database, thumbnail_id: str) -> Saved:
    """«Hacer otra como esta»: a new thumbnail starting from this one's head,
    with nothing to undo."""
    with db.connection() as conn:
        row = _row(conn, thumbnail_id)
        doc = conn.execute(
            "SELECT document FROM thumbnail_versions WHERE thumbnail_id = ? AND version = ?",
            (thumbnail_id, row["version"]),
        ).fetchone()["document"]
    return save(db, new_id(), 0, None, json.loads(doc))


def delete(db: Database, thumbnail_id: str) -> None:
    """Soft delete: hidden from the history, every version kept."""
    check_id(thumbnail_id)
    with db.transaction() as conn:
        cursor = conn.execute(
            "UPDATE thumbnails SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
            (now(), thumbnail_id),
        )
    if cursor.rowcount == 0:
        raise NotFound("Esa miniatura no existe.")


def _referenced(conn, relative: str) -> bool:
    return (
        conn.execute(
            """SELECT 1 FROM photos WHERE path = ?1 OR display_path = ?1
               UNION ALL
               SELECT 1 FROM thumbnails WHERE preview_path = ?1 OR export_path = ?1
               UNION ALL
               SELECT 1 FROM improvements WHERE scene_path = ?1 OR overlay_path = ?1
                   OR raw_path = ?1 OR restored_path = ?1 OR final_path = ?1
               LIMIT 1""",
            (relative,),
        ).fetchone()
        is not None
    )


def is_served(db: Database, relative: str) -> bool:
    with db.connection() as conn:
        return _referenced(conn, relative)


def attach_picture(
    db: Database,
    settings: Settings,
    thumbnail_id: str,
    kind: str,
    version: int,
    stream: BinaryIO,
) -> dict:
    """Stores the browser's render of `version`: a `preview` for the history,
    or the `export` the host just downloaded (a 1280x720 PNG)."""
    check_id(thumbnail_id)
    head_version(db, thumbnail_id)  # 404 before reading the upload
    try:
        temp, sha, _ = storage.spool(
            stream, media_dir=settings.media_dir, max_bytes=settings.max_upload_bytes
        )
    except storage.TooLarge as exc:
        raise LibraryError("Esa imagen pesa demasiado.") from exc
    try:
        info = images.inspect(temp, settings.max_image_pixels)
    except (images.NotAnImage, images.UnsupportedFormat, images.TooManyPixels) as exc:
        temp.unlink(missing_ok=True)
        raise LibraryError("Eso no parece una imagen.") from exc
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    if kind == "export" and (info.format, info.width, info.height) != ("PNG", 1280, 720):
        temp.unlink(missing_ok=True)
        raise LibraryError("La imagen descargada tiene que ser un PNG de 1280×720.")
    if kind == "preview" and (info.width > 1280 or info.height > 720):
        temp.unlink(missing_ok=True)
        raise LibraryError("La vista previa es demasiado grande.")
    relative = storage.relative_path(sha, info.format)
    storage.commit(temp, media_dir=settings.media_dir, relative=relative)

    replaced = None
    with db.transaction() as conn:
        row = _row(conn, thumbnail_id)
        if not 1 <= version <= row["version"]:
            raise LibraryError("Esa versión de la miniatura no existe.")
        if kind == "export":
            conn.execute(
                """UPDATE thumbnails SET export_path = ?, export_version = ?, exported_at = ?,
                       export_improvement = NULL WHERE id = ?""",
                (relative, version, now(), thumbnail_id),
            )
        elif version >= (row["preview_version"] or 0):
            # A preview of an older version arriving late never replaces a newer one.
            replaced = row["preview_path"]
            conn.execute(
                "UPDATE thumbnails SET preview_path = ?, preview_version = ? WHERE id = ?",
                (relative, version, thumbnail_id),
            )
        else:
            replaced = relative
        # After the update: whatever still points at the file keeps it.
        stale = replaced if replaced and not _referenced(conn, replaced) else None
    # Previews are a cache of what the browser drew; one per thumbnail is kept.
    # Photos and downloads are never removed.
    if stale:
        (settings.media_dir / stale).unlink(missing_ok=True)
    with db.connection() as conn:
        return _summary(conn, _row(conn, thumbnail_id))


def use_improvement(db: Database, improvement_id: str) -> dict:
    """«Usar esta»: the improvement's final picture becomes the thumbnail's
    download and its picture in the history. Only for the version on screen:
    after an edit, the improvement shows something that is no longer there."""
    with db.transaction() as conn:
        found = conn.execute(
            "SELECT * FROM improvements WHERE id = ?", (improvement_id,)
        ).fetchone()
        if found is None:
            raise NotFound("Esa mejora no existe.")
        row = _row(conn, found["thumbnail_id"])
        if found["status"] != "ready":
            raise Conflict("Esa mejora no terminó bien.")
        if found["version"] != row["version"]:
            raise Conflict("La miniatura cambió después de mejorarla. Vuelve a mejorarla.")
        stamp = now()
        conn.execute(
            """UPDATE thumbnails SET export_path = ?, export_version = ?, exported_at = ?,
                   export_improvement = ? WHERE id = ?""",
            (found["final_path"], found["version"], stamp, improvement_id, row["id"]),
        )
        conn.execute("UPDATE improvements SET chosen_at = ? WHERE id = ?", (stamp, improvement_id))
    with db.connection() as conn:
        return _summary(conn, _row(conn, found["thumbnail_id"]))
