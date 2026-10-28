import json
from pathlib import Path

import pytest

from studio.config import REPO_ROOT
from studio.document import split_words, title_text, validate

CASES = sorted((REPO_ROOT / "schema" / "cases").glob("*.json"))


def test_there_are_shared_cases_of_both_kinds():
    kinds = {json.loads(p.read_text())["valid"] for p in CASES}
    assert kinds == {True, False}


@pytest.mark.parametrize("case", CASES, ids=lambda p: p.stem)
def test_the_server_agrees_with_the_frontend_on_every_shared_case(case: Path):
    """The same files run through `validate.ts` in vitest."""
    data = json.loads(case.read_text())
    errors = validate(data["document"])
    assert (errors == []) == data["valid"], errors


def test_a_title_splits_on_the_same_spaces_as_in_the_browser():
    assert split_words(" NADIE LO　VIO﻿HOY \n") == ["NADIE", "LO", "VIO", "HOY"]
    # Python's own `\s` would split here; JavaScript's does not.
    assert split_words("A\x1cB") == ["A\x1cB"]


def test_the_history_names_a_thumbnail_by_its_title():
    case = json.loads((REPO_ROOT / "schema/cases/valid-every-layer-and-effect.json").read_text())
    assert title_text(case["document"]) == "NADIE LO VIO"
