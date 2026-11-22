from __future__ import annotations

from pipeline.models import VenueRules, default_spec
from pipeline.rules import capacity_warnings, check

STRICT = VenueRules(live_candles=False, fog=False, confetti=False, sparklers=False, adhesives=False, nails=False,
                    ceiling_draping=False)


def _spec(**changes):
    spec = default_spec()
    for path, value in changes.items():
        obj = spec
        *parents, last = path.split("__")
        for p in parents:
            obj = getattr(obj, p)
        setattr(obj, last, value)
    return spec


def test_live_candles_become_flameless_with_warning():
    spec = _spec(centerpieces__candles="live")
    fixed, warnings = check(spec, VenueRules(live_candles=False))
    assert fixed.centerpieces.candles == "flameless"
    assert spec.centerpieces.candles == "live"  # input untouched
    assert [(w.rule, w.field) for w in warnings] == [("live_candles", "/centerpieces/candles")]


def test_effects_and_install_flags_are_turned_off():
    spec = _spec(effects__fog=True, effects__confetti=True, effects__sparklers=True,
                 install__uses_adhesives=True, install__uses_nails=True, install__ceiling_draping=True)
    fixed, warnings = check(spec, STRICT)
    assert not any(fixed.effects.model_dump().values())
    assert not any(fixed.install.model_dump().values())
    fields = {w.field for w in warnings}
    assert {"/effects/fog", "/effects/confetti", "/effects/sparklers", "/install/uses_adhesives",
            "/install/uses_nails", "/install/ceiling_draping"} <= fields
    assert {w.rule for w in warnings} == {"fog", "confetti", "sparklers", "adhesives", "nails", "ceiling_draping"}


def test_extras_are_rewritten_or_removed():
    spec = _spec(extras=["taper candles", "Low-lying fog for the first dance", "confetti cannons",
                         "dance floor", "flameless votives", "Welcome sign taped to the wall"])
    fixed, warnings = check(spec, STRICT)
    assert fixed.extras[0] == "flameless taper candles"
    assert "dance floor" in fixed.extras and "flameless votives" in fixed.extras
    assert not any("fog" in e.lower() or "confetti" in e.lower() for e in fixed.extras)
    assert not any("taped" in e.lower() for e in fixed.extras)
    assert any(e.lower().startswith("welcome sign") for e in fixed.extras)
    by_field = {w.field: w.rule for w in warnings}
    assert by_field["/extras/0"] == "live_candles"
    assert by_field["/extras/1"] == "fog"
    assert by_field["/extras/2"] == "confetti"
    assert by_field["/extras/5"] == "adhesives"
    assert "/extras/3" not in by_field and "/extras/4" not in by_field


def test_notes_are_scanned_case_insensitively():
    spec = _spec(notes="Guests get SPARKLERS for the exit. Hang garland with Nails above the bar.")
    fixed, warnings = check(spec, STRICT)
    assert "sparkler" not in (fixed.notes or "").lower()
    assert "nail" not in (fixed.notes or "").lower()
    assert {w.rule for w in warnings} == {"sparklers", "nails"}
    assert all(w.field == "/notes" for w in warnings)


def test_nothing_changes_when_rules_allow_everything():
    spec = _spec(centerpieces__candles="live", effects__fog=True, install__uses_nails=True,
                 extras=["taper candles", "confetti cannons", "sign taped to the wall"],
                 notes="Sparklers and haze at the exit.")
    for rules in (VenueRules(), None):
        fixed, warnings = check(spec, rules)
        assert warnings == []
        assert fixed == spec


def test_rules_never_add_items():
    spec = _spec(extras=["dance floor"], centerpieces__candles="none")
    fixed, warnings = check(spec, STRICT)
    assert warnings == [] and fixed.extras == ["dance floor"] and fixed.centerpieces.candles == "none"


def test_capacity_warning():
    spec = _spec(guest_count=150)
    spec.tables.count, spec.tables.seats = 12, 8
    [w] = capacity_warnings(spec)
    assert (w.rule, w.field) == ("capacity", "/tables/count")
    assert "96" in w.message and "150" in w.message
    spec.tables.count = 19
    assert capacity_warnings(spec) == []


def test_flameless_elsewhere_does_not_exempt_live_candles():
    spec = _spec(extras=["LED garlands and live candles", "LED uplighting near candles", "battery tea lights",
                         "flameless pillar candles"])
    fixed, warnings = check(spec, VenueRules(live_candles=False))
    assert fixed.extras == ["LED garlands and flameless candles", "LED uplighting near flameless candles",
                            "battery tea lights", "flameless pillar candles"]
    assert [w.field for w in warnings if w.rule == "live_candles"] == ["/extras/0", "/extras/1"]
    again, more = check(fixed, VenueRules(live_candles=False))
    assert again.extras == fixed.extras and not [w for w in more if w.rule == "live_candles"]


def test_free_text_fields_are_scanned_with_pointers():
    spec = _spec(centerpieces__container="glass hurricane with taper candles",
                 palette=["ivory", "gold confetti", "sage"], lighting__uplighting="warm amber with haze",
                 linens__runner="taped-down gold runner", chairs__sash="sparkler-themed sash",
                 space="fog-filled ballroom")
    fixed, warnings = check(spec, STRICT)
    assert fixed.centerpieces.container == "glass hurricane with flameless taper candles"
    assert fixed.palette == ["ivory", "sage"]
    assert fixed.lighting.uplighting == "warm amber"
    assert fixed.linens.runner == "gold runner"
    assert fixed.chairs.sash is None  # optional field emptied → removed
    assert fixed.space == default_spec().space  # required field emptied → default
    assert {(w.rule, w.field) for w in warnings} >= {
        ("live_candles", "/centerpieces/container"), ("confetti", "/palette/1"), ("fog", "/lighting/uplighting"),
        ("adhesives", "/linens/runner"), ("sparklers", "/chairs/sash"), ("fog", "/space")}


def test_long_notes_rewrite_is_truncated_not_raised():
    notes = ("We love live candles. " * 95)[:1995]
    spec = _spec(notes=notes)
    fixed, warnings = check(spec, VenueRules(live_candles=False))
    assert len(fixed.notes) <= 2000 and "live candles" not in fixed.notes
    assert any(w.field == "/notes" for w in warnings)


def test_rule_notes_are_human_sentences():
    from pipeline.rules import rule_notes

    _, warnings = check(_spec(centerpieces__candles="live", palette=["gold confetti"]), STRICT)
    notes = rule_notes(warnings)
    assert any("flameless" in n and "open flames" in n for n in notes)
    assert "Removed 'gold confetti' — the venue doesn't allow confetti." in notes
    assert all(n.endswith(".") for n in notes)
