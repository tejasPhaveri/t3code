import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  GitCommandError,
  VcsRepositoryDetectionError,
  type GitGraphActionInput,
  type GitGraphActionResult,
  type GitGraphCommit,
  type GitGraphError,
  type GitGraphLogInput,
  type GitGraphLogResult,
  type GitGraphRef,
  type GitGraphStash,
  type GitGraphWorktree,
  type GitGraphWorktreeFile,
  type GitGraphWorktreesInput,
  type GitGraphWorktreesResult,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";

export class GitGraphService extends Context.Service<
  GitGraphService,
  {
    readonly log: (input: GitGraphLogInput) => Effect.Effect<GitGraphLogResult, GitGraphError>;
    readonly worktrees: (
      input: GitGraphWorktreesInput,
    ) => Effect.Effect<GitGraphWorktreesResult, GitGraphError>;
    readonly action: (
      input: GitGraphActionInput,
    ) => Effect.Effect<GitGraphActionResult, GitGraphError>;
  }
>()("t3/git/GitGraphService") {}

const FIELD = "\x1f";
const RECORD = "\x1e";
const LOG_FORMAT = `${["%H", "%P", "%an", "%ae", "%at", "%s"].join("%x1f")}%x1e`;
const LOG_MAX_OUTPUT_BYTES = 16_000_000;
const STATUS_MAX_OUTPUT_BYTES = 16_000_000;
const NETWORK_TIMEOUT_MS = 120_000;
// Commit hooks (lint, tests) can take a while; they still must not hang a request forever.
const COMMIT_TIMEOUT_MS = 300_000;
const STASH_SELECTOR = /^stash@\{\d+\}$/;
const CLEAN_BATCH_SIZE = 200;
// Paths come from the client; magic pathspecs (`:(top)`, globs) must not widen them. Only for
// commands given those paths: `git stash -u` relies on magic internally and, with this set,
// silently leaves untracked files behind.
const LITERAL_PATHSPECS = { GIT_LITERAL_PATHSPECS: "1" };
// Fetch and commit must fail rather than wait on a credential or editor prompt nobody sees.
const NON_INTERACTIVE = {
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  SSH_ASKPASS: "",
  SSH_ASKPASS_REQUIRE: "never",
};

const toSeconds = (value: string | undefined) => {
  const seconds = Number.parseInt(value ?? "", 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
};

const splitParents = (value: string | undefined) =>
  (value ?? "").split(" ").filter((parent) => parent.length > 0);

export function parseGitGraphLog(stdout: string): GitGraphCommit[] {
  return stdout.split(RECORD).flatMap((record) => {
    const fields = record.replace(/^\n/, "").split(FIELD);
    const [hash, parents, author, authorEmail, time, ...subject] = fields;
    if (!hash || fields.length < 6) return [];
    return [
      {
        hash,
        parents: splitParents(parents),
        author: author ?? "",
        authorEmail: authorEmail ?? "",
        authorTime: toSeconds(time),
        subject: subject.join(FIELD),
      },
    ];
  });
}

export function parseGitGraphRefs(stdout: string): GitGraphRef[] {
  return stdout.split("\n").flatMap((line): GitGraphRef[] => {
    const [objectName, peeled, fullName] = line.split(FIELD);
    if (!objectName || !fullName) return [];
    const hash = peeled || objectName;
    if (fullName.startsWith("refs/heads/")) {
      return [{ kind: "head", fullName, name: fullName.slice(11), hash }];
    }
    if (fullName.startsWith("refs/remotes/")) {
      // `origin/HEAD` only points at another remote branch.
      if (fullName.endsWith("/HEAD")) return [];
      return [{ kind: "remote", fullName, name: fullName.slice(13), hash }];
    }
    if (fullName.startsWith("refs/tags/")) {
      return [{ kind: "tag", fullName, name: fullName.slice(10), hash }];
    }
    return [];
  });
}

export function parseGitGraphStashes(stdout: string): GitGraphStash[] {
  return stdout.split("\n").flatMap((line) => {
    const [hash, parents, selector, time, ...subject] = line.split(FIELD);
    const baseHash = splitParents(parents)[0];
    if (!hash || !baseHash || !selector) return [];
    return [
      { hash, baseHash, selector, authorTime: toSeconds(time), subject: subject.join(FIELD) },
    ];
  });
}

/** Entries in `git status --porcelain=v1 -z`; a rename or copy carries its source as an extra field. */
export function countPorcelainEntries(stdout: string): number {
  const fields = stdout.split("\0");
  let count = 0;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field.length < 4) continue;
    count += 1;
    if (/[RC]/.test(field.slice(0, 2))) index += 1;
  }
  return count;
}

/** Remote branches `git fetch --prune --dry-run` would delete: ` - [deleted] (none) -> origin/x`. */
export function parseFetchPrunedRefs(stderr: string): string[] {
  return stderr.split("\n").flatMap((line) => {
    const match = /^\s*-\s+\[deleted\]\s+.*->\s+(\S+)\s*$/.exec(line);
    const name = match?.[1];
    return name && !name.startsWith("-") ? [name] : [];
  });
}

interface ParsedWorktree {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
}

/** `git worktree list --porcelain`, without bare repositories and worktrees whose folder is gone. */
export function parseGitWorktreeList(stdout: string): ParsedWorktree[] {
  return stdout.split("\n\n").flatMap((block) => {
    const lines = block.split("\n").filter((line) => line.length > 0);
    const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((line) => line === "bare" || line.startsWith("prunable"))) return [];
    const head = lines.find((line) => line.startsWith("HEAD "))?.slice(5) ?? null;
    const branchRef = lines.find((line) => line.startsWith("branch "))?.slice(7) ?? null;
    return [
      {
        path,
        head: head && /^0+$/.test(head) ? null : head,
        branch: branchRef?.startsWith("refs/heads/") ? branchRef.slice(11) : null,
      },
    ];
  });
}

const STATUS_BY_LETTER: Record<string, GitGraphWorktreeFile["status"]> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
};

/** Text after the first `count` space-separated fields; paths may themselves contain spaces. */
const afterFields = (line: string, count: number) => {
  let index = 0;
  for (let field = 0; field < count; field += 1) {
    index = line.indexOf(" ", index) + 1;
    if (index === 0) return "";
  }
  return line.slice(index);
};

/** `git status --porcelain=v2 -z`: index changes are staged, worktree changes and untracked are not. */
export function parseGitStatusV2(stdout: string): {
  staged: GitGraphWorktreeFile[];
  unstaged: GitGraphWorktreeFile[];
} {
  const staged: GitGraphWorktreeFile[] = [];
  const unstaged: GitGraphWorktreeFile[] = [];
  const entries = stdout.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const kind = entry.charAt(0);
    if (kind === "?") {
      unstaged.push({ path: entry.slice(2), status: "untracked" });
    } else if (kind === "u") {
      unstaged.push({ path: afterFields(entry, 10), status: "conflicted" });
    } else if (kind === "1" || kind === "2") {
      const [indexStatus = ".", worktreeStatus = "."] = entry.slice(2, 4);
      const path = afterFields(entry, kind === "1" ? 8 : 9);
      const oldPath = kind === "2" ? entries[(index += 1)] : undefined;
      const withOldPath = (letter: string) =>
        (letter === "R" || letter === "C") && oldPath !== undefined ? { oldPath } : {};
      const indexChange = STATUS_BY_LETTER[indexStatus];
      if (indexChange) staged.push({ path, ...withOldPath(indexStatus), status: indexChange });
      const worktreeChange = STATUS_BY_LETTER[worktreeStatus];
      if (worktreeChange) unstaged.push({ path, status: worktreeChange });
    }
  }
  return { staged, unstaged };
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;

  const realPath = (value: string) =>
    fileSystem.realPath(path.resolve(value)).pipe(Effect.orElseSucceed(() => path.resolve(value)));

  const assertWorkspaceBoundCwd = Effect.fn("GitGraphService.assertWorkspaceBoundCwd")(function* (
    cwd: string,
  ) {
    const [candidate, workspaceRoot] = yield* Effect.all([realPath(cwd), realPath(config.cwd)]);
    if (
      KnownWorkspaces.isWithinRoot(path, candidate, workspaceRoot) ||
      (yield* knownWorkspaces.contains(candidate))
    ) {
      return;
    }
    return yield* new VcsRepositoryDetectionError({
      operation: "GitGraphService.assertWorkspaceBoundCwd",
      cwd,
      detail: "Git graph cwd must stay within a known workspace.",
    });
  });

  const run = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: {
      readonly maxOutputBytes?: number;
      readonly allowNonZeroExit?: boolean;
      readonly stdin?: string;
      readonly timeoutMs?: number;
      readonly env?: NodeJS.ProcessEnv;
    },
  ) =>
    git.execute({
      operation: `GitGraphService.${operation}`,
      cwd,
      args,
      ...(options?.env === undefined ? {} : { env: options.env }),
      ...(options?.allowNonZeroExit ? { allowNonZeroExit: true } : {}),
      ...(options?.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
      ...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });

  const stdoutOf = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: { readonly maxOutputBytes?: number },
  ) =>
    run(operation, cwd, args, { ...options, allowNonZeroExit: true }).pipe(
      Effect.map((result) => (result.exitCode === 0 ? result.stdout : "")),
    );

  /** Runs a user action; a failure carries git's own words (a hook's output, a conflict). */
  const runAction = Effect.fn("GitGraphService.runAction")(function* (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: {
      readonly stdin?: string;
      readonly timeoutMs?: number;
      readonly clientPaths?: boolean;
    },
  ) {
    const result = yield* run(operation, cwd, args, {
      ...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      allowNonZeroExit: true,
      env: options?.clientPaths ? { ...NON_INTERACTIVE, ...LITERAL_PATHSPECS } : NON_INTERACTIVE,
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    if (result.exitCode !== 0) {
      return yield* new GitCommandError({
        operation: `GitGraphService.${operation}`,
        command: `git ${args[0] ?? ""}`,
        cwd,
        exitCode: result.exitCode,
        detail: output.slice(-4_000) || `git ${args[0] ?? ""} failed.`,
      });
    }
    return output;
  });

  const log: GitGraphService["Service"]["log"] = Effect.fn("GitGraphService.log")(
    function* (input) {
      yield* assertWorkspaceBoundCwd(input.cwd);
      const cwd = input.cwd;
      const [refsOut, headHash, headBranch, stashOut, statusOut, remotesOut] = yield* Effect.all(
        [
          stdoutOf("refs", cwd, [
            "for-each-ref",
            "--format=%(objectname)%1f%(*objectname)%1f%(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
          ]),
          stdoutOf("head", cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]),
          stdoutOf("headBranch", cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
          stdoutOf("stashes", cwd, [
            "stash",
            "list",
            `--format=${["%H", "%P", "%gd", "%at", "%s"].join("%x1f")}`,
          ]),
          stdoutOf("status", cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
          stdoutOf("remotes", cwd, ["remote"]),
        ],
        { concurrency: "unbounded" },
      );
      const refs = parseGitGraphRefs(refsOut);
      const head = headHash.trim();
      const knownRefs = new Set(refs.map((ref) => ref.fullName));
      const selectedRefs = (input.refs ?? []).filter((ref) => knownRefs.has(ref));
      const revisions =
        selectedRefs.length > 0
          ? selectedRefs
          : refs
              .filter((ref) => input.showRemoteBranches || ref.kind !== "remote")
              .map((ref) => ref.fullName);
      const startPoints = [...new Set([...revisions, ...(head ? ["HEAD"] : [])])];
      const commits =
        startPoints.length === 0
          ? []
          : parseGitGraphLog(
              (yield* run(
                "log",
                cwd,
                [
                  "log",
                  "--date-order",
                  `--max-count=${input.maxCount + 1}`,
                  `--format=${LOG_FORMAT}`,
                  "--end-of-options",
                  ...startPoints,
                ],
                { maxOutputBytes: LOG_MAX_OUTPUT_BYTES },
              )).stdout,
            );
      return {
        commits: commits.slice(0, input.maxCount),
        hasMore: commits.length > input.maxCount,
        refs,
        head: head ? { hash: head, branch: headBranch.trim() || null } : null,
        stashes: parseGitGraphStashes(stashOut),
        remotes: remotesOut.split("\n").filter((remote) => remote.length > 0),
        uncommittedFileCount: countPorcelainEntries(statusOut),
      };
    },
  );

  const statusOf = (cwd: string) =>
    stdoutOf("status", cwd, ["status", "--porcelain=v2", "-z", "--untracked-files=all"], {
      maxOutputBytes: STATUS_MAX_OUTPUT_BYTES,
    }).pipe(Effect.map(parseGitStatusV2));

  const isMerging = (cwd: string) =>
    stdoutOf("mergeHead", cwd, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).pipe(
      Effect.map((hash) => hash.trim().length > 0),
    );

  const listWorktrees = Effect.fn("GitGraphService.listWorktrees")(function* (cwd: string) {
    const [listed, topLevel] = yield* Effect.all(
      [
        stdoutOf("worktrees", cwd, ["worktree", "list", "--porcelain"]),
        stdoutOf("topLevel", cwd, ["rev-parse", "--show-toplevel"]),
      ],
      { concurrency: 2 },
    );
    const current = yield* realPath(topLevel.trim() || cwd);
    const worktrees = yield* Effect.forEach(
      parseGitWorktreeList(listed),
      (worktree) =>
        realPath(worktree.path).pipe(
          Effect.map((resolved) => ({ ...worktree, current: resolved === current })),
        ),
      { concurrency: 4 },
    );
    // A repository with no `git worktree` support still has its own checkout.
    return worktrees.length > 0
      ? worktrees
      : [{ path: current, head: null, branch: null, current: true }];
  });

  const worktrees: GitGraphService["Service"]["worktrees"] = Effect.fn("GitGraphService.worktrees")(
    function* (input) {
      yield* assertWorkspaceBoundCwd(input.cwd);
      const listed = yield* listWorktrees(input.cwd);
      const withStatus = yield* Effect.forEach(
        listed,
        (worktree): Effect.Effect<GitGraphWorktree, GitGraphError> =>
          Effect.all([statusOf(worktree.path), isMerging(worktree.path)], {
            concurrency: 2,
          }).pipe(Effect.map(([status, merging]) => ({ ...worktree, ...status, merging }))),
        { concurrency: 4 },
      );
      return {
        worktrees: withStatus.toSorted(
          (left, right) => Number(right.current) - Number(left.current),
        ),
      };
    },
  );

  /** Files git reports in this worktree's status, so an action never reaches an unrelated path. */
  const reportedFiles = Effect.fn("GitGraphService.reportedFiles")(function* (
    cwd: string,
    requested: readonly string[],
  ) {
    const status = yield* statusOf(cwd);
    const known = new Map([...status.staged, ...status.unstaged].map((file) => [file.path, file]));
    return requested.flatMap((requestedPath) => {
      const file = known.get(requestedPath);
      return file ? [file] : [];
    });
  });

  const pathspecStdin = (paths: readonly string[]) => `${paths.join("\0")}\0`;

  const assertBranchName = Effect.fn("GitGraphService.assertBranchName")(function* (
    cwd: string,
    name: string,
  ) {
    const valid =
      !name.startsWith("-") &&
      (yield* run("checkRefFormat", cwd, ["check-ref-format", "--branch", name], {
        allowNonZeroExit: true,
      })).exitCode === 0;
    if (valid) return;
    return yield* new GitCommandError({
      operation: "GitGraphService.assertBranchName",
      command: "git check-ref-format",
      cwd,
      detail: `"${name}" is not a valid branch name.`,
    });
  });

  /** A start point is an existing ref or a commit; never an option-looking string. */
  const resolveCommit = Effect.fn("GitGraphService.resolveCommit")(function* (
    cwd: string,
    value: string,
  ) {
    const resolved = value.startsWith("-")
      ? ""
      : (yield* stdoutOf("resolve", cwd, [
          "rev-parse",
          "--verify",
          "--quiet",
          "--end-of-options",
          `${value}^{commit}`,
        ])).trim();
    if (resolved) return resolved;
    return yield* new GitCommandError({
      operation: "GitGraphService.resolveCommit",
      command: "git rev-parse",
      cwd,
      detail: `"${value}" is not a commit or branch in this repository.`,
    });
  });

  /**
   * `git fetch --prune` deletes stale remote branches in one transaction. On a
   * case-insensitive file system two remote branches differing only in case
   * (`Fix/x`, `fix/x`) are one file, so the second deletion cannot lock it and
   * the whole prune is rolled back. Deleting them one at a time succeeds.
   */
  const fetchAll = Effect.fn("GitGraphService.fetchAll")(function* (cwd: string) {
    const options = { allowNonZeroExit: true, env: NON_INTERACTIVE, timeoutMs: NETWORK_TIMEOUT_MS };
    const pruned = yield* run("fetch", cwd, ["fetch", "--all", "--prune"], options);
    const output = `${pruned.stdout}${pruned.stderr}`.trim();
    if (pruned.exitCode === 0) return output;
    if (!/cannot lock ref/.test(pruned.stderr)) {
      return yield* new GitCommandError({
        operation: "GitGraphService.fetch",
        command: "git fetch",
        cwd,
        exitCode: pruned.exitCode,
        detail: output.slice(-4_000) || "git fetch failed.",
      });
    }
    const dryRun = yield* run(
      "fetch.pruneList",
      cwd,
      ["fetch", "--all", "--prune", "--dry-run"],
      options,
    );
    const stale = parseFetchPrunedRefs(dryRun.stderr);
    for (const remoteRef of stale) {
      yield* run("fetch.pruneRef", cwd, ["update-ref", "-d", `refs/remotes/${remoteRef}`], {
        allowNonZeroExit: true,
      });
    }
    // The rolled-back prune may have stopped the fetch itself; now nothing stands in its way.
    return yield* runAction("fetch", cwd, ["fetch", "--all", "--prune"], {
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
  });

  const findBranch = (cwd: string, fullName: string) =>
    stdoutOf("refs", cwd, [
      "for-each-ref",
      "--format=%(objectname)%1f%(*objectname)%1f%(refname)",
      "refs/heads",
      "refs/remotes",
    ]).pipe(Effect.map((out) => parseGitGraphRefs(out).find((ref) => ref.fullName === fullName)));

  const resolveActionCwd = Effect.fn("GitGraphService.resolveActionCwd")(function* (
    input: GitGraphActionInput,
  ) {
    yield* assertWorkspaceBoundCwd(input.cwd);
    if (input.worktreePath === undefined) return input.cwd;
    const requested = yield* realPath(input.worktreePath);
    const listed = yield* listWorktrees(input.cwd);
    const match = yield* Effect.forEach(listed, (worktree) =>
      realPath(worktree.path).pipe(
        Effect.map((resolved) => (resolved === requested ? worktree : null)),
      ),
    ).pipe(Effect.map((matches) => matches.find((worktree) => worktree !== null) ?? null));
    if (match) return match.path;
    return yield* new VcsRepositoryDetectionError({
      operation: "GitGraphService.action",
      cwd: input.worktreePath,
      detail: "That folder is not a worktree of this repository.",
    });
  });

  const action: GitGraphService["Service"]["action"] = Effect.fn("GitGraphService.action")(
    function* (input) {
      const cwd = yield* resolveActionCwd(input);
      const act = input.action;
      switch (act._tag) {
        case "Stage": {
          const files = yield* reportedFiles(cwd, act.paths);
          if (files.length === 0) return { output: "" };
          return {
            output: yield* runAction(
              "stage",
              cwd,
              ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
              { stdin: pathspecStdin(files.map((file) => file.path)), clientPaths: true },
            ),
          };
        }
        case "Unstage": {
          const files = yield* reportedFiles(cwd, act.paths);
          if (files.length === 0) return { output: "" };
          // A staged rename removes the old path too; unstaging has to restore both.
          const paths = files.flatMap((file) =>
            file.oldPath ? [file.path, file.oldPath] : [file.path],
          );
          const hasHead = (yield* stdoutOf("head", cwd, [
            "rev-parse",
            "--verify",
            "--quiet",
            "HEAD",
          ])).trim();
          return {
            output: yield* runAction(
              "unstage",
              cwd,
              hasHead
                ? ["restore", "--staged", "--pathspec-from-file=-", "--pathspec-file-nul"]
                : ["rm", "--cached", "-r", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"],
              { stdin: pathspecStdin(paths), clientPaths: true },
            ),
          };
        }
        case "Discard": {
          const status = yield* statusOf(cwd);
          const requested = new Set(act.paths);
          const changed = status.unstaged.filter((file) => requested.has(file.path));
          const untracked = changed
            .filter((file) => file.status === "untracked")
            .map((file) => file.path);
          const tracked = changed
            .filter((file) => file.status !== "untracked" && file.status !== "conflicted")
            .map((file) => file.path);
          const outputs: string[] = [];
          if (tracked.length > 0) {
            outputs.push(
              yield* runAction(
                "discard",
                cwd,
                ["restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"],
                { stdin: pathspecStdin(tracked), clientPaths: true },
              ),
            );
          }
          for (let start = 0; start < untracked.length; start += CLEAN_BATCH_SIZE) {
            outputs.push(
              yield* runAction(
                "clean",
                cwd,
                ["clean", "-f", "-q", "--", ...untracked.slice(start, start + CLEAN_BATCH_SIZE)],
                { clientPaths: true },
              ),
            );
          }
          return { output: outputs.filter((output) => output.length > 0).join("\n") };
        }
        case "Commit":
          return {
            output: yield* runAction(
              "commit",
              cwd,
              act.message === undefined
                ? ["commit", "--no-edit"]
                : ["commit", "--cleanup=strip", "-F", "-"],
              {
                ...(act.message === undefined ? {} : { stdin: act.message }),
                timeoutMs: COMMIT_TIMEOUT_MS,
              },
            ),
          };
        case "Merge": {
          // The short name makes git write "Merge branch 'x'"; anything not a branch must be a commit.
          const target =
            (yield* findBranch(cwd, act.ref))?.name ?? (yield* resolveCommit(cwd, act.ref));
          return {
            output: yield* runAction(
              "merge",
              cwd,
              ["merge", "--no-ff", "--no-edit", "--end-of-options", target],
              { timeoutMs: COMMIT_TIMEOUT_MS },
            ),
          };
        }
        case "MergeAbort":
          return { output: yield* runAction("merge.abort", cwd, ["merge", "--abort"]) };
        case "Fetch":
          return { output: yield* fetchAll(cwd) };
        case "Checkout": {
          const ref = yield* findBranch(cwd, act.ref);
          if (ref?.kind === "head") {
            return { output: yield* runAction("checkout", cwd, ["switch", ref.name]) };
          }
          if (ref?.kind === "remote") {
            const localName = act.localName ?? ref.name.slice(ref.name.indexOf("/") + 1);
            yield* assertBranchName(cwd, localName);
            return {
              output: yield* runAction("checkout", cwd, [
                "switch",
                "-c",
                localName,
                "--track",
                ref.fullName,
              ]),
            };
          }
          const commit = yield* resolveCommit(cwd, act.ref);
          return { output: yield* runAction("checkout", cwd, ["switch", "--detach", commit]) };
        }
        case "CreateBranch": {
          yield* assertBranchName(cwd, act.name);
          const startPoint = yield* resolveCommit(cwd, act.startPoint);
          return {
            output: yield* runAction(
              "createBranch",
              cwd,
              act.checkout
                ? ["switch", "-c", act.name, startPoint]
                : ["branch", act.name, startPoint],
            ),
          };
        }
        case "Stash": {
          const message = act.message?.trim();
          return {
            output: yield* runAction("stash", cwd, [
              "stash",
              "push",
              ...(act.includeUntracked ? ["--include-untracked"] : []),
              ...(message ? ["-m", message] : []),
            ]),
          };
        }
        case "StashApply":
        case "StashPop":
        case "StashDrop": {
          if (!STASH_SELECTOR.test(act.selector)) {
            return yield* new GitCommandError({
              operation: "GitGraphService.action",
              command: "git stash",
              cwd,
              detail: `"${act.selector}" is not a stash.`,
            });
          }
          const verb =
            act._tag === "StashApply" ? "apply" : act._tag === "StashPop" ? "pop" : "drop";
          return { output: yield* runAction(`stash.${verb}`, cwd, ["stash", verb, act.selector]) };
        }
      }
    },
  );

  return GitGraphService.of({ log, worktrees, action });
});

export const layer = Layer.effect(GitGraphService, make);
