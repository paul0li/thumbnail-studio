# AGENTS.md

Guidance for anyone, human or agent, working in this repository.

## The project

Thumbnail Studio makes YouTube thumbnails for a show, easily, from a phone.

The show's host builds a mockup: picks the photos, places them and types the
title. Then an AI improves that mockup **layer by layer**, without touching
what must not change: the faces of the host and guests, the logo and frame, and
the words of the title. The result has to make a phone viewer want to click,
and has to be recognisable at a glance as an episode of that show.

It runs on devices connected through a Tailscale tailnet. The AI runs on a
separate machine reachable over an API, with a manual ChatGPT/Gemini round
trip as a fallback. It must stay free to run.

More in [`README.md`](README.md).

## Where things are written down

- [`README.md`](README.md): what the app does and for whom.
- [`docs/adr/`](docs/adr/): Architecture Decision Records, one decision per
  file. Read these before changing how something works.
  - [0001 — Start from scratch in a new repository](docs/adr/0001-start-from-scratch.md)
  - [0002 — The AI works by layers; protected layers are restored, not trusted](docs/adr/0002-layered-ai-with-protected-layers.md)
  - [0003 — The AI runs on a separate machine, with a manual fallback](docs/adr/0003-where-the-ai-runs.md)
  - [0004 — The host is the user](docs/adr/0004-the-host-is-the-user.md)
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

### Slices

Each piece of work ends in something the user can see or use, not in a
technical layer. Before starting, say what will be visible afterwards, how it
is shown to work, and what is deliberately left out.
