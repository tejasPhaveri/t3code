import type { BrowserBookmark } from "@t3tools/contracts";

// The file is the user's own, but anything running as them can write it; bounds keep a huge or
// deeply nested one from stalling the bar.
const MAX_DEPTH = 8;
const MAX_BOOKMARKS = 5_000;

interface ChromiumBookmarkNode {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly url?: unknown;
  readonly children?: unknown;
}

const isNode = (value: unknown): value is ChromiumBookmarkNode =>
  typeof value === "object" && value !== null;

/**
 * The bookmarks bar of a Chromium profile's `Bookmarks` file, with "Other bookmarks" as a last
 * folder as Chrome shows it. Null when the file is not a bookmarks file.
 */
export function parseChromiumBookmarkBar(text: string): BrowserBookmark[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isNode(parsed) || !("roots" in parsed) || !isNode(parsed.roots)) return null;
  const roots = parsed.roots as Record<string, unknown>;
  let remaining = MAX_BOOKMARKS;

  const convert = (node: unknown, depth: number): BrowserBookmark | null => {
    if (!isNode(node) || remaining <= 0) return null;
    const name = typeof node.name === "string" ? node.name : "";
    if (node.type === "url") {
      // A bookmarklet would run its script in whatever page the tab shows.
      if (typeof node.url !== "string" || /^javascript:/i.test(node.url)) return null;
      remaining -= 1;
      return { name: name || node.url, url: node.url };
    }
    if (node.type === "folder" && depth < MAX_DEPTH) {
      remaining -= 1;
      return { name, children: convertAll(node.children, depth + 1) };
    }
    return null;
  };
  const convertAll = (children: unknown, depth: number): BrowserBookmark[] =>
    Array.isArray(children)
      ? children.flatMap((child) => {
          const converted = convert(child, depth);
          return converted ? [converted] : [];
        })
      : [];

  const bar = isNode(roots.bookmark_bar) ? convertAll(roots.bookmark_bar.children, 1) : [];
  const other = isNode(roots.other) ? convertAll(roots.other.children, 1) : [];
  return other.length > 0 ? [...bar, { name: "Other bookmarks", children: other }] : bar;
}
