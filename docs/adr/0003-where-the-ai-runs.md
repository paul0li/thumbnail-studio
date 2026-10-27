# 0003 — The AI runs on a separate machine, with a manual fallback

**Status:** Accepted · 2026-10-27

## Context

It has to be free. One thumbnail is made a day, five days a week. A separate
Apple Silicon machine in the tailnet, with far more memory than the one that
runs Thumbnail Studio, is reachable over an API. So far the improvement pass has been
done by hand in ChatGPT, which is free.

## Decision

The normal path is an open image-editing model running on that AI machine:
Thumbnail Studio sends it the mockup and what it may change, and gets the result back
with nobody carrying files around. With a local model the mask can also be a
real hard mask.

The fallback is today's routine: Thumbnail Studio prepares the image for ChatGPT or
Gemini, the user sends it by hand, and when they upload the answer Thumbnail Studio
repairs it exactly as it does the AI machine's (back to 1280×720, aligned,
protected layers restored).

Where the AI machine is and how to reach it is installation configuration
(environment variables), never part of the repository.

## What the AI machine has

Checked on 2026-10-27: an M4 Pro with 48 GB of unified memory (about 36 GB
usable by the GPU), shared with other services. Its only API is Ollama, serving
a vision-capable language model of about 16 GB.

Ollama can generate images on macOS but cannot edit one, so the editing model
needs its own runtime. While the language model is loaded roughly 20 GB are
left, which means a quantised editing model, not a full-precision one.

The language model is still useful as it is: it can read the title back from a
result, write the instruction for the editing model, and judge whether a result
reads at feed size.

## Open

Which runtime and model to install for editing. The machine is shared, so that
needs its owner's consent.

## Consequences

A local model takes seconds to minutes per image, so the improvement is a real
wait and the screen has to show it. If the AI machine is off, only the fallback
is left.

## What would reverse it

The local model's quality falling clearly below ChatGPT's or Gemini's. The
fallback then becomes the normal path.
