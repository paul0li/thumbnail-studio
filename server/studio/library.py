"""The photo library: upload, list by role, soft delete, cut out.

The rule for incoming bytes: the content decides, never what the client says.
The file name and content type are text anyone can write; the format is decided
by opening the image and the path comes from its hash.
"""

import secrets
import sqlite3
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO

from PIL import Image

from studio import images, storage
from studio.config import Settings
from studio.cutout import CutoutProvider, CutoutUnavailable
from studio.db import Database

ROLES = ("background", "host", "guest", "logo", "frame")
# People: the only photos that are cut out, and the only ones that can move
# between roles (a photo uploaded in the wrong step).
PEOPLE_ROLES = ("host", "guest")
CUTOUT_ROLES = PEOPLE_ROLES


class LibraryError(Exception):
    status = 422

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFound(LibraryError):
    status = 404


class Conflict(LibraryError):
    status = 409


@dataclass(frozen=True)
class Photo:
    id: str
    role: str
    sha256: str
    path: str
    width: int
    height: int
    has_alpha: bool
    display_path: str
    display_width: int
    display_height: int
    cut_out: bool
    created_at: str

    def as_json(self) -> dict:
        return {
            "id": self.id,
            "role": self.role,
            "width": self.display_width,
            "height": self.display_height,
            "url": f"/api/files/{self.display_path}",
            "original_url": f"/api/files/{self.path}",
            "has_alpha": self.has_alpha,
            "cut_out": self.cut_out,
            "created_at": self.created_at,
        }


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _new_id() -> str:
    # Sortable across milliseconds, random within one.
    return f"{int(time.time() * 1000):012x}{secrets.token_hex(5)}"


def _row(row: sqlite3.Row) -> Photo:
    return Photo(
        id=row["id"],
        role=row["role"],
        sha256=row["sha256"],
        path=row["path"],
        width=row["width"],
        height=row["height"],
        has_alpha=bool(row["has_alpha"]),
        display_path=row["display_path"],
        display_width=row["display_width"],
        display_height=row["display_height"],
        cut_out=bool(row["cut_out"]),
        created_at=row["created_at"],
    )


def _check_role(role: str) -> None:
    if role not in ROLES:
        raise LibraryError("Ese tipo de foto no existe.")


def _display_for(
    settings: Settings, role: str, file: Path, info: images.Inspection
) -> tuple[str, int, int] | None:
    """A derived file for the canvas, or None if the original is drawn as is.

    A person with transparency is trimmed to their pixels, so their box is the
    person and not the canvas they came in. Anything with an EXIF rotation gets
    an upright copy.
    """
    if role in CUTOUT_ROLES and info.has_alpha:
        data, width, height = images.trimmed_png(file)
        _, relative = storage.store_bytes(data, media_dir=settings.media_dir, image_format="PNG")
        return relative, width, height
    if images.needs_reencode(file):
        data, fmt, width, height = images.upright_copy(file)
        _, relative = storage.store_bytes(data, media_dir=settings.media_dir, image_format=fmt)
        return relative, width, height
    return None


def upload(db: Database, settings: Settings, role: str, stream: BinaryIO) -> Photo:
    _check_role(role)
    try:
        temp, sha, _size = storage.spool(
            stream, media_dir=settings.media_dir, max_bytes=settings.max_upload_bytes
        )
    except storage.TooLarge as exc:
        raise LibraryError("Ese archivo pesa demasiado.") from exc

    try:
        info = images.inspect(temp, settings.max_image_pixels)
    except images.NotAnImage as exc:
        temp.unlink(missing_ok=True)
        raise LibraryError("Eso no parece una imagen.") from exc
    except images.UnsupportedFormat as exc:
        temp.unlink(missing_ok=True)
        raise LibraryError("Formato no soportado. Usa PNG, JPEG o WEBP.") from exc
    except images.TooManyPixels as exc:
        temp.unlink(missing_ok=True)
        raise LibraryError("Esa imagen tiene demasiados píxeles.") from exc
    except BaseException:
        temp.unlink(missing_ok=True)
        raise

    relative = storage.relative_path(sha, info.format)
    file = storage.commit(temp, media_dir=settings.media_dir, relative=relative)

    # Image work happens here, outside any transaction.
    display = _display_for(settings, role, file, info)
    display_path, display_w, display_h = display or (relative, info.width, info.height)

    photo_id = _new_id()
    with db.transaction() as conn:
        conn.execute(
            """INSERT INTO photos (id, role, sha256, path, width, height, has_alpha,
                   display_path, display_width, display_height, cut_out, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (
                photo_id,
                role,
                sha,
                relative,
                info.width,
                info.height,
                int(info.has_alpha),
                display_path,
                display_w,
                display_h,
                now(),
            ),
        )
    return get(db, photo_id)


def get(db: Database, photo_id: str) -> Photo:
    with db.connection() as conn:
        row = conn.execute(
            "SELECT * FROM photos WHERE id = ? AND deleted_at IS NULL", (photo_id,)
        ).fetchone()
    if row is None:
        raise NotFound("Esa foto no existe.")
    return _row(row)


def list_photos(db: Database, role: str | None = None) -> list[Photo]:
    with db.connection() as conn:
        if role is None:
            rows = conn.execute(
                "SELECT * FROM photos WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC"
            ).fetchall()
        else:
            _check_role(role)
            rows = conn.execute(
                """SELECT * FROM photos WHERE role = ? AND deleted_at IS NULL
                   ORDER BY created_at DESC, id DESC""",
                (role,),
            ).fetchall()
    return [_row(r) for r in rows]


def delete(db: Database, photo_id: str) -> None:
    """Soft delete: the row is marked and the files stay, so nothing is lost
    without review."""
    with db.transaction() as conn:
        cursor = conn.execute(
            "UPDATE photos SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
            (now(), photo_id),
        )
    if cursor.rowcount == 0:
        raise NotFound("Esa foto no existe.")


def set_role(db: Database, photo_id: str, role: str) -> Photo:
    """Moves a person between host and guest. Nothing else changes role: a
    background is not a logo, and the display file was made for its role."""
    photo = get(db, photo_id)
    if photo.role not in PEOPLE_ROLES or role not in PEOPLE_ROLES:
        raise LibraryError("Solo una persona puede pasar de conductor a invitado o al revés.")
    with db.transaction() as conn:
        conn.execute(
            "UPDATE photos SET role = ? WHERE id = ? AND deleted_at IS NULL", (role, photo_id)
        )
    return get(db, photo_id)


def cut_out(db: Database, settings: Settings, provider: CutoutProvider, photo_id: str) -> Photo:
    photo = get(db, photo_id)
    if photo.role not in CUTOUT_ROLES:
        raise LibraryError("Solo se le quita el fondo a una persona.")
    if not provider.available:
        raise Conflict("El recorte automático no está activo en este equipo.")

    with Image.open(settings.media_dir / photo.path) as source:
        try:
            result = provider.remove_background(source)
        except CutoutUnavailable as exc:
            raise Conflict("El recorte automático no está activo en este equipo.") from exc

    tmp = settings.media_dir / f".cutout-{secrets.token_hex(8)}.png"
    try:
        result.save(tmp, "PNG")
        data, width, height = images.trimmed_png(tmp)
    finally:
        tmp.unlink(missing_ok=True)
    _, relative = storage.store_bytes(data, media_dir=settings.media_dir, image_format="PNG")

    with db.transaction() as conn:
        conn.execute(
            """UPDATE photos SET display_path = ?, display_width = ?, display_height = ?,
                   cut_out = 1 WHERE id = ?""",
            (relative, width, height, photo_id),
        )
    return get(db, photo_id)


def is_served(db: Database, relative: str) -> bool:
    """Only files a photo points to are served, deleted or not: a URL that
    carries a hash keeps working for a design that still uses it."""
    with db.connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM photos WHERE path = ? OR display_path = ? LIMIT 1",
            (relative, relative),
        ).fetchone()
    return row is not None
