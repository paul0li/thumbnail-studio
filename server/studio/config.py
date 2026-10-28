"""Settings, read from the environment (prefix `STUDIO_`) and an optional `.env`."""

from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
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

    # «Mejorar» (ADR 0010). The image engine: OpenAI's Images API for now.
    improve_engine: Literal["openai"] = "openai"
    # The key keeps OpenAI's own variable name. It is never logged or returned.
    openai_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("OPENAI_API_KEY", "STUDIO_OPENAI_API_KEY")
    )
    openai_image_model: str = "gpt-image-2"
    openai_image_quality: Literal["low", "medium", "high", "auto"] = "high"
    # 16:9 in multiples of 16; whatever comes back is fitted to 1280x720.
    openai_image_size: str = "1536x864"
    openai_timeout_seconds: float = 240

    # The headless Claude Code call that reads the result back. The command is
    # split like a shell would; it must not carry secrets.
    claude_command: str = "claude"
    claude_model: str = "opus"
    claude_timeout_seconds: float = 180

    # The built frontend. If it does not exist the API still works.
    web_dist: Path = REPO_ROOT / "web" / "dist"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "studio.sqlite3"
