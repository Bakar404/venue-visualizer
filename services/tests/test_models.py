from __future__ import annotations

import jsonschema

from pipeline import schema_gen
from pipeline.models import DesignSpec, VenueRules, default_spec, load_schema, venue_def_schema


def test_models_match_json_schemas():
    assert schema_gen.check_models() == []


def test_default_spec_is_schema_valid_and_sensible():
    spec = default_spec("ballroom")
    jsonschema.validate(spec.to_dict(), load_schema("design-spec"))
    assert spec.space == "ballroom"
    assert (spec.tables.shape, spec.tables.size_in, spec.tables.seats) == ("round", 60, 8)
    assert spec.linens.color == "ivory"
    assert (spec.chairs.style, spec.chairs.color) == ("chiavari", "gold")
    assert spec.centerpieces.height == "low" and spec.centerpieces.candles == "none"
    assert "warm" in (spec.lighting.uplighting or "")


def test_venue_rules_defaults_allow_everything():
    rules = VenueRules()
    jsonschema.validate(rules.to_dict(), venue_def_schema("VenueRules"))
    assert all(getattr(rules, f) for f in ("live_candles", "fog", "confetti", "sparklers", "adhesives", "nails",
                                          "ceiling_draping"))


def test_spec_round_trips():
    data = default_spec().to_dict()
    assert DesignSpec.model_validate(data).to_dict() == data
