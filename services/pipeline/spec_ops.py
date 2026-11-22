"""Spec operations: RFC 7396 merge patches, validation, and the chat -> spec flow."""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import jsonschema
from pydantic import ValidationError

from . import rules as rules_mod
from .brains.base import Brain, BrainError
from .models import DesignSpec, RuleWarning, VenueRules, VenueSpec, default_spec, load_schema
from .prompts import CHAT_RESPONSE_SCHEMA, build_chat_messages


class SpecValidationError(ValueError):
    """The candidate DesignSpec does not satisfy the JSON Schema / Pydantic model."""


def apply_merge_patch(target: Any, patch: Any) -> Any:
    """RFC 7396 JSON Merge Patch. Returns a new value; inputs are not modified."""
    if not isinstance(patch, dict):
        return copy.deepcopy(patch)
    result = copy.deepcopy(target) if isinstance(target, dict) else {}
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = apply_merge_patch(result.get(key), value)
    return result


@lru_cache(maxsize=1)
def _validator() -> jsonschema.protocols.Validator:
    schema = load_schema("design-spec")
    cls = jsonschema.validators.validator_for(schema)
    cls.check_schema(schema)
    return cls(schema)


def _pointer(path: Any) -> str:
    return "/" + "/".join(str(p) for p in path) if path else "/"


def validate_spec(data: dict) -> DesignSpec:
    """Validate a dict against the DesignSpec JSON Schema and the Pydantic model."""
    if not isinstance(data, dict):
        raise SpecValidationError(f"DesignSpec must be an object, got {type(data).__name__}")
    errors = sorted(_validator().iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        msg = "; ".join(f"{_pointer(e.absolute_path)}: {e.message}" for e in errors[:10])
        raise SpecValidationError(msg)
    try:
        return DesignSpec.model_validate(data)
    except ValidationError as e:
        raise SpecValidationError(str(e)) from e


@dataclass
class ChatResult:
    reply: str
    spec: DesignSpec
    warnings: list[RuleWarning] = field(default_factory=list)
    ambiguities: list[str] = field(default_factory=list)
    spec_patch: dict = field(default_factory=dict)
    attempts: int = 1


def _coerce_spec(spec: DesignSpec | dict | None) -> DesignSpec:
    if spec is None:
        return default_spec()
    return spec if isinstance(spec, DesignSpec) else validate_spec(spec)


def _parse_response(resp: Any, base: dict) -> tuple[str, dict, list[str], DesignSpec]:
    if not isinstance(resp, dict):
        raise SpecValidationError(f"response must be a JSON object, got {type(resp).__name__}")
    patch = resp.get("spec_patch")
    if isinstance(patch, str):  # some CLIs return the patch JSON-encoded
        try:
            patch = json.loads(patch) if patch.strip() else {}
        except json.JSONDecodeError as e:
            raise SpecValidationError(f"spec_patch is not valid JSON: {e}") from e
    if patch is None:
        patch = {}
    if not isinstance(patch, dict):
        raise SpecValidationError("spec_patch must be a JSON object (an RFC 7396 merge patch)")
    patch = {k: v for k, v in patch.items() if k != "version"}
    reply = resp.get("reply")
    reply = reply if isinstance(reply, str) else ""
    amb = resp.get("ambiguities") or []
    amb = [str(a) for a in amb] if isinstance(amb, list) else [str(amb)]
    spec = validate_spec(apply_merge_patch(base, patch))
    return reply, patch, amb, spec


async def chat_to_spec(
    brain: Brain,
    message: str,
    spec: DesignSpec | dict | None,
    venue_spec: VenueSpec | dict | None = None,
    rules: VenueRules | dict | None = None,
    timeout_s: int = 180,
) -> ChatResult:
    """Message -> brain merge patch -> validated spec (one retry on validation error) -> rules + capacity."""
    current = _coerce_spec(spec)
    venue_rules = rules if isinstance(rules, VenueRules) or rules is None else VenueRules.model_validate(rules)
    system, user = build_chat_messages(message, current, venue_spec, venue_rules)
    base = current.to_dict()

    resp = await brain.complete_json(system, user, CHAT_RESPONSE_SCHEMA, timeout_s=timeout_s)
    attempts = 1
    try:
        reply, patch, ambiguities, new_spec = _parse_response(resp, base)
    except SpecValidationError as first_error:
        retry_user = (
            f"{user}\n\nYour previous response was:\n{json.dumps(resp, ensure_ascii=False)[:4000]}\n"
            f"Applying its spec_patch produced an invalid DesignSpec: {first_error}\n"
            "Return a corrected JSON object (same keys) whose spec_patch yields a valid DesignSpec."
        )
        resp = await brain.complete_json(system, retry_user, CHAT_RESPONSE_SCHEMA, timeout_s=timeout_s)
        attempts = 2
        try:
            reply, patch, ambiguities, new_spec = _parse_response(resp, base)
        except SpecValidationError as e:
            raise BrainError(f"{getattr(brain, 'id', 'brain')} returned an invalid spec patch twice: {e}") from e

    fixed, warnings = rules_mod.check(new_spec, venue_rules)
    warnings = warnings + rules_mod.capacity_warnings(fixed)
    return ChatResult(reply=reply, spec=fixed, warnings=warnings, ambiguities=ambiguities,
                      spec_patch=patch, attempts=attempts)
