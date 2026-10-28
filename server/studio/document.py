"""The design document (ADR 0007), checked on the way in.

The shape is `schema/design-document.schema.json`, the same file the frontend's
tests read. What a JSON Schema cannot say is checked here, with the same rules
as `web/src/document/validate.ts`: the frame is the last layer, layer ids are
unique, and the title's words are exactly what was typed. Both validators run
against the cases in `schema/cases/`, so they cannot drift apart unnoticed.
"""

import json
import re
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from studio.config import REPO_ROOT

SCHEMA_PATH = REPO_ROOT / "schema" / "design-document.schema.json"


@cache
def _schema() -> dict:
    return json.loads(Path(SCHEMA_PATH).read_text())


@cache
def _validator() -> Draft202012Validator:
    schema = _schema()
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


@cache
def _whitespace() -> re.Pattern[str]:
    return re.compile(_schema()["$defs"]["whitespace"]["const"] + "+")


def split_words(text: str) -> list[str]:
    """The words of a typed title, split like the frontend's `splitWords`."""
    return [w for w in _whitespace().split(text) if w]


def words_match_text(words: list[str], text: str) -> bool:
    """Case does not matter for the comparison; the typed casing is drawn."""
    typed = split_words(text)
    return len(typed) == len(words) and all(
        a.upper() == b.upper() for a, b in zip(typed, words, strict=True)
    )


def _path(parts) -> str:
    out = "document"
    for part in parts:
        out += f"[{part}]" if isinstance(part, int) else f".{part}"
    return out


def validate(document: Any) -> list[str]:
    """The errors in a document; empty if it can be stored."""
    errors = [
        f"{_path(e.absolute_path)}: {e.message}"
        for e in sorted(_validator().iter_errors(document), key=lambda e: list(e.absolute_path))
    ]
    if errors:
        return errors
    layers = document["layers"]
    ids: set[str] = set()
    for i, layer in enumerate(layers):
        if layer["id"] in ids:
            errors.append(f"layers[{i}].id: is repeated")
        ids.add(layer["id"])
        if layer["kind"] == "frame" and i != len(layers) - 1:
            errors.append(f"layers[{i}]: the frame must be the last layer")
        if layer["kind"] == "title" and not words_match_text(
            [w["text"] for w in layer["words"]], layer["text"]
        ):
            errors.append(
                f"layers[{i}].words: must be exactly the words of the typed title, in order"
            )
    return errors


def title_text(document: dict) -> str:
    """What the history shows as the thumbnail's name."""
    for layer in document["layers"]:
        if layer["kind"] == "title":
            return " ".join(split_words(layer["text"]))
    return ""
