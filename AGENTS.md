# AGENTS.md

Guidance for anyone, human or agent, working in this repository.

## The project

Thumbnail Studio makes YouTube thumbnails for a show, easily, from a phone.

The show's host builds a mockup: picks the photos, places them and types the
title. Then an AI improves that mockup **layer by layer**, without touching
what must not change: the faces of the host and guests, the logo and frame, and
the words of the title. The result has to make a phone viewer want to click,
and has to be recognisable at a glance as an episode of that show.

It runs on devices connected through a Tailscale tailnet. A Claude Code
session, on the installation owner's own Claude plan, orchestrates the
improvement; image editing runs on a separate machine reachable over an API.
If any of that fails, the improvement fails visibly: there is no fallback.

More in [`README.md`](README.md).

## Where things are written down

- [`README.md`](README.md): what the app does and for whom.
- [`docs/adr/`](docs/adr/): Architecture Decision Records, one decision per
  file. Read these before changing how something works.
  - [0001 — Start from scratch in a new repository](docs/adr/0001-start-from-scratch.md)
  - [0002 — The AI works by layers; protected layers are restored, not trusted](docs/adr/0002-layered-ai-with-protected-layers.md) (in part superseded by 0010)
  - [0003 — The AI runs on a separate machine, with a manual fallback](docs/adr/0003-where-the-ai-runs.md) (superseded by 0006)
  - [0004 — The host is the user](docs/adr/0004-the-host-is-the-user.md)
  - [0005 — TypeScript draws, Python does the image work](docs/adr/0005-stack.md)
  - [0006 — A Claude Code session orchestrates the improvement, with no fallback](docs/adr/0006-claude-code-orchestrates.md)
  - [0007 — A thumbnail is a layered design document with Figma-style effects](docs/adr/0007-design-document.md)
  - [0008 — The daily thumbnail is a guided routine; fine editing is tucked away](docs/adr/0008-guided-daily-routine.md)
  - [0009 — Thumbnails are saved as versions on the server, with undo as a path](docs/adr/0009-saved-thumbnails.md)
  - [0010 — «Mejorar» sends the scene, restores faces by registration, checks, and pastes the frame last](docs/adr/0010-improvement-pipeline.md)
  - [0011 — The improved picture stays with its thumbnail](docs/adr/0011-improved-picture-stays.md)
- `CLAUDE.local.md` / `AGENTS.local.md` (gitignored, may not exist): facts about
  one particular installation. Read them if present; never commit them.

## How we work

### This repository is public

Nothing personal goes into tracked files, commit messages, branch names or pull
requests: no names of people or shows, emails, hostnames, IP addresses,
tailnet names, device names, usernames, home-directory paths, or details of
private machines and other private repositories. Write instructions and
examples generically ("the host", "the AI machine", `example.ts.net`).

Anything specific to an installation goes in:

- environment variables, documented with placeholder values in `.env.example`
  and set in the gitignored `.env`;
- `CLAUDE.local.md` or `AGENTS.local.md`, for notes agents need.

Photos, generated thumbnails and databases never enter the repository. Before
committing, check the diff for anything that identifies a person or a machine.

### Language

Everything in the repository is in **English**: code, identifiers, comments,
docs, ADRs, commit messages, branch names and pull requests. The one exception
is text the user reads in the app, which is in **Spanish**.

### Branches

Never commit to `main` directly. Branch names are `<type>/<short-kebab-description>`,
using the same types as commits:

```
feat/layer-restoration
fix/title-ocr-mismatch
docs/adr-model-choice
chore/update-dependencies
```

### Commits

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<optional scope>): <imperative summary, lower case, no period>

<optional body: why, not what>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`,
`chore`, `revert`. A breaking change adds `!` after the type and a
`BREAKING CHANGE:` footer. Keep the summary under ~72 characters.

### Pull requests

Title in Conventional Commit form. The body says what changed, why, and how it
was verified (the command run, or what was looked at, and at what size).

### Decisions (ADRs)

- One file per decision in `docs/adr/`, named `NNNN-kebab-title.md`, numbered
  in order. Copy the shape of an existing one: **Status**, **Context**,
  **Decision**, **Consequences**, **What would reverse it**.
- Write a new ADR when a choice shapes how the product or the code works and
  someone could reasonably have chosen otherwise.
- Do not rewrite history. When a decision stops holding, write a new ADR and
  mark the old one `Superseded by NNNN`.
- No numbered product rules and no criterion ids. Tests are named after the
  behaviour they check, and change when the wanted behaviour changes.

### Code

- Backend: Python with uv, `ruff` for lint and format, `pytest` for tests.
  Endpoints that touch Pillow are plain `def`; no image work inside a database
  transaction.
- Frontend: TypeScript in strict mode, `tsc --noEmit` clean, `vitest` for
  anything that does not need a canvas.
- The design document is the source of truth: the canvas is built from it and
  gestures write back to it through `web/src/document/edit.ts`. Any change to
  its shape updates `types.ts`, `validate.ts` and the JSON Schema in
  `schema/` together, with a case in `schema/cases/` for any new rule.
- The database schema is the numbered migrations in `server/studio/migrations/`,
  applied in order. Never edit one that has shipped; add the next number.
- `make test` and `make lint` must pass before committing.

### Slices

Each piece of work ends in something the user can see or use, not in a
technical layer. Before starting, say what will be visible afterwards, how it
is shown to work, and what is deliberately left out.
