import { describe, expect, it } from "vite-plus/test";

import type { GitGraphRef } from "@t3tools/contracts";

import {
  branchFilterOptions,
  branchFilterRefs,
  DEFAULT_BRANCH_FILTER,
  describeBranchFilter,
  globToRegExp,
  refMatchesGlob,
} from "./gitGraphBranches";

const refs: GitGraphRef[] = [
  { kind: "head", fullName: "refs/heads/main", name: "main", hash: "aaaa" },
  { kind: "head", fullName: "refs/heads/feature/login", name: "feature/login", hash: "bbbb" },
  { kind: "remote", fullName: "refs/remotes/origin/main", name: "origin/main", hash: "aaaa" },
  {
    kind: "remote",
    fullName: "refs/remotes/origin/feature/login",
    name: "origin/feature/login",
    hash: "cccc",
  },
  { kind: "tag", fullName: "refs/tags/v1", name: "v1", hash: "aaaa" },
];

describe("globToRegExp", () => {
  it("keeps a star inside one path segment and a double star across segments", () => {
    expect(globToRegExp("feature/*").test("feature/login")).toBe(true);
    expect(globToRegExp("feature/*").test("feature/a/login")).toBe(false);
    expect(globToRegExp("feature/**").test("feature/a/login")).toBe(true);
  });

  it("treats everything else literally, so a pattern cannot become a regex", () => {
    expect(globToRegExp("v1.0").test("v1.0")).toBe(true);
    expect(globToRegExp("v1.0").test("v1x0")).toBe(false);
    expect(globToRegExp("release+1").test("release+1")).toBe(true);
  });

  it("matches one character for each question mark", () => {
    expect(globToRegExp("v?").test("v1")).toBe(true);
    expect(globToRegExp("v?").test("v12")).toBe(false);
  });
});

describe("refMatchesGlob", () => {
  it("matches against the name without its refs prefix", () => {
    expect(refMatchesGlob("refs/heads/feature/login", "feature/*")).toBe(true);
    expect(refMatchesGlob("refs/remotes/origin/feature/login", "origin/feature/*")).toBe(true);
    expect(refMatchesGlob("refs/heads/main", "feature/*")).toBe(false);
  });
});

describe("branchFilterRefs", () => {
  const options = branchFilterOptions(refs, "main");

  it("shows everything when the filter is all", () => {
    expect(branchFilterRefs(DEFAULT_BRANCH_FILTER, options)).toBeUndefined();
  });

  it("shows only the selected refs, dropping ones that no longer exist", () => {
    expect(
      branchFilterRefs(
        { mode: "selected", selected: ["refs/heads/main", "refs/heads/deleted"], glob: "" },
        options,
      ),
    ).toEqual(["refs/heads/main"]);
  });

  it("expands a glob over the refs that exist", () => {
    expect(branchFilterRefs({ mode: "glob", selected: [], glob: "feature/*" }, options)).toEqual([
      "refs/heads/feature/login",
    ]);
    expect(branchFilterRefs({ mode: "glob", selected: [], glob: "nothing/*" }, options)).toEqual(
      [],
    );
  });

  it("says what the dropdown shows", () => {
    expect(describeBranchFilter(DEFAULT_BRANCH_FILTER, options)).toBe("All branches");
    expect(describeBranchFilter({ mode: "glob", selected: [], glob: "feature/*" }, options)).toBe(
      "Glob: feature/*",
    );
    expect(
      describeBranchFilter({ mode: "selected", selected: ["refs/heads/main"], glob: "" }, options),
    ).toBe("1 branches");
  });
});

describe("branchFilterOptions", () => {
  it("leaves tags out, leads with the checked-out branch, and names remotes", () => {
    const options = branchFilterOptions(refs, "main");
    expect(options.map((option) => option.name)).toEqual([
      "main",
      "feature/login",
      "origin/feature/login",
      "origin/main",
    ]);
    expect(options.find((option) => option.name === "origin/main")?.remote).toBe("origin");
    expect(options.find((option) => option.name === "main")?.remote).toBeNull();
  });
});
