"""The HTTP app: the library API under `/api` and the built frontend at `/`."""

import logging
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from studio import library, storage
from studio.config import Settings
from studio.cutout import CutoutProvider, build_provider
from studio.db import Database

log = logging.getLogger("studio")


class RoleChange(BaseModel):
    role: str


class WebFiles(StaticFiles):
    """The built frontend. Vite puts the content hash in every name under
    `assets/`, so those are immutable; anything else (index.html, the font)
    revalidates, or a phone would keep yesterday's page."""

    def file_response(self, full_path, stat_result, scope, status_code=200):  # type: ignore[override]
        response = super().file_response(full_path, stat_result, scope, status_code)
        path = scope.get("path", "")
        if path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


def create_app(settings: Settings | None = None, provider: CutoutProvider | None = None) -> FastAPI:
    settings = settings or Settings()
    db = Database(settings.db_path)
    cutout = provider or build_provider(settings.cutout_provider)

    app = FastAPI(title="Thumbnail Studio", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.settings = settings
    app.state.db = db

    @app.exception_handler(library.LibraryError)
    def library_error(_: Request, exc: library.LibraryError) -> JSONResponse:
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    @app.exception_handler(Exception)
    def unexpected(_: Request, exc: Exception) -> JSONResponse:
        # Logged in full here; the client never sees a traceback or a path.
        log.exception("unexpected error", exc_info=exc)
        return JSONResponse({"detail": "Algo salió mal."}, status_code=500)

    @app.get("/api/config")
    def config() -> dict:
        return {
            "roles": list(library.ROLES),
            "cutout": {"available": cutout.available, "roles": list(library.CUTOUT_ROLES)},
            "max_upload_bytes": settings.max_upload_bytes,
        }

    # Endpoints that touch Pillow are plain `def`: FastAPI runs them in its
    # thread pool instead of blocking the event loop.
    @app.post("/api/photos", status_code=201)
    def upload(
        role: Annotated[str, Form()],
        files: Annotated[list[UploadFile], File()],
        response: Response,
    ) -> dict:
        stored, errors = [], []
        for file in files:
            try:
                stored.append(library.upload(db, settings, role, file.file).as_json())
            except library.LibraryError as exc:
                # The name is echoed back so the host knows which one failed;
                # it never takes part in any decision.
                errors.append({"filename": file.filename, "detail": exc.message})
        if not stored:
            response.status_code = 422
        return {"photos": stored, "errors": errors}

    @app.get("/api/photos")
    def list_photos(role: Annotated[str | None, Query()] = None) -> dict:
        return {"photos": [p.as_json() for p in library.list_photos(db, role)]}

    @app.get("/api/photos/{photo_id}")
    def get_photo(photo_id: str) -> dict:
        return library.get(db, photo_id).as_json()

    @app.delete("/api/photos/{photo_id}", status_code=204)
    def delete_photo(photo_id: str) -> Response:
        library.delete(db, photo_id)
        return Response(status_code=204)

    @app.patch("/api/photos/{photo_id}")
    def change_role(photo_id: str, body: RoleChange) -> dict:
        return library.set_role(db, photo_id, body.role).as_json()

    @app.post("/api/photos/{photo_id}/cutout")
    def cut_out(photo_id: str) -> dict:
        return library.cut_out(db, settings, cutout, photo_id).as_json()

    @app.get("/api/files/{prefix}/{name}")
    def serve_file(prefix: str, name: str, request: Request) -> Response:
        relative = f"{prefix}/{name}"
        if not storage.is_relative_path(relative) or not library.is_served(db, relative):
            raise HTTPException(status_code=404)
        sha = name.split(".", 1)[0]
        etag = f'"{sha}"'
        # The URL carries the content hash, so it can never point at other bytes.
        headers = {"ETag": etag, "Cache-Control": "public, max-age=31536000, immutable"}
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        ext = name.rsplit(".", 1)[1]
        return FileResponse(
            settings.media_dir / relative, media_type=storage.MIME[ext], headers=headers
        )

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def api_not_found(rest: str) -> Response:
        raise HTTPException(status_code=404)

    if (settings.web_dist / "index.html").exists():
        app.mount("/", WebFiles(directory=settings.web_dist, html=True), name="web")
    else:

        @app.get("/")
        def no_frontend() -> Response:
            return Response(
                "Frontend not built. Run `make build`.", media_type="text/plain", status_code=503
            )

    return app
