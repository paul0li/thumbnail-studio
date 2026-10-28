# 0002 — The AI works by layers; protected layers are restored, not trusted

**Status:** Accepted · 2026-10-27 · Superseded in part by 0010 (how faces are restored: the AI does move things)

## Context

The improvement pass was done by hand in ChatGPT, and ChatGPT changes the image
size, redraws the frame and sometimes changes the host's face. That is not bad
luck: these models regenerate the whole image, and even with a mask they treat
it as guidance rather than a boundary. Asking a model not to touch something is
not enough.

## Decision

The mockup is kept as layers. The AI may change the background, the light, the
colour, the effects and the styling of the title. Protected content always
ends up with the mockup's own pixels, because it is pasted back on top of the
result instead of relying on the model to obey:

- the faces of the host and the guests,
- the logo and the frame,
- the words of the title.

The title is protected in its **words**, not its styling: the AI may give it
depth, colour, glow or a plate behind it, but if any letter in the result does
not match what the user typed, the result is discarded.

The output is always 1280×720, whether the AI touched it or not, and the
mockup alone is always a valid result: if the pass fails, the user downloads
the mockup.

## Consequences

Pasting back only works if the AI did not move things: if a face shifts a few
pixels, the restored one shows double. The result has to be aligned with the
mockup before restoring, and discarded if it does not align. Lighting that the
AI changed a lot around a face can leave a visible seam.

## What would reverse it

A model that truly honours a hard mask without regenerating what lies outside
it. Restoration would then go from being the guarantee to being a safety net.
