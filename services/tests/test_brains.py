from __future__ import annotations

import json

import pytest

from pipeline._proc import extract_json
from pipeline.brains.base import BrainError
from pipeline.brains.claude import ClaudeBrain
from pipeline.brains.codex import decode_strings, strictify
from pipeline.brains.kimi import agent_file_text, parse_stream
from pipeline.brains.mock import MockBrain
from pipeline.prompts import CHAT_RESPONSE_SCHEMA


def test_extract_json_from_noisy_output():
    assert extract_json('Sure!\n```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('prefix {not json} then {"b": [1, {"c": 2}]} trailing') == {"b": [1, {"c": 2}]}
    assert extract_json("no json here") is None


def test_claude_parses_structured_output():
    out = json.dumps({"type": "result", "is_error": False, "result": "", "structured_output": {"reply": "hi"}})
    assert ClaudeBrain.parse_output(out) == {"reply": "hi"}
    out = json.dumps({"type": "result", "is_error": False, "result": 'Here: {"reply": "x"}'})
    assert ClaudeBrain.parse_output(out) == {"reply": "x"}
    with pytest.raises(BrainError):
        ClaudeBrain.parse_output(json.dumps({"type": "result", "is_error": True, "result": "Not logged in"}))


def test_claude_argv_disables_tools_unless_images(tmp_path):
    b = ClaudeBrain()
    argv = b.build_argv("/bin/claude", "SYS", {"type": "object"}, [])
    assert argv[argv.index("--tools") + 1] == "" and "--json-schema" in argv and "--system-prompt" in argv
    argv = b.build_argv("/bin/claude", "SYS", {"type": "object"}, [tmp_path / "a.png"])
    assert argv[argv.index("--tools") + 1] == "Read" and str(tmp_path) in argv


def test_codex_strict_schema_round_trip():
    strict, encoded = strictify(CHAT_RESPONSE_SCHEMA)
    assert encoded == [("spec_patch",)]
    assert strict["properties"]["spec_patch"]["type"] == "string"
    assert strict["additionalProperties"] is False and set(strict["required"]) == {"reply", "spec_patch",
                                                                                 "ambiguities"}
    obj = decode_strings({"reply": "ok", "spec_patch": '{"tables": {"count": 3}}', "ambiguities": []}, encoded)
    assert obj["spec_patch"] == {"tables": {"count": 3}}


def test_kimi_stream_json_and_agent_file():
    stream = "\n".join([
        json.dumps({"role": "assistant", "content": "", "tool_calls": [{"id": "1"}]}),
        json.dumps({"role": "tool", "content": "..."}),
        json.dumps({"role": "assistant", "content": [{"type": "text", "text": '{"reply": "done"}'}]}),
        json.dumps({"type": "session.resume_hint", "session_id": "x"}),
    ])
    assert extract_json(parse_stream(stream)) == {"reply": "done"}
    assert parse_stream("• plain text {\"a\": 1}") == "• plain text {\"a\": 1}"
    text = agent_file_text("SYSTEM PROMPT", [])
    assert text.startswith("---\n") and "tools: []" in text and text.rstrip().endswith("SYSTEM PROMPT")


async def test_mock_brain_non_chat_schema_returns_defaults():
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}, "tables_seen": {"type": "integer"},
                                               "notes": {"type": "string"}}}
    assert await MockBrain().complete_json("s", "u", schema) == {"ok": True, "tables_seen": 1, "notes": ""}
