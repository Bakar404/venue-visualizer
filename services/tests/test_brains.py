from __future__ import annotations

import json

import pytest

from pipeline._proc import extract_json
from pipeline.brains.base import BrainError
from pipeline.brains.claude import ClaudeBrain, stage_images
from pipeline.brains.codex import CodexBrain, decode_strings, strictify
from pipeline.brains.copilot import CopilotBrain
from pipeline.brains.kimi import agent_file_text, agent_tools, parse_stream
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
    assert argv[argv.index("--tools") + 1] == "Read"
    assert argv[argv.index("--allowed-tools") + 1] == "Read(./**)" and "--add-dir" not in argv


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


def test_claude_web_flag_enables_only_web_tools(tmp_path):
    b = ClaudeBrain()
    argv = b.build_argv("/bin/claude", "SYS", {"type": "object"}, [], web=True)
    assert argv[argv.index("--tools") + 1] == "WebSearch,WebFetch"
    assert argv[argv.index("--allowed-tools") + 1] == "WebSearch,WebFetch"
    assert argv[argv.index("--permission-mode") + 1] == "dontAsk"
    argv = b.build_argv("/bin/claude", "SYS", {"type": "object"}, [tmp_path / "a.png"], web=True)
    assert argv[argv.index("--tools") + 1] == "WebSearch,WebFetch,Read"
    assert "Bash" not in " ".join(argv)


def test_copilot_web_flag_argv(tmp_path):
    b = CopilotBrain()
    plain = b.build_argv("/bin/copilot", "PROMPT", [tmp_path / "image-0.png"])
    assert "--available-tools=" in plain and f"--attachment={tmp_path / 'image-0.png'}" in plain
    assert not any(a.startswith(("--allow-tool", "--allow-all")) for a in plain)
    web = b.build_argv("/bin/copilot", "PROMPT", [], web=True)
    assert "--available-tools=web_search,web_fetch" in web
    assert "--allow-tool=url" in web and "--allow-all-urls" in web
    assert "--allow-all-tools" not in web and "--available-tools=" not in web


def test_codex_and_kimi_web_flags(tmp_path):
    b = CodexBrain()
    args = ("/bin/codex", "P", tmp_path / "s.json", tmp_path / "o.json", tmp_path, [])
    assert "--search" not in b.build_argv(*args)
    argv = b.build_argv(*args, web=True)
    assert argv.index("--search") > argv.index("exec") and argv[-2:] == ["--", "P"]
    assert agent_tools(images=False, web=False) == []
    assert agent_tools(images=False, web=True) == ["WebSearch", "FetchURL"]
    assert agent_tools(images=True, web=False) == ["ReadMediaFile"]


def test_stage_images_copies_into_cwd(tmp_path, room):
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    staged = stage_images([room], cwd)
    assert staged == [cwd / "image-0.png"] and staged[0].read_bytes() == room.read_bytes()


async def test_mock_brain_web_returns_canned_research():
    from pipeline.research import build_research_prompt, research_schema, validation_errors

    schema = research_schema()
    out = await MockBrain().complete_json("s", build_research_prompt("The Plaza, NYC"), schema, web=True)
    assert out["query"] == "The Plaza, NYC" and not validation_errors(out, schema)


@pytest.mark.parametrize("bad", ['{"tables": ', "[1, 2]", '"text"', "nope"])
def test_codex_decode_strings_rejects_malformed_payloads(bad):
    _, encoded = strictify(CHAT_RESPONSE_SCHEMA)
    with pytest.raises(BrainError):
        decode_strings({"reply": "ok", "spec_patch": bad, "ambiguities": []}, encoded)


async def test_codex_brain_confines_reads_and_cleans_env(tmp_path, monkeypatch):
    from pipeline._proc import ProcResult
    from pipeline.brains import codex as codex_mod

    calls = []

    async def fake_run(argv, *, cwd, timeout_s, stdin_text=None, env=None, clean_env=False):
        calls.append({"argv": argv, "cwd": cwd, "clean_env": clean_env})
        out = {"reply": "ok", "spec_patch": "{}", "ambiguities": []}
        return ProcResult(argv=argv, returncode=0, stdout=json.dumps(out), stderr="", seconds=0.1)

    monkeypatch.setattr(codex_mod, "which", lambda name: "/bin/codex")
    monkeypatch.setattr(codex_mod, "run_cli", fake_run)
    obj = await CodexBrain().complete_json("SYS", "USER", CHAT_RESPONSE_SCHEMA)
    assert obj == {"reply": "ok", "spec_patch": {}, "ambiguities": []}
    [call] = calls
    prompt = call["argv"][-1]
    assert call["clean_env"] is True and call["cwd"].name.startswith("vv-codex-")
    assert "Do not read files outside the working directory" in prompt
    assert prompt.index("SYS") < prompt.index("Do not read files") < prompt.index("USER")


def test_claude_cli_schema_strips_meta_keys():
    from pipeline.brains.claude import _cli_schema

    out = _cli_schema({"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "x",
                       "type": "object", "properties": {"a": {"$id": "y", "type": "string"}}})
    assert "$schema" not in out and "$id" not in out and "$id" not in out["properties"]["a"]
