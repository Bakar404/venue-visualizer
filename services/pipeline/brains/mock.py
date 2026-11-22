"""Offline mock brain: a deterministic keyword parser that turns a planner message into a merge patch.

Always available. It reads the planner message and current spec from the marked blocks that
`prompts.build_chat_messages` puts in the user prompt. For any other schema (e.g. vision QA) it returns a
schema-shaped object built from defaults (booleans true, so offline QA never blocks a render).
With `web=True` and a VenueResearch-shaped schema it returns canned, schema-valid research for the query
(example.com sources), so the venue-finder flow can be exercised offline.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ..models import default_spec
from ..prompts import (
    CURRENT_SPEC_END,
    CURRENT_SPEC_START,
    USER_MESSAGE_END,
    USER_MESSAGE_START,
    VENUE_QUERY_END,
    VENUE_QUERY_START,
)
from .base import BrainStatus

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
}
_NUM = r"(\d+|" + "|".join(_NUMBER_WORDS) + r")"

COLORS = [
    "dusty rose", "rose gold", "sage green", "navy blue", "dusty blue", "light blue", "royal blue",
    "hunter green", "forest green", "emerald green", "burnt orange", "off white", "off-white",
    "ivory", "white", "cream", "champagne", "blush", "pink", "red", "burgundy", "wine", "maroon", "coral",
    "peach", "orange", "terracotta", "rust", "amber", "yellow", "mustard", "gold", "silver", "bronze",
    "copper", "green", "sage", "emerald", "olive", "mint", "teal", "turquoise", "blue", "navy", "purple",
    "lavender", "lilac", "plum", "mauve", "black", "grey", "gray", "charcoal", "taupe", "beige", "nude",
    "tan", "brown", "chocolate", "magenta", "fuchsia",
]
_COLOR_RE = re.compile(r"\b(" + "|".join(re.escape(c) for c in COLORS) + r")\b", re.IGNORECASE)

CHAIR_STYLES = {
    "chiavari": "chiavari", "tiffany": "chiavari", "ghost": "ghost", "cross-back": "cross-back",
    "crossback": "cross-back", "cross back": "cross-back", "folding": "folding", "louis": "louis",
    "bentwood": "bentwood", "wishbone": "wishbone", "tolix": "tolix", "banquet": "banquet",
}
FLOWERS = ["garden roses", "roses", "peonies", "hydrangeas", "hydrangea", "ranunculus", "orchids", "tulips",
           "dahlias", "anemones", "lilies", "calla lilies", "baby's breath", "gardenias", "sunflowers",
           "carnations", "lisianthus", "magnolias", "proteas", "wildflowers"]
GREENERY = ["eucalyptus", "ivy", "ferns", "olive branches", "smilax", "ruscus", "greenery", "foliage"]
CONTAINERS = ["mercury glass", "compotes", "compote", "bud vases", "cylinder vases",
              "glass vases", "vases", "lanterns", "urns", "bowls", "candelabras", "candelabra"]
_CONTAINER_RE = re.compile(
    r"(?:\b(?:" + "|".join(re.escape(c) for c in COLORS) + r")\s+)?\b(?:"
    + "|".join(re.escape(c) for c in CONTAINERS) + r")\b", re.IGNORECASE)
EXTRAS = ["dance floor", "sweetheart table", "head table", "flower wall", "floral wall", "backdrop", "arch",
          "lounge", "photo booth", "bar", "stage", "cake table", "gift table", "welcome sign", "dessert table",
          "chandelier"]
_STOP = {"a", "an", "the", "add", "with", "and", "plus", "include", "including", "also", "please", "we",
         "want", "need", "have", "i", "id", "i'd", "like", "some", "put", "use", "set", "make", "it", "to",
         "of", "for", "in", "on", "our", "my", "us", "let's", "lets", "would", "could", "can"}

# segment targets: the colours written between two target nouns belong to the second one
_TARGETS = [
    ("linens", r"linens?|tablecloths?|table ?cloths?"),
    ("napkins", r"napkins?"),
    ("runner", r"runners?"),
    ("chairs", r"chairs?"),
    ("centerpieces", r"centerpieces?|centrepieces?|florals?|flowers?|arrangements?|bouquets?"),
    ("uplighting", r"up-?light(?:ing|s)?"),
    ("tables", r"tables?|rounds"),
    ("palette", r"palette|colou?r scheme|colou?rs"),
    ("extra", "|".join(re.escape(e) + "s?" for e in EXTRAS)),
]
_TARGET_RE = re.compile("|".join(f"(?P<{n}>\\b(?:{p})\\b)" for n, p in _TARGETS), re.IGNORECASE)
_NEG = re.compile(r"\b(no|without|remove|drop|skip|nix|lose|delete)\b", re.IGNORECASE)


def _num(s: str) -> int:
    return int(s) if s.isdigit() else _NUMBER_WORDS[s.lower()]


def _colors(text: str) -> list[str]:
    out: list[str] = []
    for m in _COLOR_RE.finditer(text):
        c = m.group(1).lower().replace("off white", "off-white")
        if c not in out:
            out.append(c)
    return out


def _between(text: str, marker_start: str, marker_end: str) -> str | None:
    i = text.find(marker_start)
    j = text.find(marker_end, i + len(marker_start)) if i != -1 else -1
    return text[i + len(marker_start):j].strip() if i != -1 and j != -1 else None


def _find_all(words: list[str], text: str) -> list[str]:
    found = []
    for w in words:
        if re.search(rf"\b{re.escape(w)}\b", text, re.IGNORECASE) and not any(w in f for f in found):
            found.append(w)
    return found


def _set(patch: dict, path: str, value: Any) -> None:
    keys = path.split(".")
    node = patch
    for k in keys[:-1]:
        node = node.setdefault(k, {})
    node[keys[-1]] = value


def _get(spec: dict, path: str) -> Any:
    node: Any = spec
    for k in path.split("."):
        node = node.get(k) if isinstance(node, dict) else None
    return node


def parse_message(message: str, current: dict) -> tuple[dict, list[str]]:
    """Map a planner message onto (merge patch, ambiguities) relative to `current`."""
    patch: dict = {}
    ambiguities: list[str] = []
    element_colors: list[str] = []
    explicit_palette: list[str] = []
    extras = list(current.get("extras") or [])
    extras_changed = False
    text = message.strip()
    low = text.lower()

    # --- tables / guests -------------------------------------------------------------------------
    m = re.search(
        _NUM + r"\s+(?:(\d{2,3})\s*(?:\"|”|''|-?\s*inch(?:es)?|in\b)\s*)?"
        r"(round|banquet|rectangular|long|farm|square|oval|cocktail|highboy)?\s*(?:tables?|rounds)"
        r"(?:\s+(?:of|for|seating|that seat|each seating|with)\s+" + _NUM + r")?",
        low,
    )
    if m:
        _set(patch, "tables.count", _num(m.group(1)))
        if m.group(2):
            _set(patch, "tables.size_in", int(m.group(2)))
        shape = m.group(3)
        if shape or "rounds" in m.group(0):
            shape = shape or "round"
            shape = {"rectangular": "banquet", "long": "banquet", "farm": "banquet", "highboy": "cocktail"}.get(
                shape, shape)
            _set(patch, "tables.shape", shape)
        if m.group(4):
            _set(patch, "tables.seats", _num(m.group(4)))
    else:
        m = re.search(r"(?:tables?|rounds)\s+(?:of|for|seating)\s+" + _NUM + r"\b(?!\s*(?:guests|people))", low)
        if m:
            _set(patch, "tables.seats", _num(m.group(1)))
    m = re.search(r"(\d{2,3})\s*(?:\"|”|-?\s*inch(?:es)?)\s*(round|square)", low)
    if m:
        _set(patch, "tables.size_in", int(m.group(1)))
        _set(patch, "tables.shape", m.group(2))
    m = re.search(r"\b(\d{1,4})\s+(?:guests|people|attendees|pax|persons)\b", low)
    if m and 1 <= int(m.group(1)) <= 2000:
        _set(patch, "guest_count", int(m.group(1)))

    for et in ("wedding", "corporate", "birthday", "gala", "shower"):
        if re.search(rf"\b{et}\b", low):
            _set(patch, "event_type", et)
            break

    # --- per-clause, per-target colours -------------------------------------------------------------
    for clause in re.split(r"[,;.\n]+", text):
        prev_end = 0
        matches = list(_TARGET_RE.finditer(clause))
        for idx, tm in enumerate(matches):
            target = tm.lastgroup or ""
            before = clause[prev_end:tm.start()]
            nxt = matches[idx + 1].start() if idx + 1 < len(matches) else len(clause)
            after = clause[tm.end():nxt]
            seg = before + " " + tm.group(0) + " " + after
            cont_m = _CONTAINER_RE.search(seg)
            cols = _colors(before) or _colors(_CONTAINER_RE.sub(" ", after))
            negated = bool(_NEG.search(before))
            prev_end = tm.end()
            if target == "linens":
                if cols:
                    _set(patch, "linens.color", cols[0])
                    element_colors.extend(cols[:1])
                if re.search(r"\bfloor[- ]length\b|\bfloor\b", seg, re.IGNORECASE):
                    _set(patch, "linens.length", "floor")
                elif re.search(r"\blap\b", seg, re.IGNORECASE):
                    _set(patch, "linens.length", "lap")
                pat = _find_all(["sequin", "lace", "velvet", "striped", "floral", "gingham", "satin"], seg)
                if pat:
                    _set(patch, "linens.pattern", pat[0])
            elif target == "napkins" and cols:
                _set(patch, "napkins.color", cols[0])
                element_colors.extend(cols[:1])
            elif target == "runner":
                if negated:
                    _set(patch, "linens.runner", None)
                elif cols:
                    words = [w for w in re.findall(r"[a-z][a-z-]*", before.lower()) if w not in _STOP]
                    _set(patch, "linens.runner", " ".join(words[-3:] or cols))
                    element_colors.extend(cols)
            elif target == "chairs":
                if cols:
                    _set(patch, "chairs.color", cols[0])
                    element_colors.extend(cols[:1])
                for key, style in CHAIR_STYLES.items():
                    if re.search(rf"\b{re.escape(key)}\b", seg, re.IGNORECASE):
                        _set(patch, "chairs.style", style)
                        break
                cushion = re.search(r"(\w+)\s+cushions?", seg, re.IGNORECASE)
                if cushion:
                    _set(patch, "chairs.cushion", cushion.group(1).lower())
                sash = re.search(r"(\w+)\s+sash(?:es)?", seg, re.IGNORECASE)
                if sash:
                    _set(patch, "chairs.sash", sash.group(1).lower())
            elif target == "centerpieces":
                if negated:
                    _set(patch, "centerpieces.height", "none")
                    continue
                if cols:
                    _set(patch, "centerpieces.colors", cols)
                    element_colors.extend(cols)
                h = re.search(r"\b(low|short|medium|mid-height|tall|elevated|mixed|varied)\b", seg, re.IGNORECASE)
                if h:
                    _set(patch, "centerpieces.height", {"short": "low", "mid-height": "medium", "elevated": "tall",
                                                        "varied": "mixed"}.get(h.group(1).lower(), h.group(1).lower()))
                flowers = _find_all(FLOWERS, seg)
                if flowers:
                    _set(patch, "centerpieces.flowers", flowers)
                green = _find_all(GREENERY, seg)
                if green:
                    _set(patch, "centerpieces.greenery", " and ".join(green))
                if cont_m:
                    _set(patch, "centerpieces.container", " ".join(cont_m.group(0).lower().split()))
            elif target == "uplighting":
                if negated:
                    _set(patch, "lighting.uplighting", None)
                    continue
                words = [w for w in re.findall(r"[a-z][a-z-]*", before.lower()) if w not in _STOP]
                desc = " ".join(words[-3:]) if words else (" ".join(_colors(after)) or "warm white")
                _set(patch, "lighting.uplighting", desc)
            elif target == "palette" and cols and re.search(r"palette|scheme", tm.group(0), re.IGNORECASE):
                explicit_palette.extend(cols)
            elif target == "extra":
                name = tm.group(0).lower().rstrip("s") if tm.group(0).lower().endswith("s") and not \
                    tm.group(0).lower().endswith("ss") else tm.group(0).lower()
                if negated:
                    kept = [e for e in extras if name not in e.lower()]
                    extras_changed |= len(kept) != len(extras)
                    extras = kept
                    continue
                words = [w for w in re.findall(r"[a-z0-9][a-z0-9'-]*", before.lower()) if w not in _STOP]
                phrase = " ".join([*words[-3:], name]).strip()
                if not any(phrase.lower() == e.lower() for e in extras):
                    extras = [e for e in extras if e.lower() != name]
                    extras.append(phrase)
                    extras_changed = True

    # --- greenery / flowers mentioned without a centerpiece noun -------------------------------------
    if "centerpieces" not in patch:
        green = _find_all([g for g in GREENERY if g != "foliage"], low)
        if green:
            _set(patch, "centerpieces.greenery", " and ".join(green))

    # --- candles ---------------------------------------------------------------------------------
    if re.search(r"\b(candles?|candlelight|tapers?|votives?|tea ?lights?)\b", low):
        if re.search(r"\bno (?:candles?|candlelight|tapers?|votives?)\b|\bwithout candles?\b", low):
            _set(patch, "centerpieces.candles", "none")
        elif re.search(r"\b(flameless|led|battery|electric|faux)\b", low):
            _set(patch, "centerpieces.candles", "flameless")
        else:
            _set(patch, "centerpieces.candles", "live")
            if not re.search(r"\b(live|real|lit|wax)\b", low):
                ambiguities.append("Should the candles be real (live flame) or flameless LED?")

    # --- lighting flags, effects, install -------------------------------------------------------------
    if re.search(r"\bpin ?spot", low):
        _set(patch, "lighting.pin_spots", not re.search(r"\bno pin ?spot", low))
    if re.search(r"\b(string|bistro|fairy|cafe|café|market) lights?\b", low):
        _set(patch, "lighting.string_lights", not re.search(r"\bno (string|bistro|fairy|cafe|café|market) lights?", low))
    if re.search(r"\b(daylight|daytime|daytime|afternoon|brunch|morning)\b", low):
        _set(patch, "lighting.ambient", "daylight")
    elif re.search(r"\b(dim|moody|candlelit|dark)\b", low):
        _set(patch, "lighting.ambient", "dim")
    elif re.search(r"\b(evening|night|warm glow)\b", low):
        _set(patch, "lighting.ambient", "evening_warm")
    for flag, pattern in (("fog", r"\b(fog|haze|dry ice)\b"), ("confetti", r"\bconfetti\b"),
                          ("sparklers", r"\bsparklers?\b")):
        if re.search(pattern, low):
            _set(patch, f"effects.{flag}", not re.search(r"\bno " + pattern[2:], low))
    if re.search(r"\b(ceiling drap\w*|drap\w* (?:the |from the )?ceiling|draped ceiling)\b", low):
        _set(patch, "install.ceiling_draping", not re.search(r"\bno ceiling drap", low))

    # --- extras / palette ------------------------------------------------------------------------
    if extras_changed:
        patch["extras"] = extras
    lighting_colors = set(_colors(str(_get(patch, "lighting.uplighting") or "")))
    new_colors = [c for c in dict.fromkeys(explicit_palette + element_colors) if c not in lighting_colors or
                  c in explicit_palette]
    if explicit_palette:
        patch["palette"] = list(dict.fromkeys(explicit_palette + element_colors))[:8]
    elif new_colors:
        targets = {k for k in ("linens", "chairs", "centerpieces") if k in patch and (
            _get(patch, f"{k}.color") or _get(patch, f"{k}.colors"))}
        if len(targets) >= 2:  # a full re-theme: the palette is what was just described
            patch["palette"] = new_colors[:8]
        else:
            merged = list(dict.fromkeys([*(current.get("palette") or []), *new_colors]))
            if merged != list(current.get("palette") or []):
                patch["palette"] = merged[-8:]

    # --- ambiguities -------------------------------------------------------------------------------
    tables = {**(current.get("tables") or {}), **(patch.get("tables") or {})}
    if "tables" in patch and tables.get("shape") == "round" and not tables.get("size_in"):
        ambiguities.append("What size are the round tables? Assuming 60-inch rounds.")
    if "tables" in patch and not tables.get("seats"):
        ambiguities.append("How many guests per table?")
    if "chairs" in patch and "style" not in patch["chairs"] and current.get("chairs", {}).get("style"):
        pass  # keeps the current chair style; nothing to ask
    return patch, ambiguities


def _describe(patch: dict) -> str:
    names = {"tables": "tables", "linens": "linens", "napkins": "napkins", "chairs": "chairs",
             "centerpieces": "centerpieces", "lighting": "lighting", "extras": "extras", "palette": "palette",
             "guest_count": "guest count", "event_type": "event type", "effects": "effects",
             "install": "installation details"}
    changed = [names[k] for k in patch if k in names]
    if not changed:
        return "I couldn't find specific decor changes in that message, so the design is unchanged."
    if len(changed) > 1:
        return f"Updated the {', '.join(changed[:-1])} and {changed[-1]}."
    return f"Updated the {changed[0]}."


def schema_default(schema: dict) -> Any:
    if "default" in schema:
        return schema["default"]
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    t = schema.get("type")
    if isinstance(t, list):
        t = next((x for x in t if x != "null"), "null")
    if t == "object" or "properties" in schema:
        return {k: schema_default(v) for k, v in (schema.get("properties") or {}).items()}
    if t == "array":
        return []
    if t == "string":
        return ""
    if t == "boolean":
        return True
    if t in ("number", "integer"):
        return schema.get("maximum", schema.get("minimum", 1))
    return None


def canned_research(query: str) -> dict:
    """Deterministic, schema-valid VenueResearch for offline demos and tests."""
    name = query.split(",")[0].strip() or "Sample Venue"
    site = "https://example.com/venue"
    return {
        "query": query,
        "matches": [{
            "name": name,
            "address": None,
            "website": site,
            "confidence": 0.5,
            "summary": "Offline sample result (mock brain); no web search was performed.",
            "style": "classic ballroom",
            "spaces": [{
                "name": "Grand Ballroom",
                "description": "Sample ballroom with a sprung wooden dance floor.",
                "capacity_seated": 200,
                "capacity_standing": 300,
                "length_ft": 90.0,
                "width_ft": 60.0,
                "ceiling_ft": 20.0,
                "walls": "ivory paneling",
                "floor": "patterned carpet",
                "windows": "tall arched windows",
                "fixtures": ["crystal chandeliers"],
                "photos": [{"url": f"{site}/ballroom.jpg", "source_page": f"{site}/spaces",
                            "caption": "Grand Ballroom", "credit": "example.com"}],
                "source": f"{site}/spaces",
            }],
            "rules_found": [{"text": "Open flames are not permitted; flameless candles only.",
                             "maps_to": "live_candles", "allowed": False, "source": f"{site}/policies"}],
            "provided_items": ["60-inch round tables", "chiavari chairs"],
            "sources": [site],
        }],
        "notes": "Generated offline by the mock brain.",
    }


class MockBrain:
    id = "mock"
    label = "Offline mock (keyword parser)"

    def detect(self) -> BrainStatus:
        return BrainStatus(available=True, logged_in=True, version="1", detail="deterministic offline parser")

    async def complete_json(
        self, system: str, user: str, schema: dict, images: list[Path] | None = None, timeout_s: int = 180,
        *, web: bool = False,
    ) -> dict:
        props = schema.get("properties") or {}
        if web and "matches" in props:
            return canned_research(_between(user, VENUE_QUERY_START, VENUE_QUERY_END) or user.strip()[:200])
        if "spec_patch" not in props:
            return schema_default(schema)
        message = _between(user, USER_MESSAGE_START, USER_MESSAGE_END) or user
        current_raw = _between(user, CURRENT_SPEC_START, CURRENT_SPEC_END)
        try:
            current = json.loads(current_raw) if current_raw else default_spec().to_dict()
        except json.JSONDecodeError:
            current = default_spec().to_dict()
        patch, ambiguities = parse_message(message, current)
        return {"reply": _describe(patch), "spec_patch": patch, "ambiguities": ambiguities}
