import { describe, expect, it } from "vite-plus/test";

import type { GitGraphLogResult } from "@t3tools/contracts";

import { buildGitGraphRows } from "./gitGraphRows";
import { buildFindableRows, findMatchingRows, stepMatch } from "./gitGraphFind";

const commit = (hash: string, parents: string[], subject: string, author = "Tester") => ({
  hash,
  parents,
  author,
  authorEmail: `${author.toLowerCase()}@example.com`,
  authorTime: 1_792_698_791,
  subject,
});

const log: GitGraphLogResult = {
  commits: [
    commit("cccc", ["bbbb"], ":sparkles: add feature #12"),
    commit("bbbb", ["aaaa"], "fix login", "Someone Else"),
    commit("aaaa", [], "root"),
  ],
  hasMore: false,
  refs: [
    { kind: "head", fullName: "refs/heads/main", name: "main", hash: "cccc" },
    { kind: "remote", fullName: "refs/remotes/origin/main", name: "origin/main", hash: "cccc" },
    { kind: "tag", fullName: "refs/tags/v1.2.0", name: "v1.2.0", hash: "aaaa" },
  ],
  head: { hash: "cccc", branch: "main" },
  stashes: [],
  remotes: ["origin"],
  uncommittedFileCount: 0,
};

const rows = buildFindableRows(buildGitGraphRows(log).items);

describe("findMatchingRows", () => {
  it("matches a commit message, its hash, and its author", () => {
    expect(findMatchingRows(rows, "add feature")).toEqual([0]);
    expect(findMatchingRows(rows, "bbbb")).toEqual([1]);
    expect(findMatchingRows(rows, "someone else")).toEqual([1]);
  });

  it("matches a branch or tag name on the row it points at", () => {
    // `origin/main` is folded into the `main` label on the same commit, so the remote name is
    // not text the row shows; the local name and the tag are.
    expect(findMatchingRows(rows, "main")).toEqual([0]);
    expect(findMatchingRows(rows, "v1.2.0")).toEqual([2]);
  });

  it("matches through an emoji shortcode and ignores case", () => {
    expect(findMatchingRows(rows, "SPARKLES")).toEqual([0]);
    expect(findMatchingRows(rows, "✨")).toEqual([0]);
  });

  it("matches nothing for a blank query", () => {
    expect(findMatchingRows(rows, "   ")).toEqual([]);
  });
});

describe("stepMatch", () => {
  const matches = [1, 4, 9];

  it("walks forward and backward through the matches", () => {
    expect(stepMatch(matches, 1, 1)).toBe(4);
    expect(stepMatch(matches, 4, -1)).toBe(1);
  });

  it("wraps past either end", () => {
    expect(stepMatch(matches, 9, 1)).toBe(1);
    expect(stepMatch(matches, 1, -1)).toBe(9);
  });

  it("starts at the nearest end when the current row is not a match", () => {
    expect(stepMatch(matches, 5, 1)).toBe(1);
    expect(stepMatch(matches, 5, -1)).toBe(9);
    expect(stepMatch([], 5, 1)).toBeNull();
  });
});
