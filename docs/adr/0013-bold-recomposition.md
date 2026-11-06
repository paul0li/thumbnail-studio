# 0013 — «Mejorar» recomposes the collage boldly, with the frame's area marked grey

**Status:** Accepted · 2026-11-05 · Supersedes in part 0010

## Context

Under ADR 0010 the image model got the host's collage and was asked to turn
it into one believable scene, placing the title "where it reads best". In
practice it kept the collage's arrangement: each photo where she put it, the
title where she typed it. The results were well lit but read as separate
pieces, and the host found the organisation of the information weak.

On one real thumbnail, the same scene was sent with different instructions:

- Told that the collage is a brief, not a layout, and to recompose it as a
  thumbnail designer would, the model grouped the people, made one text block
  with a clear hierarchy and added one visual cue of the story. Every variant
  read better than the one that kept the layout.
- Told in words that the bottom band would be covered by the frame, it still
  put the title's last word and the subtitle there. With the band painted on
  the scene as a plain rectangle, the text moved up but the subtitle ran into
  the frame's round badge, which rises above the band. With the frame's exact
  shape painted flat grey, the bold variant kept all the text clear.
- The bold variant enlarged faces by up to about 2.2 times. Registration
  rejected anything over 1.6, and pasting the original from the canvas-size
  copy of the photo at that scale gave a visibly blurred face. The photos
  themselves are about 2.5 times the size they are drawn at.
- The read-back looked at the result without the frame, so text hidden under
  the frame passed the check.

Choices that could have gone the other way:

- Keep the host's layout and only restyle, or let the model recompose.
- Describe the frame's area in words, send the frame itself, or mark its
  exact shape.
- Cap how much a face may grow, or restore larger faces from a better source.
- Read the text on the result, or on what the viewer sees.

## Decision

- **The collage is a brief.** The instruction asks the model to recompose
  boldly: tight crops, faces clearly bigger (up to about twice), the people
  together and slightly overlapping, one text block as large as it can be,
  at most three things to look at. The protections are unchanged: the same
  people with unchanged faces, nobody added, the title's and subtitle's words
  exactly, the lettering style.
- **The frame's area is grey in the scene sent.** Wherever the overlay is
  more than slightly opaque, the scene goes to the engine flat mid grey, and
  the instruction says those areas are hidden afterwards. The frame itself is
  still never sent. Without an overlay the scene goes as drawn. The scene
  actually sent is stored and named in the run's report.
- **Faces are restored from the person's own photo at full resolution**, warped
  straight onto the result through the layer's placement and the
  registration, shrunk by area first when it is drawn smaller. A face may
  now grow up to 2.6 times. Only eyes, nose and mouth are always pasted;
  forehead, hair and the cheeks' edge are pasted only where the result still
  shows the face. In the first end-to-end run the model put the subtitle over
  the guest's hairline and drew the guest's face a little wider than the photo, which
  is not cut out: pasting the forehead and cheeks unconditionally covered two
  letters and left a strip of the photo's own background by the cheek.
- **The text is read with the frame on.** The reader gets the scene sent and
  the final picture, frame included, and reads only letters a viewer can
  see, so a word under the frame fails the title check like a changed word.

## Consequences

Thumbnails look designed rather than assembled, and the host's collage
matters less: she chooses who and what, the model decides where. When she
wants her own arrangement kept, «Mejorar» is no longer the tool for it; her
own thumbnail stays downloadable as before.

More results fail, mostly on text under the frame, because the zone is
guidance the model can ignore. A failure costs a run, and says why.

Faces drawn larger than their photo's own resolution are upscaled; at the
photo sizes in use that starts above about 2.5 times.

## What would reverse it

The host preferring results that keep her arrangement. Then the instruction
goes back to restyling in place, and the grey zone, full-resolution faces
and read-back with the frame stay: they help either way.
