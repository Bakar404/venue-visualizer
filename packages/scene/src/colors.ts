const COLORS: Record<string, string> = {
  ivory: "#f3edda", blush: "#e7b7bb", sage: "#9eae95", champagne: "#dfcda9",
  gold: "#c4a052", silver: "#bdc3ca", navy: "#24364f", emerald: "#287658",
  burgundy: "#783745", "dusty blue": "#8ba6b8", terracotta: "#b9755e",
  black: "#252526", white: "#faf8f2", greenery: "#54744b", green: "#54744b",
  blue: "#719bbf", amber: "#e6b36b", "warm amber": "#e6b36b",
  pink: "#d9a1b2", cream: "#f1e5cb", red: "#af4f50", purple: "#9580a5",
  lavender: "#b6a9c8", peach: "#e9bd9f", wood: "#927354", brown: "#80634f",
};
const WORDS = Object.keys(COLORS).sort((a, b) => b.length - a.length);

export function colorFor(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized;
  for (const word of WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return COLORS[word];
  }
  let hash = 2166136261;
  for (const char of normalized) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  // Similar brightness and restrained saturation keep unknown names visually compatible.
  const hue = (hash % 360) / 60;
  const chroma = 0.22;
  const secondary = chroma * (1 - Math.abs(hue % 2 - 1));
  const channels = [
    [chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
    [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary],
  ][Math.floor(hue)];
  return "#" + channels.map(value => Math.round((value + 0.49) * 255).toString(16).padStart(2, "0")).join("");
}
