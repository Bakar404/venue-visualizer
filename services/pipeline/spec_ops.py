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
    """RFC 6901 JSON pointer: "" is the whole document; '~' and '/' inside tokens are escaped."""
    return "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in path)


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
    rule_notes: list[str] = field(default_factory=list)


def _coerce_spec(spec: DesignSpec | dict | None) -> DesignSpec:
    if spec is None:
        return default_spec()
    return spec if isinstance(spec, DesignSpec) else validate_spec(spec)


def _envelope(resp: Any) -> tuple[str, dict, list[str]]:
    """Check the brain's reply against CHAT_RESPONSE_SCHEMA; return (reply, patch, ambiguities)."""
    if not isinstance(resp, dict):
        raise SpecValidationError(f"response must be a JSON object, got {type(resp).__name__}")
    resp = dict(resp)
    patch = resp.get("spec_patch")
    if isinstance(patch, str):  # some CLIs return the patch JSON-encoded
        try:
            resp["spec_patch"] = patch = json.loads(patch)
        except json.JSONDecodeError as e:
            raise SpecValidationError(f"spec_patch is not valid JSON: {e}") from e
    errors = sorted(jsonschema.Draft202012Validator(CHAT_RESPONSE_SCHEMA).iter_errors(resp),
                    key=lambda e: list(e.absolute_path))
    if errors:
        raise SpecValidationError("invalid response: " + "; ".join(
            f"{_pointer(e.absolute_path) or '(root)'}: {e.message}" for e in errors[:10]))
    reply = resp["reply"].strip()
    if not reply:
        raise SpecValidationError("/reply: must be a non-empty string")
    patch = {k: v for k, v in resp["spec_patch"].items() if k != "version"}
    return reply, patch, list(resp["ambiguities"])


def _parse_response(resp: Any, base: dict) -> tuple[str, dict, list[str], DesignSpec]:
    reply, patch, amb = _envelope(resp)
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
    """Message -> brain merge patch -> validated spec (one retry on any bad reply) -> rules + capacity.

    A reply without JSON (BrainError), a malformed envelope and an invalid resulting spec are all retried
    once with the error appended. The reply text is amended when venue rules changed the spec."""
    current = _coerce_spec(spec)
    venue_rules = rules if isinstance(rules, VenueRules) or rules is None else VenueRules.model_validate(rules)
    system, user = build_chat_messages(message, current, venue_spec, venue_rules)
    base = current.to_dict()

    resp: Any = None
    try:
        resp = await brain.complete_json(system, user, CHAT_RESPONSE_SCHEMA, timeout_s=timeout_s)
        parsed = _parse_response(resp, base)
        attempts = 1
    except (BrainError, SpecValidationError) as first_error:
        previous = ("(no JSON object could be read)" if isinstance(first_error, BrainError)
                    else json.dumps(resp, ensure_ascii=False)[:4000])
        retry_user = (
            f"{user}\n\nYour previous response was:\n{previous}\n"
            f"It was rejected: {first_error}\n"
            "Return a corrected JSON object with exactly the keys reply (non-empty string), spec_patch (object) "
            "and ambiguities (list of strings), whose spec_patch yields a valid DesignSpec."
        )
        resp = await brain.complete_json(system, retry_user, CHAT_RESPONSE_SCHEMA, timeout_s=timeout_s)
        attempts = 2
        try:
            parsed = _parse_response(resp, base)
        except SpecValidationError as e:
            raise BrainError(f"{getattr(brain, 'id', 'brain')} returned an invalid spec patch twice: {e}") from e
    reply, patch, ambiguities, new_spec = parsed

    fixed, warnings = rules_mod.check(new_spec, venue_rules)
    notes = rules_mod.rule_notes(warnings)
    if notes:
        reply = f"{reply}\n\nAdjusted for venue rules: " + "; ".join(notes)
    warnings = warnings + rules_mod.capacity_warnings(fixed)
    return ChatResult(reply=reply, spec=fixed, warnings=warnings, ambiguities=ambiguities,
                      spec_patch=patch, attempts=attempts, rule_notes=notes)
