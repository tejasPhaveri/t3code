import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type { GitCommandError, GitGraphAction } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import {
  countPorcelainEntries,
  GitGraphService,
  layer as gitGraphLayer,
  mergeGitGraphDiffFiles,
  parseFetchPrunedRefs,
  parseGitGraphCommitBody,
  parseGitGraphLog,
  parseGitGraphNameStatus,
  parseGitGraphNumstat,
  parseGitGraphRefs,
  parseGitGraphSignature,
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

  it("splits a commit's message into subject and body", () => {
    assert.deepStrictEqual(
      parseGitGraphCommitBody("subject line\n\nbody one\nbody two\n\nRefs: #12\n"),
      { subject: "subject line", body: "body one\nbody two\n\nRefs: #12" },
    );
    assert.deepStrictEqual(parseGitGraphCommitBody("only a subject\n"), {
      subject: "only a subject",
      body: "",
    });
    // A message with no blank line after the subject still has a body.
    assert.deepStrictEqual(parseGitGraphCommitBody("subject\nbody\n"), {
      subject: "subject",
      body: "body",
    });
  });

  it("keeps a signed commit's signature and drops the `N` git reports for an unsigned one", () => {
    assert.deepStrictEqual(parseGitGraphSignature("G", "Tester", "ABCD"), {
      code: "G",
      signer: "Tester",
      key: "ABCD",
    });
    assert.isNull(parseGitGraphSignature("N", "", ""));
    assert.isNull(parseGitGraphSignature("", "", ""));
  });

  it("reads a numstat rename as its own path pair, not an extra file", () => {
    const stdout = [
      "1\t1\ta.txt",
      "-\t-\tbin.dat",
      "0\t0\t", // a rename has an empty path, then its source and destination as fields
      "d/b.txt",
      "d/c.txt",
      "",
    ].join("\0");
    assert.deepStrictEqual(parseGitGraphNumstat(stdout), [
      { path: "a.txt", oldPath: null, additions: 1, deletions: 1, binary: false },
      { path: "bin.dat", oldPath: null, additions: 0, deletions: 0, binary: true },
      { path: "d/c.txt", oldPath: "d/b.txt", additions: 0, deletions: 0, binary: false },
    ]);
  });

  it("pairs name-status kinds by path so a rename keeps its status and counts", () => {
    const numstat = ["1\t1\ta.txt", "-\t-\tbin.dat", "0\t0\t", "d/b.txt", "d/c.txt", ""].join("\0");
    const nameStatus = ["M", "a.txt", "A", "bin.dat", "R100", "d/b.txt", "d/c.txt", ""].join("\0");
    assert.deepStrictEqual(
      mergeGitGraphDiffFiles(
        parseGitGraphNumstat(numstat),
        parseGitGraphNameStatus(nameStatus),
      ).map((file) => [file.path, file.oldPath, file.status, file.additions, file.binary]),
      [
        ["a.txt", null, "modified", 1, false],
        ["bin.dat", null, "added", 0, true],
        ["d/c.txt", "d/b.txt", "renamed", 0, false],
      ],
    );
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

  it.live("merges a branch into the current branch with a merge commit", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        yield* git(["switch", "-q", "-c", "feature"]);
        yield* fs.writeFileString(path.join(repo, "b.txt"), "b\n");
        yield* git(["add", "b.txt"]);
        yield* git(["commit", "-q", "-m", "add b"]);
        yield* git(["switch", "-q", "main"]);

        yield* graph.action({ cwd: repo, action: { _tag: "Merge", ref: "refs/heads/feature" } });
        const log = yield* graph.log({ cwd: repo, maxCount: 10, showRemoteBranches: true });
        assert.strictEqual(log.head?.branch, "main");
        assert.strictEqual(log.commits[0]!.subject, "Merge branch 'feature'");
        assert.strictEqual(log.commits[0]!.parents.length, 2);

        const bad = yield* graph
          .action({ cwd: repo, action: { _tag: "Merge", ref: "--abort" } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(bad));
      }),
    ),
  );

  it.live("stops a conflicting merge, then aborts it or commits the resolution", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        const file = path.join(repo, "a.txt");
        yield* git(["switch", "-q", "-c", "feature"]);
        yield* fs.writeFileString(file, "feature\n");
        yield* git(["commit", "-q", "-am", "feature edit"]);
        yield* git(["switch", "-q", "main"]);
        yield* fs.writeFileString(file, "main\n");
        yield* git(["commit", "-q", "-am", "main edit"]);
        const merge = () =>
          graph
            .action({ cwd: repo, action: { _tag: "Merge", ref: "refs/heads/feature" } })
            .pipe(Effect.exit);
        const current = () =>
          graph.worktrees({ cwd: repo }).pipe(Effect.map((result) => result.worktrees[0]!));

        const conflicted = yield* merge();
        assert.isTrue(Exit.isFailure(conflicted));
        assert.include(JSON.stringify(conflicted), "CONFLICT");
        const stopped = yield* current();
        assert.isTrue(stopped.merging);
        assert.deepStrictEqual(stopped.unstaged, [{ path: "a.txt", status: "conflicted" }]);

        yield* graph.action({ cwd: repo, action: { _tag: "MergeAbort" } });
        assert.isFalse((yield* current()).merging);
        assert.strictEqual(yield* fs.readFileString(file), "main\n");

        yield* merge();
        yield* fs.writeFileString(file, "both\n");
        yield* graph.action({ cwd: repo, action: { _tag: "Stage", paths: ["a.txt"] } });
        yield* graph.action({ cwd: repo, action: { _tag: "Commit" } });
        assert.isFalse((yield* current()).merging);
        const log = yield* graph.log({ cwd: repo, maxCount: 10, showRemoteBranches: true });
        assert.strictEqual(log.commits[0]!.subject, "Merge branch 'feature'");
        assert.strictEqual(log.commits[0]!.parents.length, 2);
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

  it.live("reads a commit's message, author and changed files", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        yield* fs.writeFileString(path.join(repo, "a.txt"), "two\n");
        yield* fs.writeFileString(path.join(repo, "new.txt"), "new\n");
        yield* git(["add", "-A"]);
        yield* git(["commit", "-q", "-m", "change a\n\nWhy it changed.\n\nRefs: #7"]);

        const head = (yield* git(["rev-parse", "HEAD"])).trim();
        const details = yield* graph.commit({ cwd: repo, hash: head });
        assert.deepStrictEqual(
          [details.subject, details.body, details.author, details.parents.length],
          ["change a", "Why it changed.\n\nRefs: #7", "Tester", 1],
        );
        assert.deepStrictEqual(
          details.files.map((file) => [file.path, file.status, file.additions, file.deletions]),
          [
            ["a.txt", "modified", 1, 1],
            ["new.txt", "added", 1, 0],
          ],
        );
        // An unsigned repository reports no signature rather than a blank one.
        assert.isNull(details.signature);

        // The root commit is compared with the empty tree, so everything is an addition.
        const root = yield* graph.commit({ cwd: repo, hash: "HEAD~1" });
        assert.deepStrictEqual(
          root.files.map((file) => [file.path, file.status, file.additions]),
          [["a.txt", "added", 1]],
        );
      }),
    ),
  );

  it.live("compares a commit, two refs, and the working tree including untracked files", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        const root = (yield* git(["rev-parse", "HEAD"])).trim();
        yield* fs.writeFileString(path.join(repo, "a.txt"), "two\n");
        yield* git(["commit", "-q", "-am", "second"]);

        const commitDiff = yield* graph.diff({
          cwd: repo,
          target: { _tag: "commit", hash: "HEAD" },
        });
        assert.deepStrictEqual(
          commitDiff.files.map((file) => [file.path, file.additions, file.deletions]),
          [["a.txt", 1, 1]],
        );
        assert.include(commitDiff.patch, "--- a/a.txt");
        assert.include(commitDiff.patch, "+two");

        const rangeDiff = yield* graph.diff({
          cwd: repo,
          target: { _tag: "range", baseRef: root, headRef: "HEAD" },
        });
        assert.deepStrictEqual(
          rangeDiff.files.map((file) => file.path),
          ["a.txt"],
        );

        // Untracked files are part of what is uncommitted, so they must show up here.
        yield* fs.writeFileString(path.join(repo, "untracked.txt"), "u1\nu2\n");
        const worktreeDiff = yield* graph.diff({
          cwd: repo,
          target: { _tag: "worktree", baseRef: "HEAD" },
        });
        assert.deepStrictEqual(
          worktreeDiff.files.map((file) => [file.path, file.status, file.additions]),
          [["untracked.txt", "added", 2]],
        );
        assert.include(worktreeDiff.patch, "+u2");
        // Reading the comparison must not have changed the checkout's own index.
        const status = (yield* git(["status", "--porcelain"])).trim();
        assert.strictEqual(status, "?? untracked.txt");
      }),
    ),
  );

  it.live("reads annotated and lightweight tags", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const graph = yield* GitGraphService;
        const head = (yield* git(["rev-parse", "HEAD"])).trim();
        yield* git(["tag", "light", head]);
        yield* git(["tag", "-a", "v1", "-m", "release one", head]);

        const annotated = yield* graph.tag({ cwd: repo, name: "v1" });
        assert.deepStrictEqual(
          [annotated.annotated, annotated.hash, annotated.tagger, annotated.message],
          [true, head, "Tester", "release one"],
        );

        const lightweight = yield* graph.tag({ cwd: repo, name: "light" });
        assert.deepStrictEqual(
          [lightweight.annotated, lightweight.hash, lightweight.tagger, lightweight.message],
          [false, head, null, ""],
        );

        const missing = yield* graph.tag({ cwd: repo, name: "nope" }).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(missing));
      }),
    ),
  );

  it.live("deletes, renames, resets, cherry-picks, reverts and drops commits", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        // Scoped to the checked-out branch, so a commit left behind on another ref stays out.
        const subjects = () =>
          graph.worktrees({ cwd: repo }).pipe(
            Effect.flatMap((result) =>
              graph.log({
                cwd: repo,
                maxCount: 10,
                showRemoteBranches: false,
                refs: [`refs/heads/${result.worktrees[0]!.branch ?? "HEAD"}`],
              }),
            ),
            Effect.map((result) => result.commits.map((commit) => commit.subject)),
          );
        const act = (action: GitGraphAction) => graph.action({ cwd: repo, action });
        const currentBranch = () =>
          graph.worktrees({ cwd: repo }).pipe(Effect.map((result) => result.worktrees[0]!.branch));

        yield* act({ _tag: "CreateBranch", name: "keep", startPoint: "HEAD", checkout: false });
        yield* act({ _tag: "RenameBranch", name: "keep", newName: "keepers" });
        yield* fs.writeFileString(path.join(repo, "b.txt"), "b\n");
        yield* git(["add", "b.txt"]);
        yield* git(["commit", "-q", "-m", "add b"]);
        yield* act({ _tag: "Checkout", ref: "refs/heads/keepers" });
        yield* act({ _tag: "DeleteBranch", name: "main", force: true });
        assert.strictEqual(yield* currentBranch(), "keepers");
        // `keep` was cut at the root commit, so `add b` (made on `main`) is not on this branch.
        assert.deepStrictEqual(yield* subjects(), ["root"]);

        // A commit is dropped by replaying everything after it onto its parent.
        yield* fs.writeFileString(path.join(repo, "c.txt"), "c\n");
        yield* git(["add", "c.txt"]);
        yield* git(["commit", "-q", "-m", "add c"]);
        yield* fs.writeFileString(path.join(repo, "d.txt"), "d\n");
        yield* git(["add", "d.txt"]);
        yield* git(["commit", "-q", "-m", "add d"]);
        const middle = (yield* git(["rev-parse", "HEAD~1"])).trim();
        yield* act({ _tag: "DropCommit", hash: middle });
        assert.deepStrictEqual(yield* subjects(), ["add d", "root"]);
        assert.isFalse(yield* fs.exists(path.join(repo, "c.txt")));

        // Reverting a commit puts its change back the other way.
        yield* act({ _tag: "Revert", hash: "HEAD" });
        assert.deepStrictEqual(yield* subjects(), ['Revert "add d"', "add d", "root"]);

        // Cherry-picking replays a commit onto the checked-out branch.
        const addD = (yield* git(["rev-parse", "HEAD~1"])).trim();
        yield* act({ _tag: "Checkout", ref: "HEAD~2" });
        yield* act({ _tag: "CreateBranch", name: "pick", startPoint: "HEAD", checkout: true });
        yield* act({ _tag: "CherryPick", hash: addD });
        assert.deepStrictEqual(yield* subjects(), ["add d", "root"]);
        assert.isTrue(yield* fs.exists(path.join(repo, "d.txt")));

        yield* act({ _tag: "Reset", ref: "HEAD~1", mode: "hard" });
        assert.deepStrictEqual(yield* subjects(), ["root"]);
        assert.isFalse(yield* fs.exists(path.join(repo, "d.txt")));
      }),
    ),
  );

  it.live("refuses to drop a commit that is not on the checked-out branch", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const graph = yield* GitGraphService;
        yield* git(["switch", "-q", "-c", "other"]);
        yield* git(["commit", "-q", "--allow-empty", "-m", "elsewhere"]);
        const elsewhere = (yield* git(["rev-parse", "HEAD"])).trim();
        yield* git(["switch", "-q", "main"]);

        const dropped = yield* graph
          .action({ cwd: repo, action: { _tag: "DropCommit", hash: elsewhere } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(dropped));
        // The other branch still has its commit.
        assert.strictEqual((yield* git(["rev-parse", "other"])).trim(), elsewhere);
      }),
    ),
  );

  it.live("creates, pushes and deletes a tag, rejecting an invalid name", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const graph = yield* GitGraphService;
        const head = (yield* git(["rev-parse", "HEAD"])).trim();
        yield* graph.action({
          cwd: repo,
          action: { _tag: "CreateTag", name: "v1", hash: head, push: false },
        });
        assert.strictEqual((yield* git(["tag", "--list", "v1"])).trim(), "v1");

        const invalid = yield* graph
          .action({
            cwd: repo,
            action: { _tag: "CreateTag", name: "bad..name", hash: head, push: false },
          })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(invalid));

        yield* graph.action({ cwd: repo, action: { _tag: "DeleteTag", name: "v1" } });
        assert.strictEqual((yield* git(["tag", "--list"])).trim(), "");
      }),
    ),
  );

  it.live("lists, adds, edits and removes remotes", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const graph = yield* GitGraphService;
        yield* git(["remote", "add", "origin", "https://example.com/origin.git"]);

        const listed = (yield* graph.remotes({ cwd: repo })).remotes;
        assert.deepStrictEqual(listed, [
          {
            name: "origin",
            fetchUrl: "https://example.com/origin.git",
            pushUrl: "https://example.com/origin.git",
          },
        ]);

        yield* graph.action({
          cwd: repo,
          action: { _tag: "AddRemote", name: "up", url: "https://example.com/up.git" },
        });
        yield* graph.action({
          cwd: repo,
          action: { _tag: "EditRemote", name: "up", url: "https://example.com/other.git" },
        });
        assert.deepStrictEqual(
          (yield* graph.remotes({ cwd: repo })).remotes.map((remote) => [
            remote.name,
            remote.fetchUrl,
          ]),
          [
            ["origin", "https://example.com/origin.git"],
            ["up", "https://example.com/other.git"],
          ],
        );

        const bad = yield* graph
          .action({
            cwd: repo,
            action: { _tag: "AddRemote", name: "bad name", url: "https://x/y.git" },
          })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(bad));

        yield* graph.action({ cwd: repo, action: { _tag: "RemoveRemote", name: "up" } });
        assert.deepStrictEqual(
          (yield* graph.remotes({ cwd: repo })).remotes.map((remote) => remote.name),
          ["origin"],
        );
      }),
    ),
  );

  it.live("reads a merge commit's changes against its first parent", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        const root = (yield* git(["rev-parse", "HEAD"])).trim();
        yield* git(["switch", "-q", "-c", "side"]);
        yield* fs.writeFileString(path.join(repo, "side.txt"), "s\n");
        yield* git(["add", "side.txt"]);
        yield* git(["commit", "-q", "-m", "side change"]);
        yield* git(["switch", "-q", "main"]);
        yield* git(["merge", "-q", "--no-ff", "-m", "merge side", "side"]);

        // `diff-tree` prints nothing for a merge unless told which parent to compare with.
        const merge = yield* graph.commit({ cwd: repo, hash: "HEAD" });
        assert.deepStrictEqual(
          merge.files.map((file) => [file.path, file.status, file.additions]),
          [["side.txt", "added", 1]],
        );
        assert.strictEqual(merge.parents.length, 2);
        assert.notStrictEqual(merge.parents[1], root);
      }),
    ),
  );

  it.live("an explicit ref selection does not pull in the checked-out branch", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const graph = yield* GitGraphService;
        yield* git(["switch", "-q", "-c", "unrelated"]);
        yield* fs.writeFileString(path.join(repo, "u.txt"), "u\n");
        yield* git(["add", "u.txt"]);
        yield* git(["commit", "-q", "-m", "unrelated work"]);
        yield* git(["switch", "-q", "main"]);

        const filtered = yield* graph.log({
          cwd: repo,
          maxCount: 20,
          showRemoteBranches: false,
          refs: ["refs/heads/main"],
        });
        assert.deepStrictEqual(
          filtered.commits.map((commit) => commit.subject),
          ["root"],
        );
        // With no selection the whole graph is shown, as before.
        const all = yield* graph.log({ cwd: repo, maxCount: 20, showRemoteBranches: false });
        assert.include(
          all.commits.map((commit) => commit.subject),
          "unrelated work",
        );
      }),
    ),
  );

  it.live("honours the log order and the first-parent option", () =>
    withRepo(({ repo, git }) =>
      Effect.gen(function* () {
        const graph = yield* GitGraphService;
        yield* git(["switch", "-q", "-c", "side"]);
        yield* git(["commit", "-q", "--allow-empty", "-m", "side work"]);
        yield* git(["switch", "-q", "main"]);
        yield* git(["commit", "-q", "--allow-empty", "-m", "main work"]);
        yield* git(["merge", "-q", "--no-ff", "-m", "merge side", "side"]);

        const full = yield* graph.log({ cwd: repo, maxCount: 20, showRemoteBranches: false });
        assert.include(
          full.commits.map((commit) => commit.subject),
          "side work",
        );

        const firstParent = yield* graph.log({
          cwd: repo,
          maxCount: 20,
          showRemoteBranches: false,
          firstParent: true,
        });
        // `--first-parent` applies to each start point, so the side branch's own tip still
        // brings its commits in; only the traversal from `main` is limited to first parents.
        assert.deepStrictEqual(
          firstParent.commits.map((commit) => commit.subject),
          ["merge side", "main work", "side work", "root"],
        );

        const firstParentOfHead = yield* graph.log({
          cwd: repo,
          maxCount: 20,
          showRemoteBranches: false,
          firstParent: true,
          refs: ["refs/heads/main"],
        });
        assert.deepStrictEqual(
          firstParentOfHead.commits.map((commit) => commit.subject),
          ["merge side", "main work", "root"],
        );

        const topological = yield* graph.log({
          cwd: repo,
          maxCount: 20,
          showRemoteBranches: false,
          order: "topo",
        });
        // Topological order never puts a parent before its child.
        const seen = new Set<string>();
        for (const commit of topological.commits) {
          for (const parent of commit.parents) {
            assert.isFalse(seen.has(parent), `${parent} came before its child`);
          }
          seen.add(commit.hash);
        }
      }),
    ),
  );
});
