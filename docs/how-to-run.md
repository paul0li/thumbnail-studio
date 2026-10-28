# How to run Thumbnail Studio

This is the technical side: installing, running, testing, reaching the app from
a phone and setting up «Mejorar». For what the app is and how it is used, see
the [README](../README.md).

## Requirements

- [uv](https://docs.astral.sh/uv/) (it installs the Python version the project
  pins in `.python-version`).
- Node.js 22 or later, with npm.
- Optional: [Tailscale](https://tailscale.com), to open the app from a phone.
- Optional, for «Mejorar»: an OpenAI API key and
  [Claude Code](https://docs.anthropic.com/en/docs/claude-code), signed in.

## Install and run

```bash
cp .env.example .env   # optional: every setting has a default
make install           # Python deps (uv) and frontend deps (npm ci), all project-local
make serve             # builds the frontend and serves the app at http://127.0.0.1:8000
```

`make serve` is the app as it runs for real: one process serves the API and the
built frontend from one origin. Run `make` commands from the repository root:
the settings are read from the environment and from a `.env` file in the
current directory.

## Make targets

| Target | What it does |
| --- | --- |
| `make install` | `uv sync`, then `npm ci` in `web/`. |
| `make install-cutout` | Optional: `uv sync --extra cutout`, which adds rembg for cutting people out. |
| `make serve` | `make build`, then `python -m studio` with the configured host and port. |
| `make build` | Builds the frontend into `web/dist`, which the backend serves. |
| `make dev` | Backend with reload, plus Vite with hot reload (see below). |
| `make test` | `pytest` for the backend, `vitest` for the frontend. |
| `make lint` | `ruff check`, `ruff format --check`, and `tsc --noEmit` for the frontend. |
| `make fmt` | Fixes what ruff can fix, and formats. |

## Development mode

```bash
make dev
```

This runs the backend with `--reload` on port 8000 and Vite on
http://127.0.0.1:5173. Vite forwards `/api` to the backend, so the browser sees
one origin, as in production. If those ports are taken:

```bash
make dev API_PORT=8100 WEB_PORT=5174
```

## Tests and lint

```bash
make test   # pytest for the backend, vitest for the design document
make lint   # ruff, and tsc --noEmit for the frontend
```

Both must pass before committing. Tests never call the image engine or Claude
Code.

## Reaching it from a phone

The server binds to `127.0.0.1` on purpose. To open it from a phone, put a
proxy in front of it on the same machine. For example, `tailscale serve` gives
the devices in your tailnet an HTTPS address such as
`https://your-machine.example.ts.net`, without exposing the app to the local
network:

```bash
tailscale serve --bg 8000   # proxies https://<machine>.<tailnet>.ts.net to 127.0.0.1:8000
```

Check `tailscale serve --help` for the syntax of your Tailscale version. Only
devices in the tailnet can reach the app, and there are no accounts or
passwords. HTTPS also matters for the share sheet that saves the PNG on iOS.

Do not bind the server to `0.0.0.0` to reach it from other devices.

## Cutting people out (optional)

Photos of people are best uploaded already cut out (PNG with transparency). To
cut them out on the server, install the optional extra and point rembg at its
model:

```bash
make install-cutout                    # uv sync --extra cutout
# in .env:
STUDIO_CUTOUT_PROVIDER=rembg
U2NET_HOME=/path/to/models             # rembg downloads u2net here on first use
```

Cutting out is offered for hosts and guests only. With the default provider
(`none`), the app says that cutting out is off instead of offering a button
that does nothing.

## Improving a thumbnail («Mejorar»)

The routine ends with «Mejorar» (ADR 0010):

1. The browser sends the scene, drawn without the frame and the logo, to an
   image engine.
2. The server fits the answer to 1280×720.
3. It puts the original faces back onto what returns.
4. It checks that nobody was added, and that the title's words are exactly what
   was typed.
5. Only then does it paste the frame and logo on top.

If anything fails, the host reads why and keeps her own thumbnail. There is no
fallback. The improved picture then stays with the thumbnail (ADR 0011).

It needs two things on the machine that runs the server.

### An OpenAI API key

The image engine is OpenAI's Images API. Put the key in `.env` as
`OPENAI_API_KEY` (`STUDIO_OPENAI_API_KEY` also works). Without a key, the button
still shows and says that the improvement is not configured. The key is never
logged or returned.

At quality `high`, an improvement costs about USD 0.15–0.20 and takes one to
two minutes. At `medium`, it costs about USD 0.05 (OpenAI's prices on
2026-10-28).

### Claude Code

Claude Code must be installed and signed in with the installation owner's own
plan (see Anthropic's Claude Code documentation). It must be on the `PATH` of
the server process, or named with `STUDIO_CLAUDE_COMMAND`. A headless Claude
Code session reads the result back: it checks the title's words and looks for
added people. Without it, every improvement fails, visibly.

To check it from the same shell that will run the server:

```bash
claude --version   # or the command you set in STUDIO_CLAUDE_COMMAND
```

Face detection uses OpenCV's YuNet model, which is in the repository
(`server/studio/models/`, MIT).

## Settings

Every setting is an environment variable, or a line in `.env`. All have
defaults; `.env.example` lists them with placeholder values.

| Variable | Default | Meaning |
| --- | --- | --- |
| `STUDIO_DATA_DIR` | `./data` | Database, photos, saved thumbnails and improvement pictures. Never inside a tracked folder. |
| `STUDIO_HOST` | `127.0.0.1` | Interface the server binds to. Keep loopback; use a proxy for other devices. |
| `STUDIO_PORT` | `8000` | Port of `make serve`. |
| `STUDIO_CUTOUT_PROVIDER` | `none` | `none` or `rembg`. |
| `U2NET_HOME` | rembg's default | Where rembg keeps the u2net model. |
| `STUDIO_MAX_UPLOAD_BYTES` | `26214400` (25 MB) | Largest upload accepted. |
| `STUDIO_MAX_IMAGE_PIXELS` | `40000000` | Largest image accepted, checked before decoding. |
| `OPENAI_API_KEY` | unset | Key for the image engine. |
| `STUDIO_OPENAI_IMAGE_MODEL` | `gpt-image-2` | Image model. |
| `STUDIO_OPENAI_IMAGE_QUALITY` | `high` | `low`, `medium`, `high` or `auto`. |
| `STUDIO_OPENAI_IMAGE_SIZE` | `1536x864` | Size asked of the engine; the answer is fitted to 1280×720. |
| `STUDIO_OPENAI_TIMEOUT_SECONDS` | `240` | Time limit for the engine. |
| `STUDIO_CLAUDE_COMMAND` | `claude` | Command for the read-back, split like a shell would. Never put a secret in it. |
| `STUDIO_CLAUDE_MODEL` | `opus` | Model for the read-back. |
| `STUDIO_CLAUDE_TIMEOUT_SECONDS` | `180` | Time limit for the read-back. |

## Data

The database, photos, saved thumbnails and every picture of each improvement
live in `STUDIO_DATA_DIR` (`./data` by default, gitignored).

- Files are stored by content hash.
- Deleting a photo or a thumbnail hides it but keeps its files and versions.
- Thumbnails are saved as the host works, with their undo history, and the
  browser keeps a copy until the server confirms each save (ADR 0009).
- The schema is created and upgraded by numbered migrations
  (`server/studio/migrations/`) when the server starts.

People in the library are either a `host` or a `guest`. Libraries from before
that split had a single `person` role. On upgrade, a person whose photo is in
the host slot of any saved thumbnail becomes a host, and every other person
becomes a guest. A future import from the previous version's library must map
its host (conductor) role to `host` and its guest role to `guest`.

## Layout of the code

- `server/studio/`: the FastAPI backend (photo library, cutouts, saved
  thumbnails, serving the built frontend). «Mejorar» is spread over four files:
  - `improve.py`: the run;
  - `engine.py`: the image engines;
  - `faces.py`: finding and restoring faces;
  - `readback.py`: the Claude Code check.

  Migrations are in `server/studio/migrations/` and tests in `server/tests/`.
- `schema/`: the design document's JSON Schema, which the server validates
  with, and the cases both validators are tested against.
- `web/src/document/`: the design document (ADR 0007): types, validator, title
  layout and presets. Pure TypeScript, tested with vitest.
- `web/src/canvas/`: the Konva scene built from the document, and the drawing
  of words and photos with their effects.
- `web/src/sync.ts`, `web/src/open.ts`: saving as the host works, and what
  opening a thumbnail means given the server and the device's copy.
- `web/src/ui/`: the steps, the library and «Mis miniaturas», in plain DOM.

## More

- [`AGENTS.md`](../AGENTS.md): how to work in this repository.
- [`docs/adr/`](adr/): the decisions behind the product and the code.
