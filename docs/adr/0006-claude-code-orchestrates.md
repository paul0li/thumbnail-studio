# 0006 — A Claude Code session orchestrates the improvement, with no fallback

**Status:** Accepted · 2026-10-27 · Supersedes 0003

## Context

Improving a thumbnail is not one model call. It means looking at the mockup,
knowing where the faces and free areas are, deciding what the background
needs, editing it, designing the title around what is there, looking at the
result at feed size and correcting it. Recent design-agent work does exactly
this: a model plans the design as layers, a renderer draws it, and a critic
looks at the render and fixes one thing at a time, keeping only changes that
improve it.

A first test had a local vision model propose title designs. The idea held,
but the designs ignored where things were in the picture. The planning and the
judging need a stronger model.

Thumbnail Studio is for personal use: one installation, one owner, one
thumbnail a day. The owner already has a Claude plan and runs Claude Code.

ADR 0003 made a manual ChatGPT/Gemini round trip the fallback and gave the
local language model the judging. A fallback that produces a weaker result
without saying so is worse than no result: the host cannot tell it apart.

## Decision

- **The improvement is driven by a Claude Code session**, run headless by the
  backend on the machine where Thumbnail Studio runs, signed in to the
  installation owner's own Claude plan and using Opus.
- The session works through tools the backend exposes (an MCP server), not by
  editing files:
  - read the layers: where each person, face, the logo and the frame are, and
    which areas are free;
  - edit the background with the image model on the AI machine;
  - write and change the design document (ADR 0007);
  - render the design at feed size (320 px) and at full size, to look at it.
- Restoring protected layers is not a tool. It happens to every image-model
  result, whatever the session asks (ADR 0002).
- The session gets a few rounds of look-and-correct and then has to deliver.
- **There is no fallback.** If the session, Opus or the AI machine fails, the
  improvement stops and the host sees that it failed and why, in Spanish. No
  other model takes over and nothing is shown as if it were the improvement.
  The mockup the host built stays exactly as they left it.
- The image editing stays on the AI machine with mflux (ADR 0005); where that
  machine is and how to reach it is installation configuration.

## Replicating it

The repository documents the setup so anyone can run their own installation:
installing Claude Code and signing in with their own plan, the AI machine
with mflux and the model it downloads, and the environment variables that
connect them. No installation's details are part of the repository.

Each installation uses its owner's own plan. Whether automated use counts
against the plan's normal allowance or a separate credit is Anthropic's rule
to set and has changed during 2026; the setup guide points to Anthropic's
current terms instead of repeating them.

## Consequences

The improvement depends on three things being up: the owner's Claude plan,
Opus, and the AI machine. When one is not, there is no improved thumbnail
that day, visibly.

An improvement takes minutes, not seconds: the screen shows the wait and what
the session is doing.

The session's tools are the only way it can change anything, so the tools are
also where its limits are enforced.

## What would reverse it

The session failing often enough that the host stops trusting the button. Then
a fallback is worth having, but it must say on screen that it is one.
