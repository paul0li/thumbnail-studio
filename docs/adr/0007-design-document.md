# 0007 — A thumbnail is a layered design document with Figma-style effects

**Status:** Accepted · 2026-10-27

## Context

The orchestrator (ADR 0006), the canvas (ADR 0005) and the host all change
the same thumbnail. They need one description of it that all three can read
and write. Generative design systems such as COLE, OpenCOLE, PosterLLaVa and
Graphist share this shape: a model writes the design as structured layers,
and a renderer draws it.

The effects that make thumbnails stand out (shadows, glow, outlines, a box
behind a word, words of different sizes, text behind a person, a rim of
light around someone) are well-defined, small vocabularies in design tools:
Figma has drop shadow, inner shadow, layer blur and background blur, each with
colour, offset, blur and spread; Canva names presets such as Shadow, Lift,
Hollow, Neon, Echo, Splice and Background.

## Decision

A thumbnail is a JSON design document: an ordered list of layers on a
1280×720 canvas.

- **Layers** are the background, each person, the logo, the frame and the
  title. Each has a position, size, order and flips.
- **The title is made of words.** Each word has its own size, fill (a colour
  or a gradient), optional box behind it, and line break; lines may tilt.
  The words, in order, are exactly what the host typed. A document whose words
  differ is rejected when it is written, not after it is drawn.
- **Effects follow Figma's model**: a list per layer of drop shadows, inner
  shadows and blurs, plus glow and outline, each with its own parameters.
  Named presets in Canva's style ("neon", "red box", "echo") expand to those
  effects, so the orchestrator and the host can say a name and still adjust
  the details.
- **People can carry effects too** (glow, rim light, a halo behind them), drawn
  around their cutout, never on their pixels.
- **Protected layers cannot be repainted through the document.** The document
  can move, order and decorate them; their pixels always come from the
  library or, after an AI edit, from the restoration (ADR 0002).

The canvas builds its scene from the document; the orchestrator changes the
thumbnail only by writing the document; the host's gestures write the same
document. The document is versioned with the project, so every step can be
undone.

## Consequences

The schema is the contract between three writers and has to be versioned and
validated. Effects are limited to what the renderer can draw; a new effect
means a schema change and renderer code, not a prompt.

Because the title is always drawn from its words, a letter can never change
by accident, and checking the title is a comparison of strings, not reading
pixels back.

## What would reverse it

Wanting effects no layered renderer can draw, such as letters that blend into
the scene as the image model paints it. Then the title would have to go
through the image model and be checked by reading it back.
