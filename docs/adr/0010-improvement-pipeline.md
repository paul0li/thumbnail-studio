# 0010 — «Mejorar» sends the scene, restores faces by registration, checks, and pastes the frame last

**Status:** Accepted · 2026-10-28 · Supersedes in part 0002

## Context

ADR 0002 restores protected layers by pasting them back where they were, and
says so only works if the AI does not move things. Trying image models by hand
on real thumbnails showed that they do move things: the most cohesive result
moved people by about 100 px and scaled them by about 12 %, completing bodies
and reframing the shot. Pasting faces at their old place would show them
twice. Another model kept the title's words but invented a new person, a
crying child, in place of someone half hidden in the collage. Nothing in the
picture says that went wrong unless something looks.

The same trials showed what to send: the scene (background, people and a plain
title), never the frame. A model handed the frame redraws it, and the frame
and logo carry the show's name.

Choices that could have gone the other way:

- One improvement per step, or one at the end.
- Send the whole thumbnail, or the scene without frame and logo.
- Paste faces at their place and reject results that moved, or find where
  they went.
- Trust the model about added people and the title, or check.
- Run in the request, or in the background.

## Decision

- **One «Mejorar» at the end of the routine**, after the title, as its one
  primary button. It shows one result, and two buttons: «Usar esta» and
  «Quedarme con la mía».
- **What goes to the engine is the scene**: the background, the people and
  the title in its plain style (every word alike, as a new thumbnail draws
  it), drawn by the browser from the same Konva scene (ADR 0005). The frame
  and the logo are drawn apart, as a transparent overlay, and are never sent.
  The engine may restyle everything else, the title included, extend bodies,
  relight and reframe.
- **The engine is an interface** (`ImageEngine`: a PNG and an instruction in,
  one image out) so a local engine on the AI machine (mflux, ADR 0005) can be
  added without touching the rest. The first implementation is OpenAI's Images
  API edit endpoint with `gpt-image-2`, quality `high`, size `1536x864`,
  configurable. The instruction is a fixed template for now.
- **After the engine, the same steps for any engine**, on the server:
  1. Fit the answer to 1280×720 (cover, centred).
  2. **Restore faces by registration.** Face boxes come from the layers: each
     person's cutout is searched with a face detector (YuNet, through OpenCV)
     and the boxes are mapped through the layer's placement in the document.
     A face mostly under another layer, or off the canvas, is not protected.
     Each protected face is registered onto the result: SIFT features around
     the face in the scene that was sent, matched against the result, a
     similarity transform fitted with RANSAC. The original face is warped by
     it, its colour moved 80 % of the way to the result's (mean and spread per
     channel in Lab) and pasted inside a feathered ellipse. A face that cannot
     be registered confidently (too few matches or inliers, an implausible
     scale, or gradients that do not agree once warped) **rejects the result**:
     it is never shipped with a face that is not hers.
  3. **No added people.** Faces the detector finds in the result that are not a
     restored face, not a person of the layers (hidden ones included) and not
     a face it also finds in the scene (allowing for the reframing measured on
     the faces) count as added, if they are confident and at least 60 % of the
     people's median face height. Background illustrations have faces too;
     most are smaller, and the large ones were already in the scene.
  4. **The title's words, exactly**, and a second opinion on people: a
     headless Claude Code call (`claude -p`, the Read tool only, in a
     temporary folder with the two images) answers in strict JSON with the
     title it reads and whether anyone was added. Case is styling; accents and
     Ñ are letters. If `claude` is missing or fails, the check fails.
  5. **The overlay last**: the frame and logo, as the browser drew them, pasted
     on top. That is the picture she sees.
- **Any failure is the result** (ADR 0006): no key, network, engine error, a
  face that cannot be restored, a failed check. She reads why, in Spanish, and
  her own thumbnail stays as it is and downloadable. Nothing is shown as if it
  were the improvement.
- **It runs in the background**, one at a time, and the browser asks how it is
  going. The wait lists the steps in order with the time taken, no
  percentage. A run left running by a server that stopped is marked failed.
- **Every picture is kept**, content-addressed and linked to the version it
  was made from: the scene sent, the overlay, the raw answer, the restored
  result and the final. «Usar esta» makes the final the thumbnail's download
  and its picture in «Mis miniaturas»; it is refused if the thumbnail changed
  since.

## What it costs

OpenAI's published prices on 2026-10-28, for `gpt-image-2`: $0.165 per
1536×1024 image at `high` ($0.041 at `medium`, $0.005 at `low`), with image
input at $8 and text input at $5 per million tokens. A 1536×864 output is a
little smaller than 1536×1024, and the scene sent is always read at high
fidelity, so one improvement is about **$0.15–0.20 at `high`** and about
$0.05 at `medium`. The read-back is one Opus call on the owner's Claude plan
(about $0.12 at list price per call, measured).

## Consequences

ADR 0002 still holds for what is protected and why. What changes is how: faces
are found where they went instead of being expected where they were, and the
title is checked by reading it back rather than by keeping it out of the
model. The frame and logo are protected by never being sent.

The checks are tuned on few real results. The added-person check can be fooled
by an added face that is small, or that lands where a hidden person was; the
read-back is the second line for those. A real person drawn in the background
illustration who is enlarged by the model would count as added.

The improvement needs three things up: the engine's account, the network, and
Claude Code on the server. When one is down, there is no improvement that day,
visibly.

## What would reverse it

A model that keeps faces, the title and the framing reliably. Restoration and
the face checks would then become a safety net instead of the guarantee. Or
results rejected so often that the button loses her trust: then the checks
need loosening or the engine changing, not a fallback.
