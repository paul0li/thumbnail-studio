# 0008 — The daily thumbnail is a guided routine; fine editing is tucked away

**Status:** Accepted · 2026-10-27

## Context

The host makes one thumbnail a day and almost always does the same thing:
the same host photo, one or two guests, a background, a title, the show's
frame. Planning, sequencing and choosing among many options cost more than
the edits themselves. An editor that shows every preset, colour and effect
at once asks for decisions nobody needs to make on a normal day. The
previous tool the host used was a short guided flow, and that worked.

## Decision

- The editor is four steps, one question each: host, guests (optional),
  background, title. Progress is always visible, the next step is the one
  primary button, and «Deshacer» is always in the bottom bar. Downloading
  ends on a «done» screen from which the next day starts.
- A new thumbnail starts from the routine: the last frame and logo (or the
  newest ones in the library), the last host, and the brand title style
  («Marca»: white letters, dark edge, red accent bar). Nothing needs to be
  chosen for it to look like the show.
- A person carries a `slot` (host or guest) that decides where a new photo
  lands, so placing people is a tap, not a drag.
- Everything else (presets, per-word colours and boxes, effects, size and
  order buttons, mirroring, frame and logo choice) stays in the document and
  the UI, inside an «Edición avanzada» section that starts closed.

## Consequences

Fewer things are one tap away, and the host's routine is fixed in code: a
show with a different layout needs different slot positions. The document
gains two fields (`slot` on people, `accent` on the title).

## What would reverse it

The host wanting to vary the layout often, or a second user with a
different routine. Then the routine becomes a saved template instead of
code.
