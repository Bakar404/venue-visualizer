// Writes the sample venue images to public/samples/. Run: node scripts/gen-samples.mjs
// Uses Node's built-in TypeScript type stripping (Node >= 22.18) to reuse the src/lib scene code.
import { writeFile } from "node:fs/promises";
import { renderSvg, roomSvg } from "../src/lib/mock-scene.ts";
import { colorFor, defaultSpec } from "../src/lib/spec.ts";

const out = new URL("../public/samples/", import.meta.url);
await writeFile(new URL("ballroom-north.svg", out), roomSvg("north"));
await writeFile(new URL("ballroom-corner.svg", out), roomSvg("corner"));

// The landing-page "after" image: the sample ballroom dressed in a blush and gold Look.
const spec = {
  ...defaultSpec(),
  palette: ["blush", "gold", "ivory"],
  linens: { color: "blush", length: "floor", runner: "gold" },
  centerpieces: { height: "tall", flowers: ["garden roses", "peonies"], colors: ["blush", "ivory"], greenery: "eucalyptus", candles: "flameless" },
  lighting: { uplighting: "warm amber", string_lights: true, ambient: "evening_warm" },
};
const colors = {
  linen: colorFor("blush"),
  chair: colorFor("gold"),
  runner: colorFor("gold"),
  flowers: ["blush", "ivory"].map(colorFor),
  greenery: colorFor("eucalyptus"),
  uplight: colorFor("warm amber"),
  accent: colorFor("blush"),
};
await writeFile(new URL("ballroom-north-dressed.svg", out), renderSvg("north", spec, colors, null, "Sample render"));
console.log("wrote public/samples/ballroom-north.svg, ballroom-corner.svg, ballroom-north-dressed.svg");
