"""What Pillow decides about an upload, and the alpha trim."""

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

# Pillow's own global ceiling is replaced by ours, which is configurable and
# gives a clear error instead of a warning.
Image.MAX_IMAGE_PIXELS = None

SUPPORTED = ("PNG", "JPEG", "WEBP")

# A cutout model leaves thousands of faint pixels (alpha 1..8) scattered up to
# the corners. Counting them would make a person's box the whole canvas, so the
# trim ignores anything this transparent.
ALPHA_THRESHOLD = 24


class NotAnImage(Exception):
    pass


class UnsupportedFormat(Exception):
    pass


class TooManyPixels(Exception):
    pass


@dataclass(frozen=True)
class Inspection:
    format: str
    width: int
    height: int
    has_alpha: bool


def inspect(path: Path, max_pixels: int) -> Inspection:
    """Format, size and transparency, read from the header without decoding."""
    try:
        # `verify()` leaves the object unusable, so the file is opened twice.
        with Image.open(path) as probe:
            probe.verify()
        with Image.open(path) as image:
            image_format = image.format or ""
            width, height = image.size
            has_alpha = image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise NotAnImage from exc
    if image_format not in SUPPORTED:
        raise UnsupportedFormat(image_format)
    # After the header, before decoding: this is the decompression-bomb check.
    if width * height > max_pixels:
        raise TooManyPixels(width * height)
    return Inspection(image_format, width, height, has_alpha)


def needs_reencode(path: Path) -> bool:
    """A JPEG with an EXIF rotation would be drawn sideways by some browsers'
    canvases; those get a rotated copy for display."""
    with Image.open(path) as image:
        orientation = image.getexif().get(0x0112, 1)
    return orientation not in (None, 1)


def alpha_box(image: Image.Image, threshold: int = ALPHA_THRESHOLD) -> tuple[int, int, int, int]:
    """The box of the pixels that are really there."""
    if image.mode != "RGBA":
        image = image.convert("RGBA")
    mask = image.getchannel("A").point(lambda a: 255 if a >= threshold else 0)
    return mask.getbbox() or (0, 0, image.width, image.height)


def trimmed_png(path: Path) -> tuple[bytes, int, int]:
    """The image cropped to its visible pixels, as PNG bytes."""
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGBA")
    box = alpha_box(image)
    cropped = image.crop(box)
    out = io.BytesIO()
    cropped.save(out, "PNG", optimize=False)
    return out.getvalue(), cropped.width, cropped.height


def upright_copy(path: Path) -> tuple[bytes, str, int, int]:
    """An EXIF-rotated copy, in the original format family."""
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        out = io.BytesIO()
        if image.mode in ("RGBA", "LA", "P"):
            image.save(out, "PNG")
            fmt = "PNG"
        else:
            image.convert("RGB").save(out, "JPEG", quality=92)
            fmt = "JPEG"
        return out.getvalue(), fmt, image.width, image.height
