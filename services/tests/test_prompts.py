from __future__ import annotations

import json

from pipeline.models import VenueRules, VenueSpec, default_spec
from pipeline.prompts import (
    CHAT_RESPONSE_SCHEMA,
    KEEP_UNCHANGED,
    PHOTOREAL,
    SPEC_SYSTEM_PROMPT,
    build_base_prompt,
    build_chat_messages,
    build_edit_prompt,
    build_layout_guide_clause,
)


def test_edit_prompt_lists_decor_and_keep_clause():
    spec = default_spec()
    spec.linens.color = "dusty blue"
    spec.chairs.color = "silver"
    spec.extras = ["white dance floor"]
    prompt = build_edit_prompt(spec, VenueSpec(walls="oak paneling", fixtures=["crystal chandeliers"]))
    assert KEEP_UNCHANGED in prompt
    assert prompt.rstrip().endswith(KEEP_UNCHANGED)
    for needle in ("dusty blue", "silver", "chiavari", "60", "white dance floor", "uplighting",
                   "oak paneling", "crystal chandeliers"):
        assert needle in prompt
    assert "Keep EXACTLY unchanged: walls, windows, doors, ceiling, chandeliers and fixtures, floor material, " \
           "camera position, lens and framing." in prompt


def test_edit_prompt_mentions_flameless_candles():
    spec = default_spec()
    spec.centerpieces.candles = "flameless"
    assert "flameless" in build_edit_prompt(spec).lower()


def test_base_prompt_is_empty_room():
    prompt = build_base_prompt(VenueSpec(style="industrial loft", length_ft=80, width_ft=40, ceiling_ft=20,
                                         floor="polished concrete"))
    low = prompt.lower()
    for needle in ("wide-angle", "eye-level", "architectural", "no furniture", "no people", "industrial loft",
                   "polished concrete", "80 by 40"):
        assert needle in low
    assert "empty" in build_base_prompt(None).lower()


def test_chat_messages_and_schema():
    spec = default_spec()
    system, user = build_chat_messages("blush napkins", spec, VenueSpec(style="ballroom"),
                                       VenueRules(live_candles=False, provided_items=["chiavari chairs"]))
    assert system.startswith(SPEC_SYSTEM_PROMPT)
    low = system.lower()
    assert "default" in low and "ambiguit" in low and "never invent venue rules" in low and "palette" in low
    assert "blush napkins" in user and json.dumps(spec.palette[0]) in user
    assert '"live_candles": false' in user and "chiavari chairs" in user
    assert CHAT_RESPONSE_SCHEMA["required"] == ["reply", "spec_patch", "ambiguities"]
    assert CHAT_RESPONSE_SCHEMA["properties"]["spec_patch"]["type"] == "object"


def test_photoreal_clause_in_edit_and_base_prompts():
    assert PHOTOREAL == ("A real photograph by a professional event photographer: full-frame camera, 24mm lens, "
                         "eye level, natural exposure, realistic materials and imperfections. Not an illustration, "
                         "not CGI, no people, no text.")
    assert PHOTOREAL in build_edit_prompt(default_spec())
    assert PHOTOREAL in build_base_prompt(VenueSpec(style="ballroom"))
    assert PHOTOREAL in build_base_prompt(None)


def test_layout_guide_clause():
    assert build_layout_guide_clause(12, "round") == (
        "A second reference image is a plain top-down/eye-level layout guide: place exactly 12 round tables "
        "in the positions it shows; do not copy its style.")
    assert "exactly 1 " in build_layout_guide_clause(1, "rectangular") and "tables" not in \
        build_layout_guide_clause(1, "rectangular")
    spec = default_spec()
    spec.tables.count = 7
    with_guide = build_edit_prompt(spec, layout_guide=True)
    assert build_layout_guide_clause(7, spec.tables.shape) in with_guide
    assert with_guide.rstrip().endswith(KEEP_UNCHANGED)
    assert "layout guide" not in build_edit_prompt(spec)
