# 0015 — A failed check warns; the host decides

**Status:** Accepted · 2026-11-27

## Context

«Mejorar» (ADR 0010) checks the final picture: nobody added (a face detector
and the read-back), and the words of the title and subtitle exactly as typed
(the read-back, ADR 0006). Until now any of those checks failing threw the
picture away: the host saw «No se pudo mejorar» and the reason, never the
picture.

The checks are wrong often enough to cost good pictures. A background with
people in it (a film still, say) is not a person layer, so when the model
turns those people into crisp cutouts the detector counts them as added. The
host is the one who knows whether the picture is right (ADR 0004), and she
asked to judge it herself.

Choices that could have gone the other way:

- Keep discarding, and make the checks smarter.
- Show the picture with a warning, or only offer it behind a second tap.
- Treat a reader that cannot answer as a failure, or as a warning.
- Make a warned picture the thumbnail's improved picture (ADR 0011) at once,
  or only once she uses it.

## Decision

- **The checks warn, they do not discard.** When the detector sees an added
  face, the read-back sees an added person, or the title or subtitle reads
  differently, the run still ends `ready` with its final picture. `failure`
  holds the codes and `reason` the sentences the host reads; the API also
  gives that sentence as `warning`. All checks run, so every problem found
  is said at once.
- **A reader that cannot answer is a warning too**: the picture is shown with
  «No se revisaron el título ni las personas».
- **The result screen says it first.** With a warning, its heading is
  «Revísala antes de usarla» and the warning is a highlighted note above the
  picture; «Usar esta» and «Volver atrás» are the same as for any result.
- **A warned picture is hers only once she uses it.** It does not become the
  thumbnail's improved picture in «Mis miniaturas» until she taps «Usar
  esta». Reopening the thumbnail while the warned result is the last thing
  she saw shows it again.
- **What still fails outright**: anything before the checks, and a face that
  cannot be restored. The faces are the one thing the improvement must never
  change (ADR 0002), and an unrestored face means the picture shows someone
  the model drew.

## Consequences

- No good picture is lost to a check that was wrong; a wrong picture can
  now reach the phone if she does not look. The warning is what stands
  between the two.
- ADR 0010's «any failure on the way is the result» now holds only up to the
  checks.

## What would reverse it

Checks reliable enough that a failure is nearly always right, or the host
using warned pictures she later regrets.
