"""GitHub Copilot CLI brain: `copilot -p` in silent, non-interactive mode with every tool disabled.

argv: copilot --prompt=<system+user+schema> -s --no-ask-user --no-custom-instructions --disable-builtin-mcps
              --no-color --available-tools= [--model=$VV_COPILOT_MODEL] [--attachment=<image>...]
Copilot has no system-prompt or JSON-schema flag, so the schema is described in the prompt and the first JSON
object is extracted from stdout. Vision QA: images are copied into the temp cwd and attached with
`--attachment` (verified with Copilot CLI 1.0.115), so no file-reading tool needs to be enabled.

Web research (`web=True`): only `web_search` and `web_fetch` are visible. In a -p run an unapproved permission
request is denied, so they are pre-approved: web_fetch raises a `url` permission request (seen in the CLI's debug
log on 1.0.115), approved by `--allow-tool=url` plus `--allow-all-urls`. Shell and write stay denied. (On 1.0.115
`web_search` is not offered in -p mode for every model; the model then researches with web_fetch alone.)
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from .._proc import ProcTimeout, extract_json, probe_version, run_cli, tail, which
from .base import BrainError, BrainStatus
from .claude import stage_images

WEB_TOOLS = ("web_search", "web_fetch")


def json_instructions(schema: dict) -> str:
    return (
        "Output format: respond with ONLY one JSON object (no prose, no markdown fences) that validates "
        "against this JSON Schema:\n" + json.dumps(schema, separators=(",", ":"))
    )


class CopilotBrain:
    id = "copilot"
    label = "GitHub Copilot CLI"
    binary = "copilot"

    def detect(self) -> BrainStatus:
        try:
            path = which(self.binary)
            if not path:
                return BrainStatus(available=False, detail="copilot not found on PATH")
            version, err = probe_version(path)
            return BrainStatus(available=True, logged_in=None, version=version, detail=err)
        except Exception as e:  # noqa: BLE001
            return BrainStatus(available=False, detail=f"detect failed: {e}")

    def build_argv(self, path: str, prompt: str, attachments: list[Path], web: bool = False) -> list[str]:
        argv = [
            path,
            f"--prompt={prompt}",
            "-s",
            "--no-ask-user",
            "--no-custom-instructions",
            "--disable-builtin-mcps",
            "--no-color",
        ]
        if web:
            argv += [
                f"--available-tools={','.join(WEB_TOOLS)}",
                "--allow-tool=url",
                "--allow-all-urls",
                "--deny-tool=shell",
                "--deny-tool=write",
            ]
        else:
            argv.append("--available-tools=")
        model = os.environ.get("VV_COPILOT_MODEL")
        if model:
            argv.append(f"--model={model}")
        argv += [f"--attachment={a}" for a in attachments]
        return argv

    async def complete_json(
        self, system: str, user: str, schema: dict, images: list[Path] | None = None, timeout_s: int = 180,
        *, web: bool = False,
    ) -> dict:
        path = which(self.binary)
        if not path:
            raise BrainError("copilot CLI is not installed")
        prompt = f"{system}\n\n{user}\n\n{json_instructions(schema)}"
        with tempfile.TemporaryDirectory(prefix="vv-copilot-") as tmp:
            cwd = Path(tmp)
            attachments = stage_images(images, cwd)
            if attachments:
                prompt += "\n\nThe attached images, in order: " + ", ".join(a.name for a in attachments)
            try:
                res = await run_cli(self.build_argv(path, prompt, attachments, web=web), cwd=cwd,
                                    timeout_s=timeout_s)
            except ProcTimeout as e:
                raise BrainError(str(e)) from e
        obj = extract_json(res.stdout)
        if obj is None:
            if res.returncode != 0:
                raise BrainError(f"copilot exited {res.returncode}: {tail(res.stderr or res.stdout)}")
            raise BrainError(f"copilot returned no JSON object: {tail(res.stdout)}")
        return obj
