# 0009 — Thumbnails are saved as versions on the server, with undo as a path

**Status:** Accepted · 2026-10-27

## Context

The host makes a thumbnail a day, from a phone, and may pick it up on another
device. Losing a half-made thumbnail to a closed tab, a reload or a server
that is down costs more than the edit itself: planning it again is the hard
part. ADR 0007 already says the document is versioned so every step can be
undone; until now the only copy was a draft in one browser.

Several choices could reasonably have gone the other way:

- Save on a button, or as she works.
- Keep only the latest document, store every change as a diff, or store every
  save as a full document.
- Make undo the browser's alone, or make it survive a reload.
- Let the last write win, or detect writes made on top of an old version.
- Validate on the server with its own rules, or with the frontend's.

## Decision

- **Saving is automatic.** The browser saves about 800 ms after the last
  change, at once on a step change and when the page is hidden. There is no
  save button and nothing to decide.
- **Every save is a full document, as a new version** (`thumbnail_versions`).
  Documents are a few kilobytes; diffs would save little and make every read
  a replay.
- **Each version points at the version one undo step back** (`parent`), not at
  the previous number. Undoing and then saving appends a new version whose
  parent is the parent of the state it went back to. Walking `parent` from the
  head is the undo history, which the browser loads when it opens a
  thumbnail. Version numbers only grow, so they also detect stale writes.
- **Only the head's undo path is kept, 60 steps deep.** Older versions and
  versions that left the path (undone and never returned to) are deleted on
  each save.
- **A save names the version it was based on.** If the thumbnail moved on
  meanwhile, the server refuses it with the current version, and the host is
  told in Spanish and chooses: see the newer one, or save hers on top. Nothing
  is overwritten silently. For one user this is enough; there is no merging.
- **The device keeps a copy until the server confirms it**, so a server that
  is down, or a reload while it is down, loses nothing. The host sees that it
  is not saved yet, and it is saved when the server answers.
- **Thumbnail ids are chosen by the browser**, so a thumbnail started while
  the server is unreachable is created with the same id when it comes back.
- **The server validates with the same rules as the frontend.** The shape is
  a JSON Schema in `schema/`; the few rules a schema cannot say are code on
  both sides, and both run against the same cases in `schema/cases/`.
- **The browser's render is the picture in the history**: a small preview
  after saving, and the 1280×720 PNG when she downloads (ADR 0005: the browser
  is the only renderer).

## Consequences

Undo after a reload goes back one save at a time, not one gesture at a time:
several quick changes saved together are one step.

A thumbnail opened from the device's copy while the server is down has no
undo history until the server answers again.

The history pictures are as fresh as the last preview the browser sent; a
thumbnail never opened since a change keeps its older picture.

Two schemas of the same thing (TypeScript types and the JSON Schema) must
change together; the shared cases and the vocabulary checks in
`web/src/document/schema.test.ts` fail when they drift.

## What would reverse it

More than one person editing the same thumbnail at once. Then refusing stale
saves becomes annoying instead of safe, and the document needs merging.
