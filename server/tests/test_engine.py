"""The OpenAI engine without the network: `urlopen` is replaced, so these
tests check what would be sent and how every answer is read."""

import base64
import io
import json
import urllib.error

import pytest

from studio import engine as engine_module
from studio.app import build_engine
from studio.config import Settings
from studio.engine import EngineError, OpenAIImages

KEY = "sk-test-not-a-real-key-0123456789"


class Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def sent(monkeypatch):
    calls = []

    def respond_with(payload=None, error=None):
        def urlopen(request, timeout):
            calls.append({"request": request, "timeout": timeout})
            if error:
                raise error
            return Answer(json.dumps(payload).encode())

        monkeypatch.setattr(engine_module.urllib.request, "urlopen", urlopen)
        return calls

    return respond_with


def ok(data=b"\x89PNG fake"):
    return {"data": [{"b64_json": base64.b64encode(data).decode()}], "size": "1536x864"}


def http_error(status, body):
    return urllib.error.HTTPError(
        engine_module.OPENAI_EDITS_URL, status, "error", {}, io.BytesIO(json.dumps(body).encode())
    )


def test_the_edit_sends_the_scene_the_prompt_and_a_16_9_size(sent):
    calls = sent(ok(b"result"))
    result = OpenAIImages(api_key=KEY, timeout=12).edit(b"scene-bytes", "make it cinematic")
    assert result.data == b"result"
    assert result.info["model"] == "gpt-image-2"
    (call,) = calls
    request = call["request"]
    assert call["timeout"] == 12
    assert request.full_url == "https://api.openai.com/v1/images/edits"
    assert request.get_header("Authorization") == f"Bearer {KEY}"
    body = json.loads(request.data)
    assert body["prompt"] == "make it cinematic"
    assert body["size"] == "1536x864"
    assert body["quality"] == "high"
    assert body["n"] == 1
    assert (
        body["images"][0]["image_url"]
        == "data:image/png;base64," + base64.b64encode(b"scene-bytes").decode()
    )
    # gpt-image-2 refuses input_fidelity; older models need it to keep faces.
    assert "input_fidelity" not in body
    older = OpenAIImages(api_key=KEY, model="gpt-image-1.5")._body(b"x", "p")
    assert older["input_fidelity"] == "high"
    # The key is not in the engine's repr either (it could end up in a log).
    assert KEY not in repr(OpenAIImages(api_key=KEY))


def test_without_a_key_nothing_is_sent(sent):
    calls = sent(ok())
    with pytest.raises(EngineError) as raised:
        OpenAIImages(api_key=None).edit(b"scene", "p")
    assert raised.value.code == "not_configured"
    assert calls == []


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "unauthorized"),
        (403, "forbidden"),
        (429, "rate_limited"),
        (400, "bad_request"),
        (500, "engine_error"),
    ],
)
def test_each_http_error_has_its_own_reason_and_never_carries_the_key(sent, status, code):
    sent(error=http_error(status, {"error": {"type": "x", "message": "something went wrong"}}))
    with pytest.raises(EngineError) as raised:
        OpenAIImages(api_key=KEY).edit(b"scene", "p")
    error = raised.value
    assert error.code == code
    assert error.reason and error.reason[0].isupper()
    for text in (error.reason, error.detail, str(error)):
        assert KEY not in text


def test_a_moderation_refusal_says_so(sent):
    sent(error=http_error(400, {"error": {"code": "moderation_blocked", "message": "blocked"}}))
    with pytest.raises(EngineError) as raised:
        OpenAIImages(api_key=KEY).edit(b"scene", "p")
    assert raised.value.code == "refused"


def test_a_timeout_and_a_network_error_are_told_apart(sent):
    sent(error=TimeoutError("timed out"))
    with pytest.raises(EngineError) as raised:
        OpenAIImages(api_key=KEY).edit(b"scene", "p")
    assert raised.value.code == "timeout"
    sent(error=urllib.error.URLError(OSError("no route to host")))
    with pytest.raises(EngineError) as raised:
        OpenAIImages(api_key=KEY).edit(b"scene", "p")
    assert raised.value.code == "network"


def test_an_answer_without_an_image_is_an_error(sent):
    sent({"data": []})
    with pytest.raises(EngineError) as raised:
        OpenAIImages(api_key=KEY).edit(b"scene", "p")
    assert raised.value.code == "bad_response"


def test_the_key_comes_from_openais_own_variable_and_is_not_shown(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENAI_API_KEY", KEY)
    monkeypatch.setenv("STUDIO_OPENAI_IMAGE_QUALITY", "medium")
    settings = Settings(_env_file=None, data_dir=tmp_path)
    assert KEY not in repr(settings)
    built = build_engine(settings)
    assert built.configured
    assert built.quality == "medium"
    monkeypatch.delenv("OPENAI_API_KEY")
    assert not build_engine(Settings(_env_file=None, data_dir=tmp_path)).configured
