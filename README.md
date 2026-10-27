# Thumbnail Studio

YouTube thumbnails for a show, made easily from a phone.

## What it does

The show's host builds the thumbnail mockup: picks the photos, places them and
types the title. It is quick and it is theirs: the mockup is the intent.

Then an AI improves it **layer by layer**. It works on top of the mockup rather
than replacing it, and it does not touch what must stay the same:

- the faces of the host and the guests,
- the logo and the frame,
- the words of the title (their styling may change).

Everything else is the AI's to change: the background, the light, the colour,
the effects, how the title stands out. What it has to deliver is a cohesive
thumbnail that does two things:

1. **Makes people want to click** when they browse YouTube on a phone, where a
   thumbnail is small and surrounded by others.
2. **Is recognisable at first sight**: anyone who knows the show must be sure
   it is one of its episodes.

The second is as much part of the job as the first. An eye-catching thumbnail
that does not look like the show is a wrong one.

## Where it runs

On devices connected through a Tailscale tailnet: only devices in the tailnet
can reach it, with no accounts or passwords. The AI runs on a separate machine
in the same tailnet.

## Documentation

- [`AGENTS.md`](AGENTS.md): how to work in this repository.
- [`docs/adr/`](docs/adr/): the decisions behind the product and the code.
