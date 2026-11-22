"""Kimi Code CLI brain (MoonshotAI). Binary from $VV_KIMI_BIN (default "kimi"); not installed on the dev machine.

argv: kimi --prompt=<user+schema> --output-format stream-json --agent-file <tmp>/agent.md [-m $VV_KIMI_MODEL]
Print mode auto-approves tool calls, so a throwaway agent file (YAML frontmatter + system prompt body)
disables every tool (`tools: []`). For vision QA only the read-only `Read` tool is enabled and the image
directories are added with --add-dir. stream-json emits one message per line; the reply is the last
assistant message without tool calls. Plain-text output is accepted as a fallback.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .._proc import ProcTimeout, extract_json, probe_version, run_cli, tail, which
from .base import BrainError, BrainStatus
from .copilot import json_instructions


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in content
            if not isinstance(p, dict) or p.get("type", "text") == "text"
        )
    return ""


def parse_stream(stdout: str) -> str:
    """Return the final assistant text from `--output-format stream-json` output (or the raw text)."""
    final: str | None = None
    saw_json = False
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(msg, dict) or "role" not in msg and "type" not in msg:
            continue
        saw_json = True
        if msg.get("role") == "assistant" and not msg.get("tool_calls"):
            text = _content_text(msg.get("content"))
            if text.strip():
                final = text
    if final is not None:
        return final
    return "" if saw_json else stdout


def agent_file_text(system: str, tools: list[str]) -> str:
    front = {"name": "venue-visualizer", "description": "Venue Visualizer JSON brain", "tools": tools}
    header = "\n".join(f"{k}: {json.dumps(v)}" for k, v in front.items())
    return f"---\n{header}\n---\n\n{system}\n"


class KimiBrain:
    id = "kimi"
    label = "Kimi Code CLI"

    @property
    def binary(self) -> str:
        return os.environ.get("VV_KIMI_BIN") or "kimi"

    def detect(self) -> BrainStatus:
        try:
            path = which(self.binary)
            if not path:
                return BrainStatus(available=False, detail=f"{self.binary} not found on PATH")
            version, err = probe_version(path)
            return BrainStatus(available=True, logged_in=None, version=version, detail=err)
        except Exception as e:  # noqa: BLE001
            return BrainStatus(available=False, detail=f"detect failed: {e}")

    def build_argv(self, path: str, prompt: str, agent_file: Path, image_dirs: list[str]) -> list[str]:
        argv = [path, f"--prompt={prompt}", "--output-format", "stream-json", "--agent-file", str(agent_file)]
        model = os.environ.get("VV_KIMI_MODEL")
        if model:
            argv += ["-m", model]
        for d in image_dirs:
            argv += ["--add-dir", d]
        return argv

    async def complete_json(
        self, system: str, user: str, schema: dict, images: list[Path] | None = None, timeout_s: int = 180
    ) -> dict:
        path = which(self.binary)
        if not path:
            raise BrainError(f"{self.binary} (Kimi Code CLI) is not installed")
        imgs = [Path(i).resolve() for i in images or []]
        prompt = f"{user}\n\n{json_instructions(schema)}"
        if imgs:
            prompt += "\n\nImages to inspect (open each with the Read tool):\n" + "\n".join(f"- {p}" for p in imgs)
        with tempfile.TemporaryDirectory(prefix="vv-kimi-") as tmp:
            cwd = Path(tmp)
            agent = cwd / "agent.md"
            agent.write_text(agent_file_text(system, ["Read"] if imgs else []))
            dirs = sorted({str(p.parent) for p in imgs})
            try:
                res = await run_cli(self.build_argv(path, prompt, agent, dirs), cwd=cwd, timeout_s=timeout_s)
            except ProcTimeout as e:
                raise BrainError(str(e)) from e
        obj = extract_json(parse_stream(res.stdout))
        if obj is None:
            if res.returncode != 0:
                raise BrainError(f"kimi exited {res.returncode}: {tail(res.stderr or res.stdout)}")
            raise BrainError(f"kimi returned no JSON object: {tail(res.stdout)}")
        return obj
