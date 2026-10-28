import io
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from studio.app import create_app
from studio.config import Settings
from studio.cutout import CutoutProvider


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # `_env_file=None`: the tests never read the machine's `.env`.
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>Thumbnail Studio</title>")
    return Settings(_env_file=None, data_dir=tmp_path / "data", web_dist=dist)


@pytest.fixture
def make_client(settings: Settings) -> Callable[..., TestClient]:
    def build(provider: CutoutProvider | None = None) -> TestClient:
        return TestClient(create_app(settings, provider))

    return build


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


def png(width: int = 64, height: int = 48, color=(200, 40, 40, 255), mode: str = "RGBA") -> bytes:
    out = io.BytesIO()
    Image.new(mode, (width, height), color[: len(mode)]).save(out, "PNG")
    return out.getvalue()


def jpeg(width: int = 64, height: int = 48) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (10, 120, 200)).save(out, "JPEG")
    return out.getvalue()


def person_with_padding() -> bytes:
    """A 'person' 40x60 in the middle of a 200x200 transparent canvas, with
    faint near-transparent specks in the corners like a real cutout leaves."""
    image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    image.paste(Image.new("RGBA", (40, 60), (220, 180, 150, 255)), (80, 70))
    for xy in [(0, 0), (199, 0), (0, 199), (199, 199)]:
        image.putpixel(xy, (255, 255, 255, 5))
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def upload(client: TestClient, role: str, *files: tuple[str, bytes, str]):
    return client.post(
        "/api/photos",
        data={"role": role},
        files=[("files", f) for f in files],
    )
