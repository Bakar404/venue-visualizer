"""Deterministic venue-rule enforcement. Pure functions: no I/O, no LLM.

`check()` only ever *restricts* a DesignSpec to what the venue's (user-entered) rules allow. When a
rule allows something, nothing is changed: this module never adds or invents rules.
Warning `field`s are JSON pointers into the *input* spec (so removed extras keep their original index).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .models import DesignSpec, RuleWarning, VenueRules

_FLAMELESS = re.compile(r"\b(flameless|led|battery|battery[- ]operated|electric|faux|fake)\b", re.IGNORECASE)
_CANDLE = re.compile(r"\b(candles?|candlelight|candlelit|candlesticks?|tapers?|votives?|tealights?|tea lights?)\b", re.IGNORECASE)
_LIVE_ADJ = re.compile(r"\b(live|real|lit|open[- ]flame|wax)\s+(?=(?:\w+\s+)?(?:candle|taper|votive|tea))", re.IGNORECASE)


@dataclass(frozen=True)
class _Forbidden:
    rule: str             # VenueRules field name (also used as RuleWarning.rule)
    pattern: re.Pattern   # matches a forbidden mention in free text
    label: str            # human description for messages
    strip: re.Pattern | None = None  # phrases to strip to *rewrite* instead of removing


_ATTACH_VERB = r"(?:taped|nailed|glued|stuck|attached|hung|mounted|fixed|secured|fastened|affixed)"

FORBIDDEN: list[_Forbidden] = [
    _Forbidden("fog", re.compile(r"\b(fog|foggy|haze|hazer|hazers|fogger|smoke machine|dry ice|low[- ]lying fog)\b", re.IGNORECASE),
               "fog/haze effects"),
    _Forbidden("confetti", re.compile(r"\bconfetti\b", re.IGNORECASE), "confetti"),
    _Forbidden("sparklers", re.compile(r"\bsparklers?\b", re.IGNORECASE), "sparklers"),
    _Forbidden(
        "adhesives",
        re.compile(r"\b(tape|taped|taping|adhesives?|glue|glued|command strips?)\b", re.IGNORECASE),
        "tape/adhesives",
        re.compile(
            rf"\s*,?\s*(?:{_ATTACH_VERB}\s+)?(?:with|using|via|by)\s+(?:\w+\s+)?(?:tape|adhesives?|glue|command strips?)\b"
            rf"|\s*,?\s*\b(?:taped|glued)\b(?:\s+(?:to|on|onto)\s+(?:the\s+)?\w+)?",
            re.IGNORECASE,
        ),
    ),
    _Forbidden(
        "nails",
        re.compile(r"\b(nails?|nailed|tacks?|thumbtacks?|staples?|stapled)\b", re.IGNORECASE),
        "nails/tacks",
        re.compile(
            rf"\s*,?\s*(?:{_ATTACH_VERB}\s+)?(?:with|using|via|by)\s+(?:\w+\s+)?(?:nails?|tacks?|thumbtacks?|staples?)\b"
            rf"|\s*,?\s*\b(?:nailed|stapled)\b(?:\s+(?:to|on|onto|into)\s+(?:the\s+)?\w+)?",
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


def _make_flameless(text: str) -> str:
    """'taper candles' -> 'flameless taper candles'; 'live candles' -> 'flameless candles'."""
    text = _LIVE_ADJ.sub("", text)
    m = _CANDLE.search(text)
    if not m:
        return text
    start = m.start()
    if start == 0 and text[:1].isupper():
        return "Flameless " + text[0].lower() + text[1:]
    return text[:start] + "flameless " + text[start:]


def _clean(text: str) -> str:
    text = re.sub(r"\s{2,}", " ", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return text.strip(" ,;:-")


def _rewrite_item(text: str, rules: VenueRules) -> tuple[str | None, list[tuple[str, str, str]]]:
    """Apply rules to one free-text item. Returns (new_text or None if removed, [(rule, message, fix)])."""
    hits: list[tuple[str, str, str]] = []
    current = text
    removed = False
    for f in FORBIDDEN:
        if getattr(rules, f.rule) or not f.pattern.search(current):
            continue
        if f.strip is not None:
            candidate = _clean(f.strip.sub("", current))
            if candidate and not f.pattern.search(candidate):
                candidate = f"{candidate} (freestanding)"
                hits.append((f.rule, f"'{text}' mentions {f.label}, which the venue does not allow",
                             f"Rewrote to '{candidate}'"))
                current = candidate
                continue
        hits.append((f.rule, f"'{text}' needs {f.label}, which the venue does not allow", f"Removed '{text}'"))
        removed = True
    if removed:
        return None, hits
    if not rules.live_candles and _CANDLE.search(current) and not _FLAMELESS.search(current):
        candidate = _make_flameless(current)
        hits.append(("live_candles", f"'{text}' implies live flame; the venue allows flameless candles only",
                     f"Rewrote to '{candidate}'"))
        current = candidate
    return current, hits


_SENTENCE = re.compile(r"(?<=[.!?;\n])\s+")


def _rewrite_notes(notes: str, rules: VenueRules) -> tuple[str | None, list[tuple[str, str, str]]]:
    parts = [p for p in _SENTENCE.split(notes) if p.strip()]
    out: list[str] = []
    hits: list[tuple[str, str, str]] = []
    for part in parts:
        new, h = _rewrite_item(part, rules)
        hits.extend(h)
        if new is not None:
            out.append(new)
    if not hits:
        return notes, []
    joined = " ".join(out).strip()
    return (joined or None), hits


def check(spec: DesignSpec, rules: VenueRules | None) -> tuple[DesignSpec, list[RuleWarning]]:
    """Return (fixed copy of spec, warnings). The input spec is not modified."""
    rules = rules or VenueRules()
    fixed = spec.model_copy(deep=True)
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

    new_extras: list[str] = []
    for i, item in enumerate(fixed.extras):
        new, hits = _rewrite_item(item, rules)
        for rule, msg, fix in hits:
            warn(rule, f"/extras/{i}", msg, fix)
        if new is not None:
            new_extras.append(new)
    fixed.extras = new_extras

    if fixed.notes:
        new_notes, hits = _rewrite_notes(fixed.notes, rules)
        for rule, msg, fix in hits:
            warn(rule, "/notes", msg, fix)
        fixed.notes = new_notes

    return fixed, warnings


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

