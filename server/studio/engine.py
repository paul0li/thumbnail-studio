"""Image engines: take the scene and an instruction, return one image (ADR 0010).

An engine keeps nothing and decides nothing about what happens to its result:
resizing, restoring faces, checking and the frame all happen after it, the
same for every engine. The first engine is OpenAI's Images API; a local mflux
engine on the AI machine (ADR 0005) is meant to be a second implementation of
the same `ImageEngine`.

The API key is read from the environment and only ever goes into the
`Authorization` header: it is never logged, never put in an error, never
returned.
"""

from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Protocol

log = logging.getLogger("studio.engine")

OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits"


class EngineError(Exception):
    """The engine could not give a result. `reason` is what the host reads,
    in Spanish; `code` is for the logs and the tests."""

    def __init__(self, code: str, reason: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class EngineResult:
    data: bytes
    # What the engine says about the call, for the record: model, size,
    # quality, token usage. Never anything secret.
    info: dict = field(default_factory=dict)


class ImageEngine(Protocol):
    name: str

    @property
    def configured(self) -> bool: ...

    def edit(self, scene_png: bytes, prompt: str) -> EngineResult: ...


@dataclass
class OpenAIImages:
    """`POST /v1/images/edits` with the scene as a data URL and one result,
    returned as base64. The size asked for is 16:9 (`gpt-image-2` takes
    custom sizes in multiples of 16); the pipeline fits whatever comes back
    to 1280x720 anyway."""

    api_key: str | None = field(repr=False)
    model: str = "gpt-image-2"
    quality: str = "high"
    size: str = "1536x864"
    timeout: float = 240.0
    url: str = OPENAI_EDITS_URL
    name: str = "openai"

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _body(self, scene_png: bytes, prompt: str) -> dict:
        body = {
            "model": self.model,
            "prompt": prompt,
            "images": [
                {"image_url": "data:image/png;base64," + base64.b64encode(scene_png).decode()}
            ],
            "n": 1,
            "size": self.size,
            "quality": self.quality,
            "output_format": "png",
        }
        # Older models default to low fidelity to the input; gpt-image-2 is
        # always high and refuses the parameter.
        if self.model.startswith("gpt-image-1"):
            body["input_fidelity"] = "high"
        return body

    def edit(self, scene_png: bytes, prompt: str) -> EngineResult:
        if not self.api_key:
            raise EngineError(
                "not_configured",
                "Falta configurar la clave del servicio de imágenes (OPENAI_API_KEY).",
            )
        request = urllib.request.Request(
            self.url,
            data=json.dumps(self._body(scene_png, prompt)).encode(),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise _http_error(exc) from None
        except TimeoutError as exc:
            raise EngineError(
                "timeout", "El servicio de imágenes tardó demasiado en responder.", str(exc)
            ) from None
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, TimeoutError):
                raise EngineError(
                    "timeout", "El servicio de imágenes tardó demasiado en responder.", str(exc)
                ) from None
            raise EngineError(
                "network",
                "No se pudo conectar con el servicio de imágenes. Revisa la conexión a internet.",
                str(exc.reason),
            ) from None
        except (ValueError, OSError) as exc:
            raise EngineError(
                "bad_response",
                "El servicio de imágenes respondió algo que no se entiende.",
                str(exc),
            ) from None
        try:
            data = base64.b64decode(payload["data"][0]["b64_json"], validate=True)
        except (KeyError, IndexError, TypeError, ValueError):
            raise EngineError(
                "bad_response", "El servicio de imágenes no devolvió ninguna imagen."
            ) from None
        info = {
            "engine": self.name,
            "model": self.model,
            "size": payload.get("size", self.size),
            "quality": payload.get("quality", self.quality),
        }
        if isinstance(payload.get("usage"), dict):
            info["usage"] = payload["usage"]
        return EngineResult(data, info)


def _http_error(exc: urllib.error.HTTPError) -> EngineError:
    detail = ""
    try:
        body = json.loads(exc.read() or b"{}")
        error = body.get("error") or {}
        # OpenAI's message, which never contains the key; kept for the logs.
        detail = (
            f"{error.get('type', '')} {error.get('code', '')} {error.get('message', '')}".strip()
        )
    except (ValueError, OSError, AttributeError):
        pass
    status = exc.code
    if status == 401:
        return EngineError(
            "unauthorized", "La clave del servicio de imágenes no es válida.", detail
        )
    if status == 403:
        return EngineError(
            "forbidden",
            "La cuenta del servicio de imágenes no tiene permiso para usar este modelo.",
            detail,
        )
    if status == 429:
        return EngineError(
            "rate_limited",
            "El servicio de imágenes no tiene saldo o está recibiendo demasiados pedidos. "
            "Prueba más tarde.",
            detail,
        )
    lowered = detail.lower()
    if status == 400 and ("moderation" in lowered or "safety" in lowered):
        return EngineError(
            "refused", "El servicio de imágenes se negó a editar esta escena.", detail
        )
    if status == 400:
        return EngineError("bad_request", "El servicio de imágenes rechazó el pedido.", detail)
    return EngineError(
        "engine_error",
        "El servicio de imágenes tuvo un error. Prueba más tarde.",
        f"{status} {detail}",
    )
