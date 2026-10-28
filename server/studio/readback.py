"""Reading the result back with a headless Claude Code session (ADR 0006, 0010).

The image model may restyle the title but not change a letter of it, and may
not add anyone. Pixels cannot say which letters are drawn, so a Claude Code
session looks at the result and answers in strict JSON: the title it reads,
and whether a person or face was added. The session runs on the
installation's own Claude Code sign-in, in an empty temporary folder holding
only the two images, with the Read tool and nothing else.

If the `claude` command is missing, fails, times out or answers something
that is not that JSON, the check fails, and so does the improvement: there is
no other reader to fall back on.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "added_people": {"type": "boolean"},
        "notes": {"type": "string"},
    },
    "required": ["title", "added_people", "notes"],
    "additionalProperties": False,
}

PROMPT = """You are checking an AI-edited YouTube thumbnail before anyone sees it.

Read the two images in this folder with the Read tool:
- ./scene.png is what was sent to the image model: a collage of photos of real
  people over a background, with a title.
- ./result.png is what came back.

Answer only with JSON matching the schema:
- "title": the title text exactly as drawn in result.png, every word in reading
  order, separated by single spaces, letter by letter, including accents and Ñ.
  Read what is drawn, not what scene.png says. Ignore any small text that is
  part of a photo or the background (a microphone brand, a sign). If there is
  no title, use "".
- "added_people": true if result.png shows any person or human face that is
  not in scene.png: someone new, someone duplicated, or a person replaced by a
  different one. Characters, masks and monsters from the background
  illustration, redrawn or restyled, are not added people. People from
  scene.png who were moved, rescaled, relit or had their bodies extended are
  not added people.
- "notes": one or two sentences on what you saw, in English.
"""


class ReadbackError(Exception):
    """The reader could not answer. `reason` is for the host, in Spanish."""

    def __init__(self, code: str, reason: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class Reading:
    title: str
    added_people: bool
    notes: str

    def as_json(self) -> dict:
        return {"title": self.title, "added_people": self.added_people, "notes": self.notes}


class TitleReader(Protocol):
    def read(self, scene_png: bytes, result_png: bytes) -> Reading: ...


def parse(stdout: str) -> Reading:
    """The `--output-format json` envelope of `claude -p`, with the answer in
    `structured_output` (or, failing that, `result` as a JSON string)."""
    try:
        envelope = json.loads(stdout)
    except ValueError:
        raise ReadbackError("bad_output", _BAD, "not json") from None
    if not isinstance(envelope, dict) or envelope.get("is_error"):
        raise ReadbackError("claude_error", _FAILED, str(envelope.get("result", ""))[:300])
    answer = envelope.get("structured_output")
    if answer is None and isinstance(envelope.get("result"), str):
        try:
            answer = json.loads(envelope["result"])
        except ValueError:
            answer = None
    if (
        not isinstance(answer, dict)
        or not isinstance(answer.get("title"), str)
        or not isinstance(answer.get("added_people"), bool)
    ):
        raise ReadbackError("bad_output", _BAD, "answer does not match the schema")
    return Reading(answer["title"], answer["added_people"], str(answer.get("notes", "")))


_FAILED = "La revisión con Claude no funcionó."
_BAD = "La revisión con Claude respondió algo que no se entiende."


@dataclass
class ClaudeCodeReader:
    """`claude -p` with the images in a fresh temporary folder. `command` is
    split like a shell would (it may be a path, or a wrapper); nothing secret
    is ever put on the command line, and the image engine's key is removed
    from the child's environment."""

    command: str = "claude"
    model: str = "opus"
    timeout: float = 180.0

    def argv(self) -> list[str]:
        return [
            *shlex.split(self.command),
            "-p",
            PROMPT,
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(SCHEMA),
            "--model",
            self.model,
            "--tools",
            "Read",
            "--allowedTools",
            "Read",
            "--strict-mcp-config",
            "--no-session-persistence",
        ]

    def read(self, scene_png: bytes, result_png: bytes) -> Reading:
        argv = self.argv()
        if shutil.which(argv[0]) is None:
            raise ReadbackError(
                "missing",
                "No está instalado Claude Code en el servidor, y hace falta para revisar el "
                "resultado.",
            )
        env = {k: v for k, v in os.environ.items() if k != "OPENAI_API_KEY"}
        with tempfile.TemporaryDirectory(prefix="studio-readback-") as folder:
            Path(folder, "scene.png").write_bytes(scene_png)
            Path(folder, "result.png").write_bytes(result_png)
            try:
                done = subprocess.run(
                    argv,
                    cwd=folder,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                    stdin=subprocess.DEVNULL,
                )
            except subprocess.TimeoutExpired:
                raise ReadbackError(
                    "timeout", "La revisión con Claude tardó demasiado.", f"{self.timeout}s"
                ) from None
            except OSError as exc:
                raise ReadbackError("missing", _FAILED, str(exc)) from None
        if done.returncode != 0:
            raise ReadbackError(
                "claude_error", _FAILED, f"exit {done.returncode}: {done.stderr[-300:]}"
            )
        return parse(done.stdout)
