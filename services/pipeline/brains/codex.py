"""Codex CLI brain: `codex exec` with --output-schema (ChatGPT login; not installed on the dev machine).

argv: codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never
            --output-schema <schema file> -o <last-message file> [-i <image>...] -- <prompt>
Codex has no separate system-prompt flag in `exec`, so system and user text are concatenated.
Codex enforces --output-schema with OpenAI strict structured outputs, which rejects open-ended objects,
so open objects (like `spec_patch`) are sent as JSON-encoded strings and decoded afterwards, and string
`format`s that strict mode does not support (e.g. "uri") are dropped.
Web research (`web=True`): `codex exec --search` enables Codex's built-in live web search tool; the sandbox stays
read-only, so no shell or file writes are possible.

Residual risk: Codex's `read-only`/`workspace-write` sandboxes restrict writes and network, NOT reads. A prompt
injection in untrusted text (planner chat, web pages, video labels) could still make the model read files the
user can read. We minimise this: codex runs with cwd = a fresh temp dir, a minimal environment (`clean_env`),
an explicit "do not read files outside the working directory" instruction, and untrusted text inside
delimited data blocks. None of these is a hard boundary; run untrusted workloads under an OS sandbox.
"""
from __future__ import annotations

import copy
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .._proc import ProcTimeout, extract_json, probe_version, run_cli, tail, which
from .base import BrainError, BrainStatus
from .claude import stage_images

_STRICT_FORMATS = {"date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"}


_UNSUPPORTED_STRICT_KEYWORDS = ("minLength", "maxLength", "minItems", "maxItems", "pattern",
                                "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "default")


def strictify(schema: dict) -> tuple[dict, list[tuple[str, ...]]]:
    """Make a schema acceptable to strict structured outputs.

    Returns (strict schema, paths of fields converted to JSON strings)."""
    encoded: list[tuple[str, ...]] = []

    def walk(node: Any, path: tuple[str, ...]) -> Any:
        if not isinstance(node, dict):
            return node
        node = dict(node)
        if "format" in node and node["format"] not in _STRICT_FORMATS:
            del node["format"]
        for kw in _UNSUPPORTED_STRICT_KEYWORDS:  # enforced server-side by spec_ops instead
            node.pop(kw, None)
        if node.get("type") == "object" or "properties" in node:
            props = node.get("properties")
            if not props:
                encoded.append(path)
                desc = node.get("description", "")
                return {"type": "string", "description": f"JSON-encoded object. {desc}".strip()}
            node["properties"] = {k: walk(v, (*path, k)) for k, v in props.items()}
            node["required"] = list(props)
            node["additionalProperties"] = False
        if node.get("type") == "array" and "items" in node:
            node["items"] = walk(node["items"], (*path, "[]"))
        return node

    return walk(copy.deepcopy(schema), ()), encoded


CONFINE_NOTE = (
    "Do not read files outside the working directory, and do not run commands. Everything you need is in "
    "this prompt and the attached images."
)


def decode_strings(obj: Any, paths: list[tuple[str, ...]]) -> Any:
    """Decode fields that strictify() turned into JSON strings. A malformed string raises BrainError."""
    for path in paths:
        if not path:
            continue
        parent = obj
        for key in path[:-1]:
            parent = parent.get(key) if isinstance(parent, dict) else None
        if isinstance(parent, dict) and isinstance(parent.get(path[-1]), str):
            raw = parent[path[-1]]
            if not raw.strip():
                parent[path[-1]] = {}
                continue
            try:
                value = json.loads(raw)
            except json.JSONDecodeError as e:
                raise BrainError(f"codex returned malformed JSON for {'.'.join(path)}: {e}") from e
            if not isinstance(value, dict):
                raise BrainError(f"codex returned {type(value).__name__} for {'.'.join(path)}, expected an object")
            parent[path[-1]] = value
    return obj


class CodexBrain:
    id = "codex"
    label = "Codex CLI"
    binary = "codex"

    def detect(self) -> BrainStatus:
        try:
            path = which(self.binary)
            if not path:
                return BrainStatus(available=False, detail="codex not found on PATH")
            version, err = probe_version(path)
            return BrainStatus(available=True, logged_in=None, version=version, detail=err)
        except Exception as e:  # noqa: BLE001
            return BrainStatus(available=False, detail=f"detect failed: {e}")

    def build_argv(self, path: str, prompt: str, schema_file: Path, out_file: Path, cwd: Path,
                   images: list[Path], web: bool = False) -> list[str]:
        argv = [
            path, "exec",
            "--skip-git-repo-check",
            "--sandbox", "read-only",
            "--ephemeral",
            "--color", "never",
            "-C", str(cwd),
            "--output-schema", str(schema_file),
            "-o", str(out_file),
        ]
        if web:
            argv.append("--search")
        model = os.environ.get("VV_CODEX_MODEL")
        if model:
            argv += ["-m", model]
        for img in images:
            argv += ["-i", str(img)]
        argv += ["--", prompt]
        return argv

    async def complete_json(
        self, system: str, user: str, schema: dict, images: list[Path] | None = None, timeout_s: int = 180,
        *, web: bool = False,
    ) -> dict:
        path = which(self.binary)
        if not path:
            raise BrainError("codex CLI is not installed")
        strict, encoded = strictify(schema)
        prompt = f"{system}\n\n{CONFINE_NOTE}\n\n{user}"
        if encoded:
            names = ", ".join(".".join(p) for p in encoded)
            prompt += f"\n\n(Output note: encode {names} as a JSON string containing the object.)"
        with tempfile.TemporaryDirectory(prefix="vv-codex-") as tmp:
            cwd = Path(tmp)
            schema_file, out_file = cwd / "schema.json", cwd / "last_message.json"
            schema_file.write_text(json.dumps(strict))
            argv = self.build_argv(path, prompt, schema_file, out_file, cwd, stage_images(images, cwd), web=web)
            try:
                res = await run_cli(argv, cwd=cwd, timeout_s=timeout_s, clean_env=True)
            except ProcTimeout as e:
                raise BrainError(str(e)) from e
            text = out_file.read_text() if out_file.is_file() else ""
        if res.returncode != 0 and not text.strip():
            raise BrainError(f"codex exited {res.returncode}: {tail(res.stderr)}")
        obj = None
        try:
            obj = json.loads(text) if text.strip() else None
        except json.JSONDecodeError:
            obj = extract_json(text)
        if not isinstance(obj, dict):
            obj = extract_json(res.stdout)
        if not isinstance(obj, dict):
            raise BrainError(f"codex returned no JSON object: {tail(text or res.stdout)}")
        return decode_strings(obj, encoded)
