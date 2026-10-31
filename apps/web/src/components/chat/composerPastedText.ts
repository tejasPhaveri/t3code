/**
 * Any multi-line paste, or one long line, is material for the agent rather than
 * prose being written, so it folds into a read-only block. A short line stays inline.
 */
const COLLAPSED_PASTE_MIN_CHARS = 300;

/** The fence language marking a block as pasted material rather than code. */
export const PASTED_CONTENT_FENCE_LANGUAGE = "pasted-content";

export function pastedTextLineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

export function shouldCollapsePastedText(text: string): boolean {
  return pastedTextLineCount(text.trim()) >= 2 || text.length >= COLLAPSED_PASTE_MIN_CHARS;
}

/** Longer than any fence run inside the text, so it cannot close the block early. */
function fenceFor(text: string): string {
  const longest = Math.max(
    0,
    ...text.split("\n").map((line) => /^(`+)[ \t]*\r?$/.exec(line)?.[1]?.length ?? 0),
  );
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * The paste as a fenced block the composer shows folded, or null when it belongs
 * inline. The fence keeps the text verbatim, so the agent still receives all of
 * it, and the block round-trips because the stored draft is this same markdown.
 */
export function collapsePastedTextAsBlock(text: string): string | null {
  if (!shouldCollapsePastedText(text)) return null;
  const fence = fenceFor(text);
  return `${fence}${PASTED_CONTENT_FENCE_LANGUAGE}\n${text}\n${fence}`;
}
