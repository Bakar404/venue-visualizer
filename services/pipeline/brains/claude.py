"""Claude Code brain: `claude -p` with native JSON-schema structured output.

argv: claude -p --system-prompt <system> --output-format json --json-schema <schema> --tools "" ...
The user prompt goes through stdin (no argv length limits, no flag-parsing ambiguity). The result JSON's
`structured_output` field holds the schema-validated object (verified with Claude Code 2.1.x).
Vision QA: when images are passed, only the read-only `Read` tool is enabled, scoped with --add-dir to
the images' directories, and the prompt lists the absolute image paths.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from .._proc import ProcTimeout, extract_json, probe_version, run_cli, tail, which
from .base import BrainError, BrainStatus


class ClaudeBrain:
    id = "claude"
    label = "Claude Code"
    binary = "claude"

    def detect(self) -> BrainStatus:
        try:
            path = which(self.binary)
            if not path:
                return BrainStatus(available=False, detail="claude not found on PATH")
            version, err = probe_version(path)
            return BrainStatus(available=True, logged_in=None, version=version, detail=err)
        except Exception as e:  # noqa: BLE001
            return BrainStatus(available=False, detail=f"detect failed: {e}")

    def build_argv(self, path: str, system: str, schema: dict, images: list[Path]) -> list[str]:
        argv = [
            path, "-p",
            "--system-prompt", system,
            "--output-format", "json",
            "--json-schema", json.dumps(schema, separators=(",", ":")),
            "--no-session-persistence",
            "--strict-mcp-config",
            "--disable-slash-commands",
        ]
        model = os.environ.get("VV_CLAUDE_MODEL")
        if model:
            argv += ["--model", model]
        if images:
            dirs = sorted({str(Path(i).resolve().parent) for i in images})
            argv += ["--tools", "Read", "--allowedTools", "Read", "--permission-mode", "dontAsk"]
            for d in dirs:
                argv += ["--add-dir", d]
        else:
            argv += ["--tools", ""]
        return argv

    @staticmethod
    def parse_output(stdout: str) -> dict:
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            obj = extract_json(stdout)
            if obj is None:
                raise BrainError(f"claude returned non-JSON output: {tail(stdout)}") from None
            data = obj
        if isinstance(data, dict) and data.get("type") == "result":
            if data.get("is_error"):
                raise BrainError(f"claude error: {tail(str(data.get('result') or data.get('subtype')))}")
            structured = data.get("structured_output")
            if isinstance(structured, dict):
                return structured
            obj = extract_json(str(data.get("result") or ""))
            if obj is None:
                raise BrainError(f"claude returned no structured output: {tail(str(data.get('result')))}")
            return obj
        if isinstance(data, dict):
            return data
        raise BrainError("claude returned an unexpected JSON value")

    async def complete_json(
        self, system: str, user: str, schema: dict, images: list[Path] | None = None, timeout_s: int = 180
    ) -> dict:
        path = which(self.binary)
        if not path:
            raise BrainError("claude CLI is not installed")
        images = [Path(i).resolve() for i in images or []]
        prompt = user
        if images:
            listed = "\n".join(f"- {p}" for p in images)
            prompt += f"\n\nImages to inspect (open each with the Read tool):\n{listed}"
        with tempfile.TemporaryDirectory(prefix="vv-claude-") as tmp:
            try:
                res = await run_cli(self.build_argv(path, system, schema, images), cwd=Path(tmp),
                                    timeout_s=timeout_s, stdin_text=prompt)
            except ProcTimeout as e:
                raise BrainError(str(e)) from e
        if res.returncode != 0 and not res.stdout.strip():
            raise BrainError(f"claude exited {res.returncode}: {tail(res.stderr)}")
        return self.parse_output(res.stdout)
