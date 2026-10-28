# 0011 — The improved picture stays with its thumbnail

**Status:** Accepted · 2026-10-28

## Context

«Mejorar» (ADR 0010) ends on one result with «Usar esta» and «Volver atrás».
Until now only «Usar esta» left a trace in «Mis miniaturas»: closing the app
on the result screen, or downloading her own picture afterwards, made the
improved picture look lost, although the server keeps every picture of every
run. The host wants to see how it turned out and download it again.

Choices that could have gone the other way:

- Keep the improved picture only when it is chosen, or whenever a run ends
  well.
- Store a new pointer on the thumbnail, or read it from the runs.
- When she downloads her own after improving, show hers in the history or
  the improved one.

## Decision

- **A run that ends well is kept, chosen or not.** The thumbnail's improved
  picture is the final picture (with the frame) of its latest `ready` run.
  A later run that fails does not take it away; a later one that ends well
  replaces it. Downloading her own does not touch it.
- **Read from `improvements`, no new column.** Every thumbnail summary in the
  API carries `improved`: the run's id, the version it was made from, the URL
  of the stored PNG and whether it was chosen, or `null`. The PNG is the same
  content-addressed file the run stored, served as it is.
- **«Mis miniaturas» shows the improved picture** on the card, with the tag
  «✨ Mejorada», even when her own was downloaded later. Her render is still
  the card picture of a thumbnail that was never improved.
- **Tapping a thumbnail with an improved picture opens the done screen**
  showing it, with one primary button, «Descargar de nuevo», which downloads
  the stored bytes. If she edited since, it says «Mejorada antes de tus
  últimos cambios»; «Editar» and then «Mejorar» are still the way to improve
  the new version. Her own picture is one tap away under «Edición avanzada».
  A reload still opens where she left off, and a run still going, or one that
  failed while she was away, is shown before the done screen.
- «Descargar de nuevo» on the version on screen also records it as the
  download, as «Usar esta» does.

## Consequences

«Volver atrás» no longer means «forget it»: the picture stays with the
thumbnail until a newer improvement replaces it. The history loads the full
1280×720 PNG for an improved card instead of the small preview.

## What would reverse it

The host wanting to throw an improvement away, or the history getting slow on
a weak connection. Then a «Descartar» on the result, or a small preview of the
improved picture stored alongside it.
