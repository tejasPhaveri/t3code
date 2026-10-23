import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type { GitCommandError } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import {
  countPorcelainEntries,
  GitGraphService,
  layer as gitGraphLayer,
  parseFetchPrunedRefs,
  parseGitGraphLog,
  parseGitGraphRefs,
  parseGitGraphStashes,
  parseGitStatusV2,
  parseGitWorktreeList,
} from "./GitGraphService.ts";

// Captured from git 2.x with the service's format strings.
const F = "\x1f";

describe("parsers", () => {
  it("reads merge parents, root commits, and subjects", () => {
    const stdout =
      `aaaa${F}bbbb cccc${F}Tester${F}a@b.c${F}1792698791${F}merge feature\x1e\n` +
      `dddd${F}${F}Tester${F}a@b.c${F}1792698790${F}root\x1e\n`;
    assert.deepStrictEqual(
      parseGitGraphLog(stdout).map((commit) => [commit.hash, commit.parents, commit.subject]),
      [
        ["aaaa", ["bbbb", "cccc"], "merge feature"],
        ["dddd", [], "root"],
      ],
    );
  });

  it("peels annotated tags and skips a remote's HEAD alias", () => {
    const stdout = [
      `aaaa${F}${F}refs/heads/feature/login`,
      `bbbb${F}${F}refs/remotes/origin/main`,
      `cccc${F}${F}refs/remotes/origin/HEAD`,
      `dddd${F}eeee${F}refs/tags/v1`,
    ].join("\n");
    assert.deepStrictEqual(
      parseGitGraphRefs(stdout).map((ref) => [ref.kind, ref.name, ref.hash]),
      [
        ["head", "feature/login", "aaaa"],
        ["remote", "origin/main", "bbbb"],
        ["tag", "v1", "eeee"],
      ],
    );
  });

  it("anchors a stash to the commit it was made on", () => {
    const stdout = `9aba${F}5d97 1d82${F}stash@{0}${F}1792698791${F}WIP on main`;
    assert.deepStrictEqual(parseGitGraphStashes(stdout)[0]?.baseHash, "5d97");
  });

  it("counts a rename once despite its extra source field", () => {
    assert.strictEqual(countPorcelainEntries(" M c.txt\0?? new.txt\0"), 2);
    assert.strictEqual(countPorcelainEntries("R  new.txt\0old.txt\0 M c.txt\0"), 2);
  });

  it("splits porcelain v2 status into staged and unstaged, keeping spaces and renames", () => {
    const stdout = [
      "1 .M N... 100644 100644 100644 f2ad f2ad c.txt",
      "2 R. N... 100644 100644 100644 422c 422c R100 renamed2.txt",
      "renamed.txt",
      "1 AM N... 000000 100644 100644 0000 587b space name.txt",
      "u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.txt",
      "? new.txt",
      "",
    ].join("\0");
    assert.deepStrictEqual(parseGitStatusV2(stdout), {
      staged: [
        { path: "renamed2.txt", oldPath: "renamed.txt", status: "renamed" },
        { path: "space name.txt", status: "added" },
      ],
      unstaged: [
        { path: "c.txt", status: "modified" },
        { path: "space name.txt", status: "modified" },
        { path: "conflict.txt", status: "conflicted" },
        { path: "new.txt", status: "untracked" },
      ],
    });
  });

  it("reads the remote branches a prune would delete", () => {
    const stderr = [
      "From https://github.com/DevAccel-Labs/mystatusflow-v5",
      " - [deleted]             (none)     -> origin/Fix/I00555-I00565-I00545",
      " - [deleted]             (none)     -> origin/fix/I00555-I00565-I00545",
      "   a1b2c3d..e4f5a6b  main       -> origin/main",
    ].join("\n");
    assert.deepStrictEqual(parseFetchPrunedRefs(stderr), [
      "origin/Fix/I00555-I00565-I00545",
      "origin/fix/I00555-I00565-I00545",
    ]);
  });

  it("lists worktrees, skipping bare and missing ones", () => {
    const stdout = [
      "worktree /repo",
      "HEAD 5d97",
      "branch refs/heads/main",
      "",
      "worktree /repo-wt",
      "HEAD 5d98",
      "detached",
      "",
      "worktree /gone",
      "HEAD 5d99",
      "branch refs/heads/old",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    assert.deepStrictEqual(parseGitWorktreeList(stdout), [
      { path: "/repo", head: "5d97", branch: "main" },
      { path: "/repo-wt", head: "5d98", branch: null },
    ]);
  });
});

const layerFor = (cwd: string) =>
  gitGraphLayer.pipe(
    Layer.provide(
      Layer.mock(KnownWorkspaces.KnownWorkspaces)({ contains: () => Effect.succeed(false) }),
    ),
    Layer.provideMerge(Layer.mergeAll(GitVcsDriver.layerVcs, GitVcsDriver.layer)),
    Layer.provideMerge(ServerConfig.layerTest(cwd, { prefix: "t3-git-graph-config-" })),
    Layer.provideMerge(VcsProcess.layer),
    Layer.provideMerge(NodeServices.layer),
  );

/** A repository with one commit, inside a scoped temp folder that is also the workspace root. */
const withRepo = <A, E>(
  body: (input: {
    readonly root: string;
    readonly repo: string;
    readonly git: (
      args: ReadonlyArray<string>,
      cwd?: string,
    ) => Effect.Effect<string, GitCommandError>;
  }) => Effect.Effect<A, E, GitGraphService | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "t3-git-graph-" }));
    const repo = path.join(root, "repo");
    yield* fs.makeDirectory(repo);
    return yield* Effect.gen(function* () {
      const driver = yield* GitVcsDriver.GitVcsDriver;
      const git = (args: ReadonlyArray<string>, cwd = repo) =>
        driver
          .execute({ operation: "GitGraphService.test", cwd, args, timeoutMs: 20_000 })
          .pipe(Effect.map((result) => result.stdout));
      yield* git(["init", "-q", "-b", "main"]);
      yield* git(["config", "user.email", "tester@example.com"]);
      yield* git(["config", "user.name", "Tester"]);
      yield* git(["config", "commit.gpgsign", "false"]);
      yield* fs.writeFileString(path.join(repo, "a.txt"), "one\n");
      yield* git(["add", "a.txt"]);
      yield* git(["commit", "-q", "-m", "root"]);
      return yield* body({ root, repo, git });
    }).pipe(Effect.provide(layerFor(root)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("GitGraphService", () => {
  it.live("stages, unstages, discards and commits, touching only files git reports", () =>
    withRepo(({ repo }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        yield* fs.writeFileString(path.join(repo, "a.txt"), "two\n");
        yield* fs.writeFileString(path.join(repo, "new file.txt"), "new\n");

        const before = (yield* graph.worktrees({ cwd: repo })).worktrees;
        assert.strictEqual(before.length, 1);
        assert.strictEqual(before[0]!.branch, "main");
        assert.isTrue(before[0]!.current);
        assert.deepStrictEqual(before[0]!.unstaged, [
          { path: "a.txt", status: "modified" },
          { path: "new file.txt", status: "untracked" },
        ]);

        yield* graph.action({ cwd: repo, action: { _tag: "Stage", paths: ["a.txt"] } });
        const one = (yield* graph.worktrees({ cwd: repo })).worktrees[0]!;
        assert.deepStrictEqual(
          [one.staged.map((file) => file.path), one.unstaged.map((file) => file.path)],
          [["a.txt"], ["new file.txt"]],
        );

        yield* graph.action({
          cwd: repo,
          action: { _tag: "Stage", paths: ["a.txt", "new file.txt", "../outside.txt"] },
        });
        const staged = (yield* graph.worktrees({ cwd: repo })).worktrees[0]!;
        assert.deepStrictEqual(staged.staged, [
          { path: "a.txt", status: "modified" },
          { path: "new file.txt", status: "added" },
        ]);
        assert.deepStrictEqual(staged.unstaged, []);

        yield* graph.action({ cwd: repo, action: { _tag: "Unstage", paths: ["new file.txt"] } });
        yield* graph.action({ cwd: repo, action: { _tag: "Discard", paths: ["new file.txt"] } });
        assert.isFalse(yield* fs.exists(path.join(repo, "new file.txt")));

        yield* graph.action({ cwd: repo, action: { _tag: "Commit", message: "change a" } });
        const after = (yield* graph.worktrees({ cwd: repo })).worktrees[0]!;
        assert.deepStrictEqual([after.staged, after.unstaged], [[], []]);
        const log = yield* graph.log({ cwd: repo, maxCount: 10, showRemoteBranches: true });
        assert.deepStrictEqual(
          log.commits.map((commit) => commit.subject),
          ["change a", "root"],
        );
      }),
    ),
  );

  it.live("reports a failing commit hook in git's own words", () =>
    withRepo(({ repo }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        const hook = path.join(repo, ".git", "hooks", "pre-commit");
        yield* fs.writeFileString(hook, "#!/bin/sh\necho 'lint failed: a.txt'\nexit 1\n");
        yield* fs.chmod(hook, 0o755);
        yield* fs.writeFileString(path.join(repo, "a.txt"), "two\n");
        yield* graph.action({ cwd: repo, action: { _tag: "Stage", paths: ["a.txt"] } });

        const exit = yield* graph
          .action({ cwd: repo, action: { _tag: "Commit", message: "blocked" } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        assert.include(JSON.stringify(exit), "lint failed: a.txt");
      }),
    ),
  );

  it.live("creates, checks out and refuses invalid branches", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const graph = yield* GitGraphService;
        const current = () =>
          graph.worktrees({ cwd: repo }).pipe(Effect.map((result) => result.worktrees[0]!.branch));

        yield* graph.action({
          cwd: repo,
          action: { _tag: "CreateBranch", name: "feature/x", startPoint: "main", checkout: true },
        });
        assert.strictEqual(yield* current(), "feature/x");

        yield* graph.action({ cwd: repo, action: { _tag: "Checkout", ref: "refs/heads/main" } });
        assert.strictEqual(yield* current(), "main");

        const head = (yield* git(["rev-parse", "HEAD"])).trim();
        yield* graph.action({ cwd: repo, action: { _tag: "Checkout", ref: head } });
        assert.strictEqual(yield* current(), null);

        for (const bad of [
          { _tag: "CreateBranch", name: "bad..name", startPoint: "main", checkout: false },
          { _tag: "CreateBranch", name: "-x", startPoint: "main", checkout: false },
          { _tag: "CreateBranch", name: "ok", startPoint: "--orphan", checkout: false },
          { _tag: "Checkout", ref: "refs/heads/missing" },
        ] as const) {
          const exit = yield* graph.action({ cwd: repo, action: bad }).pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(exit), JSON.stringify(bad));
        }
      }),
    ),
  );

  it.live("stashes, pops, and rejects anything that is not a stash selector", () =>
    withRepo(({ repo }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        yield* fs.writeFileString(path.join(repo, "a.txt"), "two\n");
        yield* fs.writeFileString(path.join(repo, "extra.txt"), "x\n");

        yield* graph.action({
          cwd: repo,
          action: { _tag: "Stash", message: "wip", includeUntracked: true },
        });
        const stashed = yield* graph.log({ cwd: repo, maxCount: 10, showRemoteBranches: true });
        assert.deepStrictEqual(
          stashed.stashes.map((stash) => stash.selector),
          ["stash@{0}"],
        );
        assert.strictEqual(stashed.uncommittedFileCount, 0);

        const bad = yield* graph
          .action({ cwd: repo, action: { _tag: "StashDrop", selector: "HEAD" } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(bad));

        yield* graph.action({ cwd: repo, action: { _tag: "StashPop", selector: "stash@{0}" } });
        const popped = yield* graph.log({ cwd: repo, maxCount: 10, showRemoteBranches: true });
        assert.deepStrictEqual([popped.stashes.length, popped.uncommittedFileCount], [0, 2]);
      }),
    ),
  );

  it.live("acts in a sibling worktree but not in an unrelated folder", () =>
    withRepo(({ root, repo, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        const worktree = path.join(root, "repo-feature");
        yield* git(["worktree", "add", "-q", "-b", "wt-branch", worktree]);
        yield* fs.writeFileString(path.join(worktree, "wt.txt"), "wt\n");

        const listed = (yield* graph.worktrees({ cwd: repo })).worktrees;
        assert.deepStrictEqual(
          listed.map((entry) => [entry.branch, entry.current, entry.unstaged.length]),
          [
            ["main", true, 0],
            ["wt-branch", false, 1],
          ],
        );

        yield* graph.action({
          cwd: repo,
          worktreePath: worktree,
          action: { _tag: "Stage", paths: ["wt.txt"] },
        });
        const staged = (yield* graph.worktrees({ cwd: repo })).worktrees[1]!;
        assert.deepStrictEqual(staged.staged, [{ path: "wt.txt", status: "added" }]);

        const unrelated = path.join(root, "elsewhere");
        yield* fs.makeDirectory(unrelated);
        const exit = yield* graph
          .action({ cwd: repo, worktreePath: unrelated, action: { _tag: "Fetch" } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }),
    ),
  );
});
