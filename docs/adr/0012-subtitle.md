# 0012 — An optional subtitle is a second text layer, restyled and checked like the title

**Status:** Accepted · 2026-11-05

## Context

The host wants a second, smaller line of text under the title: the guest's
name, the topic, a hook. Until now a thumbnail had at most one text layer, the
title, and «Mejorar» (ADR 0010) checked its words letter by letter.

Choices that could have gone the other way:

- A subtitle that belongs to the title (one block that moves and scales
  together), or a layer of its own.
- A subtitle the AI never sees, pasted on top afterwards like the frame and
  the logo, or one the AI restyles with the title.

## Decision

- **A layer of its own, kind `subtitle`, at most one.** It has exactly the
  title's shape (typed text, words with their sizes, fills and boxes,
  alignment, place, scale, effects, preset) and the same rule: its words are
  exactly what was typed. It is moved, pinched, styled and reordered like the
  title, independently of it. Existing documents stay valid: the subtitle is
  optional and absent until the host types one.
- **Typing creates it, clearing it removes it.** The «Título» step has a
  «Subtítulo» field under the title's. The first word places it just under
  the title (and its accent bar), left-aligned with it, at about half the
  title's size, in the brand's effects without the accent bar, which stays the
  title's. Its own «Edición avanzada del subtítulo» holds the same controls as
  the title's.
- **The AI restyles it.** The scene sent to the engine has the subtitle in its
  plain style, like the title. The prompt mentions a subtitle only when there
  is one, and asks for its words exactly, smaller than the title.
- **Its words are checked.** The Claude Code reader answers a `subtitle` too.
  The result passes if the title and the subtitle each read as typed, or if
  the two read together, in order, match the two typed together: where one
  line ends and the other starts is styling, not a changed word. Otherwise
  the failure says which one changed (`title_changed` or `subtitle_changed`)
  and what is read. With no subtitle typed, whatever the reader takes for one
  is ignored, as before.

## Consequences

The document's JSON Schema, `types.ts`, `validate.ts` and the server's checks
know a fifth layer kind; a document with a subtitle cannot be opened by an
older build. Each improvement with a subtitle has one more thing the AI can
get wrong, and so one more way to fail visibly. The history's name for a
thumbnail is still its title alone.

## What would reverse it

The AI dropping or garbling the subtitle often enough that improvements with
one rarely succeed: then the subtitle is pasted on top after the AI, like the
frame and the logo. Or the host always placing it right under the title: then
it becomes part of the title's block.
