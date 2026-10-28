"""Content-addressed files: `<sha256[:2]>/<sha256>.<ext>`.

The name the client sent never touches the file system, the same picture
uploaded twice is one file, and a file never changes, so a URL that carries its
hash can be cached forever.
"""

import hashlib
import os
import re
import tempfile
from pathlib import Path
from typing import BinaryIO

CHUNK = 64 * 1024
EXTENSIONS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
_RELATIVE = re.compile(r"^[0-9a-f]{2}/[0-9a-f]{64}\.(png|jpg|webp)$")


class TooLarge(Exception):
    pass


def relative_path(sha256: str, image_format: str) -> str:
    return f"{sha256[:2]}/{sha256}.{EXTENSIONS[image_format]}"


def is_relative_path(value: str) -> bool:
    return bool(_RELATIVE.match(value))


def spool(stream: BinaryIO, *, media_dir: Path, max_bytes: int) -> tuple[Path, str, int]:
    """Copy the stream to a temp file, hashing and counting as it goes.

    Stops as soon as the limit is passed. The temp file lives next to its final
    place so that keeping it is an atomic rename. The caller deletes it if it
    decides not to keep it; on any error here it is already gone.
    """
    media_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    total = 0
    fd, name = tempfile.mkstemp(dir=media_dir, prefix=".upload-")
    temp = Path(name)
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := stream.read(CHUNK):
                total += len(chunk)
                if total > max_bytes:
                    raise TooLarge(total)
                digest.update(chunk)
                out.write(chunk)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    return temp, digest.hexdigest(), total


def commit(temp: Path, *, media_dir: Path, relative: str) -> Path:
    """Move the temp file into place. If it is already there, the content is the
    same by definition, so the temp file is dropped."""
    target = media_dir / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        temp.unlink(missing_ok=True)
    else:
        os.replace(temp, target)
    return target


def store_bytes(data: bytes, *, media_dir: Path, image_format: str) -> tuple[str, str]:
    """Store bytes we produced ourselves (a cutout). Returns (sha256, relative)."""
    sha = hashlib.sha256(data).hexdigest()
    relative = relative_path(sha, image_format)
    target = media_dir / relative
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=media_dir, prefix=".derived-")
        temp = Path(name)
        try:
            with os.fdopen(fd, "wb") as out:
                out.write(data)
            os.replace(temp, target)
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
    return sha, relative
