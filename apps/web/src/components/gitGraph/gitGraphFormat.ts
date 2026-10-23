const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatGitGraphDate(unixSeconds: number): string {
  return DATE_FORMAT.format(new Date(unixSeconds * 1000));
}

export function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

/** Lane colors, chosen to stay distinct from each other on light and dark backgrounds. */
const GIT_GRAPH_COLORS = [
  "#0085d9",
  "#d9008f",
  "#00d90a",
  "#d98500",
  "#a300d9",
  "#ff0000",
  "#00d9cc",
  "#e138e8",
  "#85d900",
  "#dc5b23",
  "#6f24d6",
  "#ffcc00",
] as const;

export function gitGraphColor(index: number): string {
  return GIT_GRAPH_COLORS[index % GIT_GRAPH_COLORS.length]!;
}
