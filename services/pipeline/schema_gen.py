"""Check (and optionally regenerate) the Pydantic models against `packages/schema/*.schema.json`.

    python -m pipeline.schema_gen                 # drift check; exit 1 if models.py disagrees with the schemas
    python -m pipeline.schema_gen --codegen DIR   # also run datamodel-code-generator into DIR for diffing

`pipeline/models.py` is hand-written for readable names and `to_dict()`; this module is the guard that
keeps it identical to the JSON Schema (properties, required, types, enums, bounds, defaults, extra=forbid).
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from . import models
from .models import load_schema, schema_dir

# (model, schema file, $def name or None)
TARGETS: list[tuple[type[BaseModel], str, str | None]] = [
    (models.DesignSpec, "design-spec", None),
    (models.VenueRules, "venue", "VenueRules"),
    (models.VenueSpec, "venue", "VenueSpec"),
    (models.RuleWarning, "venue", "RuleWarning"),
]

_BOUNDS = ("minimum", "maximum", "maxItems", "minItems", "maxLength", "minLength")


def _resolve(node: dict, root: dict) -> dict:
    while "$ref" in node:
        ref = node["$ref"]
        assert ref.startswith("#/"), ref
        target: Any = root
        for part in ref[2:].split("/"):
            target = target[part]
        node = {**target, **{k: v for k, v in node.items() if k != "$ref"}}
    return node


def _variants(node: dict, root: dict) -> list[dict]:
    node = _resolve(node, root)
    if "anyOf" in node:
        out = []
        for sub in node["anyOf"]:
            out.extend(_variants(sub, root))
        extra = {k: v for k, v in node.items() if k != "anyOf"}
        return [{**v, **extra} for v in out]
    t = node.get("type")
    if isinstance(t, list):
        return [{**node, "type": x} for x in t]
    if t is None and "const" in node:
        return [{**node, "type": type(node["const"]).__name__.replace("int", "integer").replace("str", "string")}]
    return [node]


def _norm(node: dict, root: dict) -> dict[str, Any]:
    vs = _variants(node, root)
    types = {v.get("type") for v in vs}
    info: dict[str, Any] = {"types": types}
    for v in vs:
        if v.get("type") == "null":
            continue
        if "enum" in v:
            info["enum"] = set(v["enum"])
        if "const" in v:
            info["enum"] = {v["const"]}
        for b in _BOUNDS:
            if b in v:
                info[b] = v[b]
        if v.get("type") == "array" and "items" in v:
            info["items"] = _norm(v["items"], root)
        if v.get("type") == "object":
            info["object"] = v
    return info


def _compare_object(js: dict, js_root: dict, ps: dict, ps_root: dict, path: str, model_has_default: dict) -> list[str]:
    errs: list[str] = []
    js_props = js.get("properties", {})
    ps_props = ps.get("properties", {})
    if set(js_props) != set(ps_props):
        errs.append(f"{path}: properties differ: schema={sorted(js_props)} model={sorted(ps_props)}")
    if js.get("additionalProperties") is False and ps.get("additionalProperties") is not False:
        errs.append(f"{path}: model must forbid extra properties")
    js_req, ps_req = set(js.get("required", [])), set(ps.get("required", []))
    if not ps_req <= js_req:
        errs.append(f"{path}: model requires {sorted(ps_req - js_req)} which the schema treats as optional")
    for name in sorted(set(js_props) & set(ps_props)):
        sub = f"{path}/{name}"
        a, b = _norm(js_props[name], js_root), _norm(ps_props[name], ps_root)
        a_types, b_types = set(a["types"]), set(b["types"])
        if name not in js_req:
            b_types.discard("null")  # optional: absent == null in to_dict()
            a_types.discard("null")
        if a_types != b_types and not (a_types == {None} or b_types == {None}):
            errs.append(f"{sub}: types differ: schema={sorted(map(str, a_types))} model={sorted(map(str, b_types))}")
        if _enum_set(a.get("enum")) != _enum_set(b.get("enum")):
            errs.append(f"{sub}: enum differs: schema={a.get('enum')} model={b.get('enum')}")
        for bound in _BOUNDS:
            if a.get(bound) != b.get(bound):
                errs.append(f"{sub}: {bound} differs: schema={a.get(bound)} model={b.get(bound)}")
        if "default" in js_props[name]:
            pdef = _resolve(ps_props[name], ps_root).get("default", model_has_default.get(name, "<missing>"))
            if pdef != js_props[name]["default"]:
                errs.append(f"{sub}: default differs: schema={js_props[name]['default']!r} model={pdef!r}")
        if "items" in a and "items" in b and a["items"].get("enum") != b["items"].get("enum"):
            errs.append(f"{sub}/items: enum differs")
        if "object" in a and "object" in b:
            errs.extend(_compare_object(a["object"], js_root, b["object"], ps_root, sub, {}))
    return errs


def _enum_set(values):
    """Enum values ignoring null: a nullable field lists None in JSON Schema but not in the Literal."""
    return None if values is None else frozenset(v for v in values if v is not None)


def check_models() -> list[str]:
    """Return a list of human-readable drift errors (empty = models match the schemas)."""
    errors: list[str] = []
    for model, file, def_name in TARGETS:
        doc = load_schema(file)
        js = doc["$defs"][def_name] if def_name else doc
        ps = model.model_json_schema()
        defaults = {
            k: f.get_default(call_default_factory=True) for k, f in model.model_fields.items() if not f.is_required()
        }
        defaults = {k: (v.to_dict() if isinstance(v, models._Model) else v) for k, v in defaults.items()}
        errors.extend(_compare_object(js, doc, ps, ps, model.__name__, defaults))
    return errors


def codegen(out_dir: Path) -> None:
    exe = shutil.which("datamodel-codegen")
    if not exe:
        raise SystemExit("datamodel-codegen not found (uv sync --group dev)")
    out_dir.mkdir(parents=True, exist_ok=True)
    for file in ("design-spec.schema.json", "venue.schema.json"):
        out = out_dir / (file.split(".")[0].replace("-", "_") + "_generated.py")
        subprocess.run(
            [exe, "--input", str(schema_dir() / file), "--input-file-type", "jsonschema",
             "--output-model-type", "pydantic_v2.BaseModel", "--output", str(out)],
            check=True,
        )
        print(f"wrote {out}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--codegen", type=Path, help="also write datamodel-code-generator output to this dir")
    args = parser.parse_args(argv)
    if args.codegen:
        codegen(args.codegen)
    errors = check_models()
    for e in errors:
        print(f"DRIFT {e}", file=sys.stderr)
    if not errors:
        print(f"pipeline.models matches {schema_dir()}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
