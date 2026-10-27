import type { GitGraphCommit } from "@t3tools/contracts";

import type { GitGraphRowItem } from "./gitGraphRows";
import { replaceEmojiShortcodes } from "./gitGraphFormat";

/**
 * Git Graph's Find widget matches a phrase anywhere a reader can see it: the commit message,
 * its date and author, its hash, and the branch and tag names on that row. Everything is
 * lowercased once so a scan over thousands of commits stays a plain substring test.
 */
export interface FindableRow {
  readonly key: string;
  readonly haystack: string;
}

const dateText = (unixSeconds: number): string => {
  const date = new Date(unixSeconds * 1000);
  // The visible date is locale-formatted, but matching the ISO form lets a reader type `2024-05`.
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)}`;
};

function commitHaystack(commit: GitGraphCommit): string {
  return [
    commit.subject,
    replaceEmojiShortcodes(commit.subject),
    commit.hash,
    commit.author,
    commit.authorEmail,
    dateText(commit.authorTime),
  ]
    .join("\n")
    .toLowerCase();
}

export function buildFindableRows(items: readonly GitGraphRowItem[]): readonly FindableRow[] {
  return items.map((item) => {
    switch (item.kind) {
      case "uncommitted":
        return { key: item.key, haystack: "uncommitted changes working tree" };
      case "stash":
        return {
          key: item.key,
          haystack: [
            item.stash.selector,
            item.stash.subject,
            item.stash.hash,
            dateText(item.stash.authorTime),
          ]
            .join("\n")
            .toLowerCase(),
        };
      case "commit":
        return {
          key: item.key,
          haystack: [
            commitHaystack(item.commit),
            ...item.branches.flatMap((branch) => [branch.name, branch.fullName, ...branch.remotes]),
            ...item.tags.map((tag) => tag.name),
          ]
            .join("\n")
            .toLowerCase(),
        };
    }
  });
}

/** Row indexes matching `query`; an empty query matches nothing. */
export function findMatchingRows(rows: readonly FindableRow[], query: string): readonly number[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const matches: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.haystack.includes(needle)) matches.push(index);
  }
  return matches;
}

/**
 * The match to move to. `step` is +1 for the next match and -1 for the previous; past the last
 * match it wraps, as Git Graph's find widget does.
 */
export function stepMatch(
  matches: readonly number[],
  current: number,
  step: 1 | -1,
): number | null {
  if (matches.length === 0) return null;
  const position = matches.indexOf(current);
  if (position === -1) return step === 1 ? matches[0]! : matches.at(-1)!;
  const next = (position + step + matches.length) % matches.length;
  return matches[next]!;
}
