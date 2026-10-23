import { describe, expect, it } from "vite-plus/test";

import { layoutGitGraph } from "./layout.ts";

describe("layoutGitGraph", () => {
  it("keeps straight history in one lane and color", () => {
    const layout = layoutGitGraph([
      { hash: "c", parents: ["b"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);

    expect(layout.laneCount).toBe(1);
    expect(layout.rows.map((row) => [row.column, row.color])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(layout.rows.map((row) => row.below)).toEqual([
      [{ from: 0, to: 0, color: 0 }],
      [{ from: 0, to: 0, color: 0 }],
      [],
    ]);
  });

  it("opens a lane for a merged branch and closes it at the fork point", () => {
    // m merges feature (f) into main (b); both come from a.
    const layout = layoutGitGraph([
      { hash: "m", parents: ["b", "f"] },
      { hash: "f", parents: ["a"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);

    expect(layout.laneCount).toBe(2);
    expect(layout.rows.map((row) => row.column)).toEqual([0, 1, 0, 0]);
    // The merge line leaves the node and lands on the feature commit in lane 1.
    expect(layout.rows[0]!.below).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 0, to: 1, color: 1 },
    ]);
    // Both lanes wait for a; the feature lane bends back into a's lane.
    expect(layout.rows[2]!.below).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 1, to: 0, color: 1 },
    ]);
    expect(layout.rows[3]!.below).toEqual([]);
  });

  it("gives each branch tip its own color and reuses freed lanes", () => {
    const layout = layoutGitGraph([
      { hash: "x", parents: ["a"] },
      { hash: "y", parents: ["a"] },
      { hash: "a", parents: [] },
      { hash: "z", parents: [] },
    ]);

    expect(layout.rows.map((row) => [row.column, row.color])).toEqual([
      [0, 0],
      [1, 1],
      [0, 0],
      [0, 2],
    ]);
  });
});
