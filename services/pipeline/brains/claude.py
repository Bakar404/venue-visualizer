"""Claude Code brain: `claude -p` with native JSON-schema structured output.

argv: claude -p --system-prompt <system> --output-format json --json-schema <schema> --tools "" ...
The user prompt goes through stdin (no argv length limits, no flag-parsing ambiguity). The result JSON's
`structured_output` field holds the schema-validated object (verified with Claude Code 2.1.x).
Vision: images are copied into the temp cwd and only the read-only `Read` tool is enabled, allowed for that
cwd alone (`Read(./**)`; reads elsewhere are denied by --permission-mode dontAsk). The prompt lists the paths.
Web research (`web=True`): the built-in WebSearch and WebFetch tools are enabled and pre-approved, nothing else.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path

from .._proc import ProcTimeout, extract_json, probe_version, run_cli, tail, which
from ..providers import login_status
from .base import BrainError, BrainStatus

WEB_TOOLS = ["WebSearch", "WebFetch"]


def stage_images(images: list[Path] | None, cwd: Path) -> list[Path]:
    """Copy images into the call's temp cwd (the only directory the CLI may read)."""
    staged = []
    for i, img in enumerate(images or []):
        src = Path(img)
        dst = cwd / f"image-{i}{src.suffix.lower() or '.png'}"
        shutil.copyfile(src, dst)
        staged.append(dst)
    return staged



def _cli_schema(schema: dict) -> dict:
    """Claude Code's --json-schema validator rejects meta keys like a draft-2020-12 `$schema`; drop them."""
    def strip(node):
        if isinstance(node, dict):
            return {k: strip(v) for k, v in node.items() if k not in {"$schema", "$id"}}
        if isinstance(node, list):
            return [strip(v) for v in node]
        return node
    return strip(schema)

class ClaudeBrain:
    id = "claude"
    label = "Claude Code"
    binary = "claude"

    def __init__(self, config_dir: str | None = None):
        self.config_dir = config_dir

    @property
    def env(self) -> dict[str, str] | None:
        directory = self.config_dir or os.environ.get("CLAUDE_CONFIG_DIR")
        return {"CLAUDE_CONFIG_DIR": directory} if directory else None

    def detect(self) -> BrainStatus:
        try:
            path = which(self.binary)
            if not path:
                return BrainStatus(available=False, detail="claude not found on PATH")
            env = self.env
            version, err = probe_version(path, env=env)
            logged_in = login_status(self.id, path, env)
            return BrainStatus(available=True, logged_in=logged_in, version=version, detail=err)
        except Exception as e:  # noqa: BLE001
            return BrainStatus(available=False, detail=f"detect failed: {e}")

    def build_argv(self, path: str, system: str, schema: dict, images: list[Path], web: bool = False) -> list[str]:
        argv = [
            path, "-p",
            "--system-prompt", system,
            "--output-format", "json",
            "--json-schema", json.dumps(_cli_schema(schema), separators=(",", ":")),
            "--no-session-persistence",
            "--strict-mcp-config",
            "--disable-slash-commands",
        ]
        model = os.environ.get("VV_CLAUDE_MODEL")
        if model:
            argv += ["--model", model]
        tools, allowed = [], []
        if web:
            tools += WEB_TOOLS
            allowed += WEB_TOOLS
        if images:
            tools.append("Read")
            allowed.append("Read(./**)")  # the temp cwd only; images are staged there
        if tools:
            argv += ["--tools", ",".join(tools), "--allowed-tools", ",".join(allowed),
                     "--permission-mode", "dontAsk"]
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
        self, system: str, user: str, schema: dict, images: list[Path] | None = None, timeout_s: int = 180,
        *, web: bool = False,
    ) -> dict:
        path = which(self.binary)
        if not path:
            raise BrainError("claude CLI is not installed")
        with tempfile.TemporaryDirectory(prefix="vv-claude-") as tmp:
            cwd = Path(tmp).resolve()
            staged = stage_images(images, cwd)
            prompt = user
            if staged:
                listed = "\n".join(f"- {p}" for p in staged)
                prompt += f"\n\nImages to inspect (open each with the Read tool):\n{listed}"
            try:
                res = await run_cli(self.build_argv(path, system, schema, staged, web=web), cwd=cwd,
                                    timeout_s=timeout_s, stdin_text=prompt, env=self.env)
            except ProcTimeout as e:
                raise BrainError(str(e)) from e
        if res.returncode != 0 and not res.stdout.strip():
            raise BrainError(f"claude exited {res.returncode}: {tail(res.stderr)}")
        return self.parse_output(res.stdout)
