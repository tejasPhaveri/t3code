import type { GitGraphLogResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildGitGraphRows, UNCOMMITTED_ROW_KEY } from "./gitGraphRows";

const commit = (hash: string, parents: string[], subject = hash) => ({
  hash,
  parents,
  author: "Tester",
  authorEmail: "tester@example.com",
  authorTime: 1,
  subject,
});

const log: GitGraphLogResult = {
  commits: [commit("cccc", ["bbbb"], "fix login"), commit("bbbb", ["aaaa"]), commit("aaaa", [])],
  hasMore: false,
  refs: [
    { kind: "head", fullName: "refs/heads/main", name: "main", hash: "cccc" },
    { kind: "remote", fullName: "refs/remotes/origin/main", name: "origin/main", hash: "cccc" },
    { kind: "remote", fullName: "refs/remotes/origin/old", name: "origin/old", hash: "bbbb" },
    { kind: "tag", fullName: "refs/tags/v1", name: "v1", hash: "aaaa" },
  ],
  head: { hash: "cccc", branch: "main" },
  stashes: [
    {
      hash: "5555",
      baseHash: "bbbb",
      selector: "stash@{0}",
      subject: "WIP on main",
      authorTime: 1,
    },
  ],
  remotes: ["origin"],
  uncommittedFileCount: 2,
};

describe("buildGitGraphRows", () => {
  it("puts uncommitted changes on top and each stash above its base commit", () => {
    const { items, layout } = buildGitGraphRows(log);

    expect(items.map((item) => item.key)).toEqual([
      UNCOMMITTED_ROW_KEY,
      "cccc",
      "stash:5555",
      "bbbb",
      "aaaa",
    ]);
    // The stash opens its own lane and joins its base commit.
    expect(layout.rows[2]!.column).toBe(1);
    expect(layout.rows[2]!.below).toContainEqual({ from: 1, to: 0, color: expect.any(Number) });
  });

  it("folds a remote branch into the local branch of the same name on the same commit", () => {
    const { items } = buildGitGraphRows(log);
    const head = items.find((item) => item.key === "cccc");
    const older = items.find((item) => item.key === "bbbb");

    expect(head?.kind === "commit" && head.branches).toEqual([
      {
        kind: "head",
        name: "main",
        fullName: "refs/heads/main",
        remotes: ["origin"],
        checkedOut: true,
      },
    ]);
    expect(older?.kind === "commit" && older.branches.map((branch) => branch.name)).toEqual([
      "origin/old",
    ]);
  });

  it("omits the uncommitted row for a clean working tree", () => {
    expect(buildGitGraphRows({ ...log, uncommittedFileCount: 0 }).items[0]?.key).toBe("cccc");
  });
});
