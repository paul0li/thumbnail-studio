# 0014 — The show's template is fixed; «Mejorar» keeps it, is minimalist, and is free only with the title

**Status:** Accepted · 2026-11-17 · Supersedes in part 0013

## Context

Under ADR 0013 the model was asked to recompose the collage boldly: vivid
background, rim light, one visual cue of the story. The host found the
results too busy and wanted the calm look of thumbnails from comparable
shows: one row of people in front of a quiet background, one title.

The image model is not the problem: it does what the instruction asks, and
the instruction asked for bold. The same model, `gpt-image-2`, was tried on
two real thumbnails with a different brief:

- Given a fixed layout (title centred at the top, the guest on the left, the
  host on the right, each with a thin white outline) and told to keep it and
  make it minimalist, it kept the layout, softened and darkened the
  background, added nothing and kept the words exact. It enlarged the people
  by about a third, which the host liked, and softened the outline, which
  the host also liked. In one result it dropped the host's microphone.
- Allowed to be bold with the title only, it enlarged and coloured the one
  or two words that carry the story (yellow or the show's coral) and kept
  everything else calm. In that run it dropped one of the two people in a
  guest photo that showed two.
- Sent each person's own photo after the scene, labelled in the instruction
  by order ("Image 2, a guest on the left, two people"), it kept both
  people and the microphone.

Choices that could have gone the other way:

- Let the model recompose, or fix the layout and let it restyle in place.
- Leave the title plain, or let the model choose what to emphasise.
- Describe the people in words only, or also send their photos.
- Keep people in front of the title by instruction, or by drawing the title
  ourselves and pasting the people over it.

## Decision

- **The template is deterministic.** A new thumbnail starts with the title
  centred at the top. Guests go on the left and the host on the right, as
  before, and every person now starts with a thin, hard white outline
  (5 px). A centred title stays centred as it is typed; once the host moves
  it, it stays where she put it. The subtitle follows the title's
  alignment.
- **The instruction keeps the template and is minimalist.** Same people,
  same sides, the title at the top; a calmer, slightly darker, softly
  blurred background; no added objects, effects or text. People may grow
  somewhat. They are always in front of the title, and the model must return
  exactly as many people as the scene shows.
- **The title is the one place for boldness.** The model picks the one or
  two words that carry the story and makes them bigger or highlights them
  (the show's coral, a warm yellow, or a coral box), in flat colours. The
  words themselves are still checked letter by letter.
- **Each person's own photo goes with the scene**, after it: the guests from
  left to right, then the host, each at most 1024 px, labelled in the
  instruction by its position in the list, with how many faces it shows.
  The engine's `edit` takes these as `references`.

The grey zone for the frame, face restoration by registration, and the
read-back with the frame on are unchanged.

## Consequences

The host's thumbnails all share one recognisable layout, and «Mejorar»
changes the look, not the arrangement. Thumbnails made before this keep
their left-aligned title.

People in front of the title is asked for, not enforced: the model may
still put a letter over hair. The title check still fails a result whose
words are hidden.

Each run sends one extra image per person, which costs a little more per
call.

## What would reverse it

The host wanting a different arrangement per episode: then the template
becomes a starting point again and the instruction goes back to
recomposing. If people in front of the title must be guaranteed, the model
returns a picture without text, the app draws the title, and the people are
cut out of the result and pasted over it.
