/**
 * Photoreal demo images in `public/samples/photoreal/` (AI-generated; see CREDITS.md there).
 * Each scene is one empty base photo plus the decorated versions of it ("Looks").
 */
export const SAMPLE_DIR = "/samples/photoreal";
export const SAMPLE_CREDITS_URL = `${SAMPLE_DIR}/CREDITS.md`;
export const SAMPLE_SIZE = { width: 1600, height: 1066 } as const;

export type SampleScene = "ballroom-a" | "ballroom-b" | "barn" | "terrace";
export type SampleLook = "blush" | "evergreen" | "string-lights" | "cocktail";

export const SAMPLES: Record<SampleScene, { empty: string; alt: string; looks: Partial<Record<SampleLook, { url: string; alt: string }>> }> = {
  "ballroom-a": {
    empty: `${SAMPLE_DIR}/ballroom-a-empty.jpg`,
    alt: "Empty ballroom with cream walls, arched windows, crystal chandeliers and a dark hardwood floor",
    looks: {
      blush: {
        url: `${SAMPLE_DIR}/ballroom-a-blush.jpg`,
        alt: "The same ballroom set with ivory linens, gold chiavari chairs, low blush and ivory centerpieces and warm amber uplighting",
      },
      evergreen: {
        url: `${SAMPLE_DIR}/ballroom-a-evergreen.jpg`,
        alt: "The same ballroom with eight round tables in sage-green linens, gold chiavari chairs and tall white rose and eucalyptus arrangements",
      },
    },
  },
  "ballroom-b": {
    empty: `${SAMPLE_DIR}/ballroom-b-empty.jpg`,
    alt: "The empty ballroom from the opposite corner, looking back toward the arched windows",
    looks: {
      blush: {
        url: `${SAMPLE_DIR}/ballroom-b-blush.jpg`,
        alt: "The ballroom from the opposite corner, set with ivory linens, gold chiavari chairs and blush centerpieces",
      },
    },
  },
  barn: {
    empty: `${SAMPLE_DIR}/barn-empty.jpg`,
    alt: "Empty rustic barn with timber trusses, whitewashed walls and open sliding doors at golden hour",
    looks: {
      "string-lights": {
        url: `${SAMPLE_DIR}/barn-string-lights.jpg`,
        alt: "The same barn with long farm tables, cross-back chairs, wildflower garlands and string lights between the beams",
      },
    },
  },
  terrace: {
    empty: `${SAMPLE_DIR}/terrace-empty.jpg`,
    alt: "Empty stone garden terrace at dusk with a balustrade, clipped hedges and a lawn beyond",
    looks: {
      cocktail: {
        url: `${SAMPLE_DIR}/terrace-cocktail.jpg`,
        alt: "The same terrace set for cocktail hour with high-top tables, a lounge sofa, festoon lights and lanterns",
      },
    },
  },
};

/** Before/after pairs shown on the landing page. */
export const SAMPLE_PAIRS: { id: string; title: string; caption: string; before: string; beforeAlt: string; after: string; afterAlt: string }[] = [
  {
    id: "evergreen",
    title: "Evergreen",
    caption: "Same ballroom, a second Look: sage linens and tall white roses.",
    before: SAMPLES["ballroom-a"].empty,
    beforeAlt: SAMPLES["ballroom-a"].alt,
    after: SAMPLES["ballroom-a"].looks.evergreen!.url,
    afterAlt: SAMPLES["ballroom-a"].looks.evergreen!.alt,
  },
  {
    id: "barn",
    title: "String lights",
    caption: "A barn with farm tables and bistro lights.",
    before: SAMPLES.barn.empty,
    beforeAlt: SAMPLES.barn.alt,
    after: SAMPLES.barn.looks["string-lights"]!.url,
    afterAlt: SAMPLES.barn.looks["string-lights"]!.alt,
  },
  {
    id: "terrace",
    title: "Cocktail hour",
    caption: "A terrace with high-tops, a lounge and festoon lights.",
    before: SAMPLES.terrace.empty,
    beforeAlt: SAMPLES.terrace.alt,
    after: SAMPLES.terrace.looks.cocktail!.url,
    afterAlt: SAMPLES.terrace.looks.cocktail!.alt,
  },
];
