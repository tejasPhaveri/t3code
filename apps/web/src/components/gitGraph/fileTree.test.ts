import { describe, expect, it } from "vite-plus/test";

import { buildFileTree, type FileTreeNode } from "./fileTree";

const outline = (nodes: readonly FileTreeNode[]): unknown[] =>
  nodes.map((node) => (node.file ? node.name : { [node.name]: outline(node.children) }));

describe("buildFileTree", () => {
  it("nests folders before files and compacts single-folder chains", () => {
    const tree = buildFileTree([
      { path: "README.md", status: "modified" },
      { path: "apps/web/src/a.ts", status: "modified" },
      { path: "apps/web/src/b.ts", status: "added" },
      { path: "apps/server/src/c.ts", status: "deleted" },
    ]);

    expect(outline(tree)).toEqual([
      { apps: [{ "server/src": ["c.ts"] }, { "web/src": ["a.ts", "b.ts"] }] },
      "README.md",
    ]);
  });

  it("gives every folder the files under it for folder-wide actions", () => {
    const [apps] = buildFileTree([
      { path: "apps/web/a.ts", status: "modified" },
      { path: "apps/server/b.ts", status: "modified" },
    ]);

    expect(apps?.filePaths.toSorted()).toEqual(["apps/server/b.ts", "apps/web/a.ts"]);
  });
});
