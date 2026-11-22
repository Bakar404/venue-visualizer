/** Renders the API's `code` spans (backticks in CLI messages) as monospace text. */
export function Ticks({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
