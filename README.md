# Thumbnail Studio

YouTube thumbnails for a show, made easily from a phone.

## What it does

The show's host builds the thumbnail mockup: picks the photos, places them and
types the title. It is quick and it is theirs: the mockup is the intent.

Then an AI improves it **layer by layer**. It works on top of the mockup rather
than replacing it, and it does not touch what must stay the same:

- the faces of the host and the guests,
- the logo and the frame,
- the words of the title (their styling may change).

Everything else is the AI's to change: the background, the light, the colour,
the effects, how the title stands out. What it has to deliver is a cohesive
thumbnail that does two things:

1. **Makes people want to click** when they browse YouTube on a phone, where a
   thumbnail is small and surrounded by others.
2. **Is recognisable at first sight**: anyone who knows the show must be sure
   it is one of its episodes.

The second is as much part of the job as the first. An eye-catching thumbnail
that does not look like the show is a wrong one.

## Where it runs

On devices connected through a Tailscale tailnet: only devices in the tailnet
can reach it, with no accounts or passwords. A Claude Code session on the
owner's own Claude plan orchestrates the improvement, and image editing runs
on a separate machine in the same tailnet.

## Running it locally

You need [uv](https://docs.astral.sh/uv/) and Node.js 22 or later.

```bash
cp .env.example .env   # optional: every setting has a default
make install           # Python deps (uv) and frontend deps (npm), all project-local
make serve             # builds the frontend and serves the app at http://127.0.0.1:8000
```

While working on it, `make dev` runs the backend with reload and Vite with hot
reload on http://127.0.0.1:5173, forwarding `/api` to the backend so the
browser sees one origin, as in production. Use `make dev API_PORT=8100
WEB_PORT=5174` if those ports are taken.

```bash
make test   # pytest for the backend, vitest for the design document
make lint   # ruff, and tsc --noEmit for the frontend
```

### Reaching it from a phone

The server binds to `127.0.0.1` on purpose. To open it from a phone, put a
proxy in front of it on the same machine, for example `tailscale serve`, which
gives the devices in your tailnet an HTTPS address such as
`https://your-machine.example.ts.net` without exposing the app to the local
network. HTTPS also matters for the share sheet that saves the PNG on iOS.

### Cutting people out (optional)

Photos of people are best uploaded already cut out (PNG with transparency).
To cut them out on the server, install the optional extra and point rembg at
its model:

```bash
make install-cutout                    # uv sync --extra cutout
# in .env:
STUDIO_CUTOUT_PROVIDER=rembg
U2NET_HOME=/path/to/models             # rembg downloads u2net here on first use
```

With the default provider (`none`) the app says that cutting out is off
instead of offering a button that does nothing.

### Improving a thumbnail («Mejorar»)

The routine ends with «Mejorar» (ADR 0010). It sends the scene, drawn without
the frame and the logo, to an image engine, puts the original faces back onto
what returns, checks that nobody was added and that the title's words are
exactly what was typed, and only then pastes the frame and logo on top. If
anything fails, the host reads why and keeps her own thumbnail.

It needs two things on the machine that runs the server:

- **An OpenAI API key** for the image engine, in `.env` as `OPENAI_API_KEY`
  (see `.env.example` for the model, quality and size, and their cost).
- **Claude Code**, installed and signed in with the owner's own plan (see
  Anthropic's Claude Code documentation), on the `PATH` of
  the server process or named with `STUDIO_CLAUDE_COMMAND`. It reads the
  result back; without it every improvement fails, visibly.

Face detection uses OpenCV's YuNet model, which is in the repository
(`server/studio/models/`, MIT). Tests never call the engine or Claude Code.

### Data

The database, photos, saved thumbnails and every picture of each improvement
live in `STUDIO_DATA_DIR` (`./data`
by default, gitignored). Files are stored by content hash; deleting a photo or
a thumbnail hides it but keeps its files and versions. Thumbnails are saved as
the host works, with their undo history, and the browser keeps a copy until
the server confirms each save (ADR 0009). The schema is created and upgraded
by numbered migrations when the server starts.

People in the library are either a `host` or a `guest`. Libraries from before
that split had a single `person` role: on upgrade, a person whose photo is in
the host slot of any saved thumbnail becomes a host and every other person a
guest. A future import from the previous version's library must map its
host (conductor) role to `host` and its guest role to `guest`.

## Layout of the code

- `server/studio/`: the FastAPI backend (photo library, cutouts, saved
  thumbnails, serving the built frontend). «Mejorar» is `improve.py` (the
  run), `engine.py` (image engines), `faces.py` (finding and restoring faces)
  and `readback.py` (the Claude Code check). Migrations in
  `server/studio/migrations/`, tests in `server/tests/`.
- `schema/`: the design document's JSON Schema, which the server validates
  with, and the cases both validators are tested against.
- `web/src/document/`: the design document (ADR 0007): types, validator, title
  layout and presets. Pure TypeScript, tested with vitest.
- `web/src/canvas/`: the Konva scene built from the document, and the drawing
  of words and photos with their effects.
- `web/src/sync.ts`, `web/src/open.ts`: saving as the host works, and what
  opening a thumbnail means given the server and the device's copy.
- `web/src/ui/`: the steps, the library, «Mis miniaturas», plain DOM.

## Documentation

- [`AGENTS.md`](AGENTS.md): how to work in this repository.
- [`docs/adr/`](docs/adr/): the decisions behind the product and the code.
