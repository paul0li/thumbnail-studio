.PHONY: install install-cutout dev serve build test lint fmt

# Ports for `make dev`. Change them if something else already listens there.
API_PORT ?= 8000
WEB_PORT ?= 5173

install:  ## Python and frontend dependencies, project-local
	uv sync
	cd web && npm ci

install-cutout:  ## Optional: rembg for cutting people out (model goes in U2NET_HOME)
	uv sync --extra cutout

dev:  ## Backend with reload, plus Vite forwarding /api to it
	@trap 'kill 0' EXIT; \
	uv run uvicorn studio.app:create_app --factory --reload --host 127.0.0.1 --port $(API_PORT) & \
	cd web && STUDIO_API_PORT=$(API_PORT) npm run dev -- --port $(WEB_PORT)

build:  ## Build the frontend into web/dist, which the backend serves
	cd web && npm run build

serve: build  ## The app as it runs for real: one process, one origin
	uv run python -m studio

test:
	uv run pytest
	cd web && npm test

lint:
	uv run ruff check .
	uv run ruff format --check .
	cd web && npm run typecheck

fmt:
	uv run ruff check --fix .
	uv run ruff format .
