"""`python -m studio`: run the server with the configured host and port."""

import uvicorn

from studio.app import create_app
from studio.config import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
