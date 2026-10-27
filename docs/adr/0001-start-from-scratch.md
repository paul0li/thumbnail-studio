# 0001 — Start from scratch in a new repository

**Status:** Accepted · 2026-10-27

## Context

A first version of this app works and is used every day, but it was built on
numbered product rules and spec-driven development (criterion id → test →
code) that became too rigid to follow and too costly to change. The centre of
the product has also moved: it is no longer assembling the thumbnail, but
improving it with AI without touching what must not change. And its history
carries installation details that a public repository should not.

## Decision

Start a new public repository, Thumbnail Studio, with no history. The previous
version stays private and keeps running until this one replaces it; lessons and
code from it are brought over when they are needed, not wholesale.

Everything in the repository is written in English; only the text the user
reads in the app is in Spanish. The repository holds no personal or
installation-specific data.

## Consequences

Until the switch there are two versions. The real photo library lives with the
previous version and will have to be migrated. Nothing in this repository can
point at the old history, so anything worth keeping is rewritten here in its
own words.

## What would reverse it

Finding, while rebuilding, that almost everything carries over as it was. Then
it is cheaper to keep developing the previous version.
