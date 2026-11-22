"""Deterministic venue-rule enforcement. Pure functions: no I/O, no LLM.

`check()` only ever *restricts* a DesignSpec to what the venue's (user-entered) rules allow. When a
rule allows something, nothing is changed: this module never adds or invents rules.
Warning `field`s are JSON pointers into the *input* spec (so removed extras keep their original index).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .models import DesignSpec, RuleWarning, VenueRules, default_spec

_QUALIFIER = re.compile(
    r"^(?:flameless|led|leds|battery|battery[- ](?:operated|powered)|electronic|faux|fake|flicker|flickering|"
    r"wickless|rechargeable)$",
    re.IGNORECASE,
)
_CANDLE = re.compile(
    r"\b(candles?|candlelight|candlelit|candlesticks?|tapers?|votives?|tealights?|tea[- ]lights?)\b", re.IGNORECASE
)
_LIVE_ADJ = re.compile(
    r"\b(live|real|lit|wax|open[- ]flames?|naked[- ]flames?)\s+(?=(?:[\w-]+\s+)?(?:candle|taper|votive|tea))",
    re.IGNORECASE,
)
# Words that end a noun phrase: a qualifier before one of these does not describe the candle after it
# ("LED uplighting near candles" is NOT a flameless candle).
_PHRASE_BREAK = {
    "near", "beside", "by", "on", "in", "at", "around", "next", "to", "of", "for", "the", "a", "an", "under",
    "over", "among", "between", "along", "behind", "atop", "from", "plus", "but", "not", "no", "instead",
    "than", "or", "and", "with", "without", "lights", "lighting", "uplighting", "garland", "garlands",
}
_TOKEN = re.compile(r"[\w-]+")
_QUAL_WINDOW = 3
# A clause boundary: commas, semicolons, '&', '+', and the words and/with/or/plus.
_CLAUSE = re.compile(r"(\s*[,;&+]\s*|\s+(?:and|with|or|plus)\s+)", re.IGNORECASE)


@dataclass(frozen=True)
class _Forbidden:
    rule: str             # VenueRules field name (also used as RuleWarning.rule)
    pattern: re.Pattern   # matches a forbidden mention in free text
    label: str            # human description for messages
    strip: re.Pattern | None = None  # phrases to strip to *rewrite* instead of removing


_ATTACH_VERB = r"(?:taped|nailed|glued|stuck|attached|hung|mounted|fixed|secured|fastened|affixed)"

FORBIDDEN: list[_Forbidden] = [
    _Forbidden(
        "live_candles",
        re.compile(
            r"\b(open[- ]flames?|live[- ]flames?|naked[- ]flames?|real[- ]flames?|bare[- ]flames?|fire[- ]?pits?|"
            r"fire[- ]?bowls?|torch(?:es)?|bonfires?|flaming|flambe|flambé|sterno|chafing fuel|oil lamps?)\b",
            re.IGNORECASE,
        ),
        "open flames",
    ),
    _Forbidden("fog", re.compile(r"\b(fog|foggy|haze|hazy|hazer|hazers|fogger|foggers|smoke machines?|dry ice|"
                                 r"low[- ]lying fog)\b", re.IGNORECASE),
               "fog/haze effects"),
    _Forbidden("confetti", re.compile(r"\bconfetti\b", re.IGNORECASE), "confetti"),
    _Forbidden("sparklers", re.compile(r"\bsparklers?\b", re.IGNORECASE), "sparklers"),
    _Forbidden(
        "adhesives",
        re.compile(r"\b(tape|taped|taping|adhesives?|glue|glued|command strips?)\b", re.IGNORECASE),
        "tape/adhesives",
        re.compile(
            rf"\s*,?\s*(?:{_ATTACH_VERB}\s+)?(?:with|using|via|by)\s+(?:\w+\s+)?"
            r"(?:tape|adhesives?|glue|command strips?)\b"
            r"|\s*,?\s*\b(?:taped|glued)(?:-(?:down|on|up))?\b(?:\s+(?:to|on|onto)\s+(?:the\s+)?\w+)?",
            re.IGNORECASE,
        ),
    ),
    _Forbidden(
        "nails",
        re.compile(r"\b(nails?|nailed|tacks?|thumbtacks?|staples?|stapled)\b", re.IGNORECASE),
        "nails/tacks",
        re.compile(
            rf"\s*,?\s*(?:{_ATTACH_VERB}\s+)?(?:with|using|via|by)\s+(?:\w+\s+)?"
            r"(?:nails?|tacks?|thumbtacks?|staples?)\b"
            r"|\s*,?\s*\b(?:nailed|stapled)(?:-(?:down|on|up))?\b(?:\s+(?:to|on|onto|into)\s+(?:the\s+)?\w+)?",
            re.IGNORECASE,
        ),
    ),
    _Forbidden(
        "ceiling_draping",
        re.compile(r"\b(ceiling (?:draping|drapes?|drapery|swags?|fabric)|draped ceiling|fabric ceiling)\b", re.IGNORECASE),
        "ceiling draping",
    ),
]

_INSTALL = [
    ("adhesives", "uses_adhesives", "Tape and adhesives are not allowed at this venue"),
    ("nails", "uses_nails", "Nails are not allowed at this venue"),
    ("ceiling_draping", "ceiling_draping", "Ceiling draping is not allowed at this venue"),
]
_EFFECTS = [
    ("fog", "fog", "Fog/haze is not allowed at this venue"),
    ("confetti", "confetti", "Confetti is not allowed at this venue"),
    ("sparklers", "sparklers", "Sparklers are not allowed at this venue"),
]

_REASONS = {
    "live_candles": "the venue doesn't allow open flames",
    "fog": "the venue doesn't allow fog or haze",
    "confetti": "the venue doesn't allow confetti",
    "sparklers": "the venue doesn't allow sparklers",
    "adhesives": "the venue doesn't allow tape or adhesives",
    "nails": "the venue doesn't allow nails or tacks",
    "ceiling_draping": "the venue doesn't allow ceiling draping",
}

NOTES_MAX = 2000

Hit = tuple[str, str, str]  # (rule, message, fix)


def _qualified_mentions(text: str) -> list[tuple[re.Match, bool]]:
    """Every candle mention in `text` with whether that mention itself is qualified as flameless."""
    out: list[tuple[re.Match, bool]] = []
    prev_end, prev_ok = -1, False
    for m in _CANDLE.finditer(text):
        ok = False
        before = _TOKEN.findall(text[:m.start()])[-_QUAL_WINDOW:]
        for token in reversed(before):
            if _QUALIFIER.match(token):
                ok = True
                break
            if token.lower() in _PHRASE_BREAK:
                break
        # "flameless taper candles": a mention directly after a qualified mention shares its qualifier.
        if not ok and prev_ok and not text[prev_end:m.start()].strip():
            ok = True
        tail = re.match(r"\s*\(\s*([\w-]+)", text[m.end():])
        if not ok and tail and _QUALIFIER.match(tail.group(1)):
            ok = True
        out.append((m, ok))
        prev_end, prev_ok = m.end(), ok
    return out


def _make_flameless(text: str) -> str:
    """Qualify every unqualified candle mention: 'live taper candles' -> 'flameless taper candles'."""
    text = _LIVE_ADJ.sub("", text)
    for _ in range(len(_CANDLE.findall(text)) + 1):
        unqualified = [m for m, ok in _qualified_mentions(text) if not ok]
        if not unqualified:
            break
        start = unqualified[0].start()
        if start == 0 and text[:1].isupper():
            text = "Flameless " + text[0].lower() + text[1:]
        else:
            text = text[:start] + "flameless " + text[start:]
    return text


def _q(text: str, limit: int = 80) -> str:
    """Quote user text for a warning, shortened so messages stay readable."""
    text = " ".join(text.split())
    return f"'{text if len(text) <= limit else text[: limit - 1].rstrip() + '…'}'"


def _clean(text: str) -> str:
    text = re.sub(r"\s{2,}", " ", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return text.strip(" ,;:-&+")


def _allowed(rules: VenueRules, rule: str) -> bool:
    return bool(getattr(rules, rule))


def _rewrite_fragment(frag: str, original: str, rules: VenueRules, hits: list[Hit]) -> str | None:
    """Apply removal rules and the candle rule to one clause. Returns None when the clause must go."""
    no_flame = not _allowed(rules, "live_candles")
    probe = _LIVE_ADJ.sub("", frag) if no_flame else frag  # "open-flame candles" is a candle, not a flame
    bad = [f for f in FORBIDDEN if not _allowed(rules, f.rule) and f.pattern.search(probe)]
    if bad:
        for f in bad:
            hits.append((f.rule, f"{_q(original)} needs {f.label}, which the venue does not allow",
                         f"Removed {_q(_clean(frag))}"))
        return None
    if no_flame and any(not ok for _, ok in _qualified_mentions(frag)):
        hits.append(("live_candles", f"{_q(original)} implies live flame; the venue allows flameless candles only", ""))
        return _make_flameless(frag)
    return frag


def _rewrite_item(text: str, rules: VenueRules, suffix: bool = True) -> tuple[str | None, list[Hit]]:
    """Apply rules to one free-text value, clause by clause.

    Returns (new_text, hits); new_text is None when nothing allowed is left. With `suffix`, a phrase whose
    tape/nail attachment was stripped is marked "(freestanding)"."""
    hits: list[Hit] = []
    current = text
    stripped = False
    for f in FORBIDDEN:
        if f.strip is None or _allowed(rules, f.rule) or not f.pattern.search(current):
            continue
        candidate = _clean(f.strip.sub("", current))
        if candidate and not f.pattern.search(candidate):
            hits.append((f.rule, f"{_q(text)} mentions {f.label}, which the venue does not allow", ""))
            current, stripped = candidate, True

    pieces = _CLAUSE.split(current)
    kept: list[str] = []
    for i in range(0, len(pieces), 2):
        new = _rewrite_fragment(pieces[i], text, rules, hits)
        if new is None or not new.strip():
            continue
        if kept:
            kept.append(pieces[i - 1])
        kept.append(new)
    if not hits:
        return text, []
    result = _clean("".join(kept)) or None
    if result and stripped and suffix:
        body, end = re.match(r"(.*?)([.!?]*)$", result, re.DOTALL).groups()
        result = f"{body} (freestanding){end}"
    final = f"Changed {_q(text)} to {_q(result)}" if result else f"Removed {_q(text)}"
    # Removal hits name the dropped clause; rewrite hits describe the final wording.
    return result, list(dict.fromkeys((rule, msg, fix or final) for rule, msg, fix in hits))


_SENTENCE = re.compile(r"(?<=[.!?;\n])\s+")


def _rewrite_notes(notes: str, rules: VenueRules) -> tuple[str | None, list[Hit]]:
    out: list[str] = []
    hits: list[Hit] = []
    for part in (p for p in _SENTENCE.split(notes) if p.strip()):
        new, h = _rewrite_item(part, rules)
        hits.extend(h)
        if new is not None:
            out.append(new)
    if not hits:
        return notes, []
    return _truncate(" ".join(out).strip(), NOTES_MAX) or None, hits


def _truncate(text: str, limit: int) -> str:
    """Cut at a word boundary so the result (with an ellipsis) never exceeds `limit` characters."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if " " in cut[limit // 2:]:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,;:") + "…"


def _text_fields(spec: DesignSpec) -> list[tuple[str, object, str, bool]]:
    """(pointer, parent object, attribute, required) for every single-string free-text field."""
    fields: list[tuple[str, object, str, bool]] = [("/space", spec, "space", True)]
    fields += [(f"/linens/{a}", spec.linens, a, a == "color") for a in ("color", "pattern", "runner")]
    if spec.napkins is not None:
        fields += [(f"/napkins/{a}", spec.napkins, a, False) for a in ("color", "fold")]
    fields += [(f"/chairs/{a}", spec.chairs, a, a in ("style", "color")) for a in ("style", "color", "cushion", "sash")]
    fields += [(f"/centerpieces/{a}", spec.centerpieces, a, False) for a in ("greenery", "container")]
    fields.append(("/lighting/uplighting", spec.lighting, "uplighting", False))
    return fields


def _list_fields(spec: DesignSpec) -> list[tuple[str, object, str, bool]]:
    """(pointer prefix, parent object, attribute, required-list) for every list of free-text strings."""
    return [
        ("/palette", spec, "palette", True),
        ("/centerpieces/flowers", spec.centerpieces, "flowers", False),
        ("/centerpieces/colors", spec.centerpieces, "colors", False),
        ("/extras", spec, "extras", True),
    ]


def check(spec: DesignSpec, rules: VenueRules | None) -> tuple[DesignSpec, list[RuleWarning]]:
    """Return (fixed copy of spec, warnings). The input spec is not modified.

    Every free-text string in the spec is scanned (not just flags, extras and notes), so a forbidden item
    cannot reach a prompt through, say, `centerpieces.container` or `palette`."""
    rules = rules or VenueRules()
    fixed = spec.model_copy(deep=True)
    defaults = default_spec()
    warnings: list[RuleWarning] = []

    def warn(rule: str, field: str, message: str, fix: str | None) -> None:
        warnings.append(RuleWarning(rule=rule, field=field, message=message, fix=fix))

    if not rules.live_candles and fixed.centerpieces.candles == "live":
        fixed.centerpieces.candles = "flameless"
        warn("live_candles", "/centerpieces/candles", "Live candles are not allowed at this venue",
             "Switched centerpiece candles to flameless")

    for rule, attr, msg in _EFFECTS:
        if not getattr(rules, rule) and getattr(fixed.effects, attr):
            setattr(fixed.effects, attr, False)
            warn(rule, f"/effects/{attr}", msg, f"Turned off {attr}")

    for rule, attr, msg in _INSTALL:
        if not getattr(rules, rule) and getattr(fixed.install, attr):
            setattr(fixed.install, attr, False)
            warn(rule, f"/install/{attr}", msg, f"Turned off {attr.replace('_', ' ')}")

    for pointer, parent, attr, required in _text_fields(fixed):
        value = getattr(parent, attr)
        if not value:
            continue
        new, hits = _rewrite_item(value, rules, suffix=False)
        if hits and new is None and required:
            new = _default_at(defaults, pointer)
            hits = [(rule, msg, f"Changed {_q(value)} to {_q(new)}") for rule, msg, _ in hits]
        for rule, msg, fix in hits:
            warn(rule, pointer, msg, fix)
        if hits:
            setattr(parent, attr, new)

    for pointer, parent, attr, required in _list_fields(fixed):
        items = getattr(parent, attr)
        if not items:
            continue
        kept: list[str] = []
        for i, item in enumerate(items):
            new, hits = _rewrite_item(item, rules, suffix=attr == "extras")
            for rule, msg, fix in hits:
                warn(rule, f"{pointer}/{i}", msg, fix)
            if new is not None:
                kept.append(new)
        if kept != items:
            setattr(parent, attr, kept if kept or required else None)

    if fixed.notes:
        new_notes, hits = _rewrite_notes(fixed.notes, rules)
        for rule, msg, fix in hits:
            warn(rule, "/notes", msg, fix)
        fixed.notes = _truncate(new_notes, NOTES_MAX) if new_notes else None

    return fixed, warnings


def _default_at(defaults: DesignSpec, pointer: str) -> str:
    obj: object = defaults
    for part in pointer.strip("/").split("/"):
        obj = getattr(obj, part)
    return str(obj)


def rule_notes(warnings: list[RuleWarning]) -> list[str]:
    """One plain sentence per venue-rule warning, e.g. for appending to a chat reply.

    Warnings that did not change the spec (such as `capacity`) are skipped."""
    notes: list[str] = []
    for w in warnings:
        reason = _REASONS.get(w.rule)
        if reason is None:
            continue
        action = (w.fix or w.message).rstrip(".")
        notes.append(f"{action} — {reason}.")
    return notes


def capacity_warnings(spec: DesignSpec) -> list[RuleWarning]:
    """Seat-count sanity check (not a venue rule; never modifies the spec)."""
    t = spec.tables
    if not spec.guest_count or not t.seats:
        return []
    seats = t.count * t.seats
    if seats >= spec.guest_count:
        return []
    need = -(-spec.guest_count // t.seats)
    return [RuleWarning(
        rule="capacity",
        field="/tables/count",
        message=f"{t.count} tables x {t.seats} seats = {seats} seats for {spec.guest_count} guests",
        fix=f"Consider at least {need} tables of {t.seats}",
    )]

