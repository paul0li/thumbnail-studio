"""Settings, read from the environment (prefix `STUDIO_`) and an optional `.env`."""

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="STUDIO_", env_file=".env", extra="ignore")

    data_dir: Path = REPO_ROOT / "data"
    # Loopback by default: other devices reach the app through a proxy such as
    # `tailscale serve`, never because the server listens on every interface.
    host: str = "127.0.0.1"
    port: int = 8000

    cutout_provider: Literal["none", "rembg"] = "none"

    max_upload_bytes: int = 25 * 1024 * 1024
    # Checked against the header before decoding: a tiny PNG can declare
    # 40,000 x 40,000 pixels.
    max_image_pixels: int = 40_000_000

    # The built frontend. If it does not exist the API still works.
    web_dist: Path = REPO_ROOT / "web" / "dist"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "studio.sqlite3"
