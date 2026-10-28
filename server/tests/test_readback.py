"""The read-back through a stand-in for `claude`: a small script that answers
like `claude -p --output-format json` does. The real CLI is never run here."""

import json
import sys
from pathlib import Path

import pytest

from studio.readback import ClaudeCodeReader, ReadbackError, parse

FAKE_CLAUDE = """
import json, os, sys
argv = sys.argv[1:]
record = {"argv": argv, "cwd": os.getcwd(), "files": sorted(os.listdir(".")),
          "openai_key_seen": "OPENAI_API_KEY" in os.environ}
open(os.environ["FAKE_RECORD"], "w").write(json.dumps(record))
mode = os.environ.get("FAKE_MODE", "ok")
if mode == "fail":
    sys.stderr.write("not signed in")
    sys.exit(1)
if mode == "garbage":
    print("hello")
    sys.exit(0)
answer = {"title": "NADIE LO VIO", "added_people": False, "notes": "ok"}
print(json.dumps({"type": "result", "is_error": False, "result": json.dumps(answer),
                  "structured_output": answer}))
"""


@pytest.fixture
def fake(tmp_path, monkeypatch):
    script = tmp_path / "fake_claude.py"
    script.write_text(FAKE_CLAUDE)
    record = tmp_path / "record.json"
    monkeypatch.setenv("FAKE_RECORD", str(record))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-reach-claude")
    reader = ClaudeCodeReader(command=f"{sys.executable} {script}", model="opus", timeout=30)
    return reader, record


def test_the_reader_runs_claude_with_only_the_two_images_and_the_read_tool(fake):
    reader, record = fake
    reading = reader.read(b"scene", b"result")
    assert reading.title == "NADIE LO VIO"
    assert reading.added_people is False
    seen = json.loads(record.read_text())
    assert seen["files"] == ["result.png", "scene.png"]
    argv = seen["argv"]
    assert argv[argv.index("--tools") + 1] == "Read"
    assert argv[argv.index("--output-format") + 1] == "json"
    assert json.loads(argv[argv.index("--json-schema") + 1])["required"] == [
        "title",
        "added_people",
        "notes",
    ]
    assert "-p" in argv
    # The image engine's key never reaches the session; nothing secret is on
    # the command line.
    assert seen["openai_key_seen"] is False
    assert not any("sk-" in a for a in argv)
    # The folder is gone afterwards.
    assert not Path(seen["cwd"]).exists()


def test_a_missing_claude_command_is_a_clear_failure():
    with pytest.raises(ReadbackError) as raised:
        ClaudeCodeReader(command="definitely-not-installed-claude").read(b"s", b"r")
    assert raised.value.code == "missing"
    assert "Claude Code" in raised.value.reason


def test_claude_failing_is_a_failure(fake, monkeypatch):
    reader, _ = fake
    monkeypatch.setenv("FAKE_MODE", "fail")
    with pytest.raises(ReadbackError) as raised:
        reader.read(b"s", b"r")
    assert raised.value.code == "claude_error"


def test_an_answer_that_is_not_the_json_asked_for_is_a_failure(fake, monkeypatch):
    reader, _ = fake
    monkeypatch.setenv("FAKE_MODE", "garbage")
    with pytest.raises(ReadbackError) as raised:
        reader.read(b"s", b"r")
    assert raised.value.code == "bad_output"


def test_parse_takes_the_structured_output_or_the_result_text():
    answer = {"title": "A", "added_people": True, "notes": ""}
    assert parse(json.dumps({"structured_output": answer})).added_people is True
    assert parse(json.dumps({"result": json.dumps(answer)})).title == "A"
    with pytest.raises(ReadbackError):
        parse(json.dumps({"is_error": True, "result": "rate limited"}))
    with pytest.raises(ReadbackError):
        parse(json.dumps({"structured_output": {"title": "A"}}))
