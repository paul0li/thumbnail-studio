"""Cutout providers. A provider takes an image and returns it without background.

`none` cuts nothing and says so (`available = False`), so the app can tell the
host that cutting out is off instead of offering a button that does nothing.
`rembg` runs u2net locally; its import lives inside the call because importing
it costs a few hundred MB of memory that nobody should pay for until they ask.
"""

from collections.abc import Callable
from typing import Protocol

from PIL import Image

MODEL = "u2net"


class CutoutProvider(Protocol):
    name: str
    available: bool

    def remove_background(self, image: Image.Image) -> Image.Image: ...


class CutoutUnavailable(Exception):
    pass


class NoCutout:
    name = "none"
    available = False

    def remove_background(self, image: Image.Image) -> Image.Image:
        raise CutoutUnavailable


class RembgCutout:
    """u2net through rembg. The model is read from `U2NET_HOME` (rembg's own
    variable); tests and CI never download it."""

    name = "rembg"
    available = True

    def __init__(self, remove: Callable[[Image.Image], Image.Image] | None = None) -> None:
        self._remove = remove
        self._session = None

    def remove_background(self, image: Image.Image) -> Image.Image:
        remove = self._remove or self._rembg()
        return remove(image.convert("RGBA"))

    def _rembg(self) -> Callable[[Image.Image], Image.Image]:
        from rembg import new_session, remove

        if self._session is None:
            self._session = new_session(MODEL)
        session = self._session
        return lambda image: remove(image, session=session)


def build_provider(name: str) -> CutoutProvider:
    if name == "none":
        return NoCutout()
    if name == "rembg":
        return RembgCutout()
    raise ValueError(f"unknown cutout provider: {name!r}")
