import { describe, expect, it } from "vite-plus/test";

import {
  insertRankedSearchResult,
  isAgentSkillPath,
  orderAgentSkillPathsFirst,
  prefersAgentSkillPaths,
  scoreQueryMatch,
  scoreSubsequenceMatch,
} from "./searchRanking.ts";

describe("scoreQueryMatch", () => {
  it("treats boundary matches as stronger than generic contains matches", () => {
    const boundaryScore = scoreQueryMatch({
      value: "gh-fix-ci",
      query: "fix",
      exactBase: 0,
      prefixBase: 10,
      boundaryBase: 20,
      includesBase: 30,
      boundaryMarkers: ["-"],
    });
    const containsScore = scoreQueryMatch({
      value: "highfixci",
      query: "fix",
      exactBase: 0,
      prefixBase: 10,
      boundaryBase: 20,
      includesBase: 30,
      boundaryMarkers: ["-"],
    });

    expect(boundaryScore).not.toBeNull();
    expect(containsScore).not.toBeNull();
    expect(boundaryScore!).toBeLessThan(containsScore!);
  });
});

describe("scoreSubsequenceMatch", () => {
  it("scores tighter subsequences ahead of looser ones", () => {
    const compact = scoreSubsequenceMatch("ghfixci", "gfc");
    const spread = scoreSubsequenceMatch("github-fix-ci", "gfc");

    expect(compact).not.toBeNull();
    expect(spread).not.toBeNull();
    expect(compact!).toBeLessThan(spread!);
  });
});

describe("insertRankedSearchResult", () => {
  it("keeps the best-ranked candidates within the limit", () => {
    const ranked = [
      { item: "b", score: 20, tieBreaker: "b" },
      { item: "d", score: 40, tieBreaker: "d" },
    ];

    insertRankedSearchResult(ranked, { item: "a", score: 10, tieBreaker: "a" }, 2);
    insertRankedSearchResult(ranked, { item: "c", score: 30, tieBreaker: "c" }, 2);

    expect(ranked.map((entry) => entry.item)).toEqual(["a", "b"]);
  });
});

describe("orderAgentSkillPathsFirst", () => {
  it("keeps skill directories ahead of other paths and stable within each group", () => {
    expect(
      isAgentSkillPath(".agents/skills/review/SKILL.md") &&
        isAgentSkillPath(".claude/skills/review/SKILL.md") &&
        isAgentSkillPath(".cursor/skills-cursor/builtin/SKILL.md") &&
        isAgentSkillPath("skills/guide.md") &&
        isAgentSkillPath("SKILL.md"),
    ).toBe(true);
    expect(
      isAgentSkillPath("src/agent.ts") ||
        isAgentSkillPath("packages/provider-cursor/src/server/skills.ts") ||
        isAgentSkillPath("README.md"),
    ).toBe(false);

    expect(
      orderAgentSkillPathsFirst([
        { path: "README.md" },
        { path: ".agents/skills/review/SKILL.md" },
        { path: "src/app.ts" },
        { path: "skills/guide.md" },
      ]).map((entry) => entry.path),
    ).toEqual([".agents/skills/review/SKILL.md", "skills/guide.md", "README.md", "src/app.ts"]);
  });

  it("boosts an empty mention and skill-directory prefixes only", () => {
    expect(prefersAgentSkillPaths("")).toBe(true);
    expect(prefersAgentSkillPaths("agents")).toBe(true);
    expect(prefersAgentSkillPaths("sk")).toBe(true);
    expect(prefersAgentSkillPaths("a")).toBe(false);
    expect(prefersAgentSkillPaths("readme")).toBe(false);
  });
});
