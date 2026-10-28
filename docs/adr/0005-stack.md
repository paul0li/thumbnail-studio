# 0005 — TypeScript draws, Python does the image work

**Status:** Accepted · 2026-10-27

## Context

Thumbnail Studio is an image editor used from a phone: the host drags photos,
resizes them and styles the title, and expects what they see to be exactly
what they download. On top of that sits AI work: cutting people out, editing
the background with an image model, and restoring protected layers pixel by
pixel.

The editors worth learning from split the same way. Figma, Canva, Photopea and
the "Canva-like" kits (Polotno, Konva, Fabric.js) draw in the browser, in
TypeScript or C++ compiled to WebAssembly. Practically all image AI tooling
(segmentation, diffusion runtimes such as mflux, numpy) is Python, and Go has
nothing comparable.

The previous version rendered everything on the server and wrote its own
gesture code. That kept one renderer, but every visual effect had to be an
image the server could serve, and the hand-written gestures were already
noted as the thing a library would pay for once rotation, multi-select or
text effects arrived. They have.

## Decision

- **The browser is the only renderer.** The canvas is TypeScript with
  [Konva](https://konvajs.org/). It draws the layers, the title and its
  effects live, and exports the final 1280×720 PNG from the same scene. There
  is no second implementation of the drawing on the server.
- **The backend is Python (FastAPI).** It stores the photo library and the
  projects, cuts people out, prepares what goes to the image model, restores
  protected layers onto what comes back, and exposes the tools the
  orchestrator uses (ADR 0006).
- **Image editing runs as a stateless service on the AI machine**, in Python
  with mflux: it receives an image and an instruction and returns an image,
  keeping nothing.

## Consequences

Two languages, each where its ecosystem is. The server no longer produces the
final picture, so anything that needs the composed thumbnail (the
orchestrator looking at it, the download) gets it from a render of the design
document (ADR 0007) in a browser, headless when no one is looking.

Konva brings its own scene model; the design document is the source of truth
and the Konva scene is built from it, never the other way round.

## What would reverse it

Needing the final picture somewhere a browser cannot run. Then the design
document gets a second, server-side renderer and the two must be checked
against each other.
