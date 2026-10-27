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
  type GitGraphCommitDetails,
  type GitGraphCommitInput,
  type GitGraphDiffFile,
  type GitGraphDiffInput,
  type GitGraphDiffResult,
  type GitGraphError,
  type GitGraphLogInput,
  type GitGraphLogResult,
  type GitGraphRef,
  type GitGraphRemote,
  type GitGraphRemotesInput,
  type GitGraphRemotesResult,
  type GitGraphSignature,
  type GitGraphStash,
  type GitGraphTagDetails,
  type GitGraphTagInput,
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
    readonly commit: (
      input: GitGraphCommitInput,
    ) => Effect.Effect<GitGraphCommitDetails, GitGraphError>;
    readonly tag: (input: GitGraphTagInput) => Effect.Effect<GitGraphTagDetails, GitGraphError>;
    readonly diff: (input: GitGraphDiffInput) => Effect.Effect<GitGraphDiffResult, GitGraphError>;
    readonly remotes: (
      input: GitGraphRemotesInput,
    ) => Effect.Effect<GitGraphRemotesResult, GitGraphError>;
  }
>()("t3/git/GitGraphService") {}

const FIELD = "\x1f";
const RECORD = "\x1e";
const LOG_FORMAT = `${["%H", "%P", "%an", "%ae", "%at", "%s"].join("%x1f")}%x1e`;
const DETAIL_FORMAT = `${[
  "%H",
  "%P",
  "%an",
  "%ae",
  "%at",
  "%cn",
  "%ce",
  "%ct",
  "%G?",
  "%GS",
  "%GK",
  "%s",
  "%B",
].join("%x1f")}%x1e`;
const LOG_MAX_OUTPUT_BYTES = 16_000_000;
const STATUS_MAX_OUTPUT_BYTES = 16_000_000;
const DIFF_METADATA_MAX_OUTPUT_BYTES = 16_000_000;
// A commit's patch is read whole, so a huge one is cut rather than sent to the client in a frame.
const DIFF_PATCH_MAX_OUTPUT_BYTES = 4_000_000;
const NETWORK_TIMEOUT_MS = 120_000;
// Commit hooks (lint, tests) can take a while; they still must not hang a request forever.
const COMMIT_TIMEOUT_MS = 300_000;
const STASH_SELECTOR = /^stash@\{\d+\}$/;
const CLEAN_BATCH_SIZE = 200;
// An empty tree's object id is fixed for every repository, so a root commit diffs against it.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
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

const SIGNATURE_CODES = new Set(["G", "B", "U", "X", "Y", "R", "E"]);
const NO_SIGNATURE = new Set(["N", "", " "]);

/**
 * The commit's message without its subject line. `%B` repeats the subject, and only the first
 * line is dropped: a message with no blank line still has body lines, and its trailing newline
 * is the record separator's business. The blank line under the subject is a separator, not body.
 */
export function parseGitGraphCommitBody(message: string): { subject: string; body: string } {
  const normalized = message.replace(/\r\n/g, "\n");
  const firstBreak = normalized.indexOf("\n");
  if (firstBreak === -1) return { subject: normalized, body: "" };
  return {
    subject: normalized.slice(0, firstBreak),
    body: normalized
      .slice(firstBreak + 1)
      .replace(/^\n+/, "")
      .replace(/\n+$/, ""),
  };
}

export function parseGitGraphSignature(
  code: string | undefined,
  signer: string | undefined,
  key: string | undefined,
): GitGraphSignature | null {
  const trimmed = (code ?? "").trim();
  if (NO_SIGNATURE.has(trimmed)) return null;
  if (!SIGNATURE_CODES.has(trimmed)) return null;
  return {
    code: trimmed,
    signer: signer && signer.length > 0 ? signer : null,
    key: key && key.length > 0 ? key : null,
  };
}

export interface ParsedCommitDetails extends Omit<GitGraphCommitDetails, "files"> {
  readonly files: GitGraphDiffFile[];
}

/** One record from `DETAIL_FORMAT`; the body may itself contain fields, so it takes the rest. */
function parseGitGraphCommitDetails(stdout: string): ParsedCommitDetails | null {
  const record = stdout.split(RECORD)[0];
  if (!record) return null;
  const fields = record.replace(/^\n/, "").split(FIELD);
  const [hash, parents, author, authorEmail, authorTime, committer, committerEmail, commitTime] =
    fields;
  if (!hash || fields.length < 12) return null;
  const signatureCode = fields[8];
  const signatureSigner = fields[9];
  const signatureKey = fields[10];
  const message = fields.slice(12).join(FIELD).replace(/\n+$/, "");
  const { subject, body } = parseGitGraphCommitBody(message);
  return {
    hash,
    parents: splitParents(parents),
    author: author ?? "",
    authorEmail: authorEmail ?? "",
    authorTime: toSeconds(authorTime),
    committer: committer ?? "",
    committerEmail: committerEmail ?? "",
    commitTime: toSeconds(commitTime),
    subject,
    body,
    signature: parseGitGraphSignature(signatureCode, signatureSigner, signatureKey),
    files: [],
  };
}

const DIFF_LETTER_TO_STATUS: Record<string, GitGraphWorktreeFile["status"]> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
};

/**
 * `git diff --numstat -z` entries as `{ path, oldPath | null, additions, deletions, binary }`,
 * in git's own path order. A rename is `0\t0\t\0old\0new\0`.
 */
export function parseGitGraphNumstat(stdout: string): Array<{
  path: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}> {
  const entries: Array<{
    path: string;
    oldPath: string | null;
    additions: number;
    deletions: number;
    binary: boolean;
  }> = [];
  const fields = stdout.split("\0");
  let index = 0;
  while (index < fields.length) {
    const field = fields[index];
    index += 1;
    if (field === undefined || field.length === 0) continue;
    const firstTab = field.indexOf("\t");
    const secondTab = field.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;
    const added = field.slice(0, firstTab);
    const deleted = field.slice(firstTab + 1, secondTab);
    const rest = field.slice(secondTab + 1);
    const binary = added === "-" || deleted === "-";
    const additions = binary ? 0 : Number.parseInt(added, 10) || 0;
    const deletions = binary ? 0 : Number.parseInt(deleted, 10) || 0;
    if (rest.length > 0) {
      entries.push({ path: rest, oldPath: null, additions, deletions, binary });
      continue;
    }
    // A rename's source and destination follow as separate fields.
    const oldPath = fields[index];
    const newPath = fields[index + 1];
    index += 2;
    if (oldPath === undefined || newPath === undefined) continue;
    entries.push({ path: newPath, oldPath, additions, deletions, binary });
  }
  return entries;
}

/**
 * `git diff --name-status -z` as `{ path, oldPath | null, status }`; the numstat side supplies
 * the line counts and the binary flag, so a `-` count still knows what kind of change it is.
 */
export function parseGitGraphNameStatus(stdout: string): Array<{
  path: string;
  oldPath: string | null;
  status: GitGraphWorktreeFile["status"];
}> {
  const entries: Array<{
    path: string;
    oldPath: string | null;
    status: GitGraphWorktreeFile["status"];
  }> = [];
  const fields = stdout.split("\0");
  let index = 0;
  while (index < fields.length) {
    const code = fields[index];
    index += 1;
    if (code === undefined || code.length === 0) continue;
    const letter = code.charAt(0);
    const status = DIFF_LETTER_TO_STATUS[letter] ?? "modified";
    if (letter === "R" || letter === "C") {
      const oldPath = fields[index];
      const newPath = fields[index + 1];
      index += 2;
      if (oldPath === undefined || newPath === undefined) continue;
      entries.push({ path: newPath, oldPath, status });
      continue;
    }
    const path = fields[index];
    index += 1;
    if (path === undefined) continue;
    entries.push({ path, oldPath: null, status });
  }
  return entries;
}

/**
 * A commit's changes: the numstat counts joined to the name-status kinds, matched on the path
 * pair because a rename appears in both lists in the same order.
 */
export function mergeGitGraphDiffFiles(
  numstat: ReturnType<typeof parseGitGraphNumstat>,
  nameStatus: ReturnType<typeof parseGitGraphNameStatus>,
): GitGraphDiffFile[] {
  const statusByPath = new Map<string, GitGraphWorktreeFile["status"]>();
  for (const entry of nameStatus) {
    statusByPath.set(`${entry.oldPath ?? ""}\0${entry.path}`, entry.status);
  }
  return numstat.map((entry) => ({
    path: entry.path,
    oldPath: entry.oldPath,
    status: statusByPath.get(`${entry.oldPath ?? ""}\0${entry.path}`) ?? "modified",
    additions: entry.additions,
    deletions: entry.deletions,
    binary: entry.binary,
  }));
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

/** @public */
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
      readonly appendTruncationMarker?: boolean;
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
      ...(options?.appendTruncationMarker === true ? { appendTruncationMarker: true } : {}),
    });

  const stdoutOf = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: {
      readonly maxOutputBytes?: number;
      readonly env?: NodeJS.ProcessEnv;
    },
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
      // An explicit selection is the whole graph: adding `HEAD` would pull in every branch
      // reachable from the checkout and defeat the filter.
      const explicit = input.refs !== undefined;
      const revisions =
        selectedRefs.length > 0
          ? selectedRefs
          : explicit
            ? []
            : refs
                .filter((ref) => input.showRemoteBranches || ref.kind !== "remote")
                .map((ref) => ref.fullName);
      const startPoints = [...new Set([...revisions, ...(!explicit && head ? ["HEAD"] : [])])];
      const orderFlag =
        input.order === "author"
          ? "--author-date-order"
          : input.order === "topo"
            ? "--topo-order"
            : "--date-order";
      const commits =
        startPoints.length === 0
          ? []
          : parseGitGraphLog(
              (yield* run(
                "log",
                cwd,
                [
                  "log",
                  orderFlag,
                  ...(input.firstParent === true ? ["--first-parent"] : []),
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

  const assertTagName = Effect.fn("GitGraphService.assertTagName")(function* (
    cwd: string,
    name: string,
  ) {
    const valid =
      !name.startsWith("-") &&
      (yield* run("checkRefFormat", cwd, ["check-ref-format", `refs/tags/${name}`], {
        allowNonZeroExit: true,
      })).exitCode === 0;
    if (valid) return;
    return yield* new GitCommandError({
      operation: "GitGraphService.assertTagName",
      command: "git check-ref-format",
      cwd,
      detail: `"${name}" is not a valid tag name.`,
    });
  });

  const assertRemoteName = Effect.fn("GitGraphService.assertRemoteName")(function* (
    cwd: string,
    name: string,
  ) {
    const valid =
      !name.startsWith("-") &&
      !/[\s~^:?*[\\]/.test(name) &&
      !name.endsWith(".") &&
      !name.includes("..");
    if (valid) return;
    return yield* new GitCommandError({
      operation: "GitGraphService.assertRemoteName",
      command: "git remote",
      cwd,
      detail: `"${name}" is not a valid remote name.`,
    });
  });

  /**
   * A ref the client names, resolved to a commit. Only refs the repository actually has are
   * accepted, so an arbitrary revision expression (`main:evil`) cannot reach git.
   */
  const refCommit = Effect.fn("GitGraphService.refCommit")(function* (cwd: string, ref: string) {
    const refs = parseGitGraphRefs(
      yield* stdoutOf("resolveRef", cwd, [
        "for-each-ref",
        "--format=%(objectname)%1f%(*objectname)%1f%(refname)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ]),
    );
    const known = refs.find((candidate) => candidate.fullName === ref);
    if (known) return known.hash;
    return yield* resolveCommit(cwd, ref);
  });

  const commitDetails = Effect.fn("GitGraphService.commitDetails")(function* (
    cwd: string,
    hash: string,
  ) {
    const commit = yield* resolveCommit(cwd, hash);
    const [detailsOut, numstatOut, nameStatusOut] = yield* Effect.all(
      [
        stdoutOf("details", cwd, [
          "log",
          "-1",
          `--format=${DETAIL_FORMAT}`,
          "--end-of-options",
          commit,
        ]),
        // A merge commit's `diff-tree` output is empty unless it is told which parent to diff
        // against; the first parent is what a reader expects a merge to have brought in.
        stdoutOf(
          "details.numstat",
          cwd,
          [
            "diff-tree",
            "--root",
            "-m",
            "--first-parent",
            "-r",
            "--numstat",
            "-z",
            "--no-commit-id",
            commit,
          ],
          { maxOutputBytes: DIFF_METADATA_MAX_OUTPUT_BYTES },
        ),
        stdoutOf(
          "details.nameStatus",
          cwd,
          [
            "diff-tree",
            "--root",
            "-m",
            "--first-parent",
            "-r",
            "--name-status",
            "-z",
            "--no-commit-id",
            commit,
          ],
          { maxOutputBytes: DIFF_METADATA_MAX_OUTPUT_BYTES },
        ),
      ],
      { concurrency: 3 },
    );
    const details = parseGitGraphCommitDetails(detailsOut);
    if (details === null) {
      return yield* new GitCommandError({
        operation: "GitGraphService.commitDetails",
        command: "git log",
        cwd,
        detail: `Commit ${hash} could not be read.`,
      });
    }
    return {
      ...details,
      hash: commit,
      files: mergeGitGraphDiffFiles(
        parseGitGraphNumstat(numstatOut),
        parseGitGraphNameStatus(nameStatusOut),
      ),
    } satisfies GitGraphCommitDetails;
  });

  const commit: GitGraphService["Service"]["commit"] = Effect.fn("GitGraphService.commit")(
    function* (input) {
      yield* assertWorkspaceBoundCwd(input.cwd);
      return yield* commitDetails(input.cwd, input.hash);
    },
  );

  const tag: GitGraphService["Service"]["tag"] = Effect.fn("GitGraphService.tag")(
    function* (input) {
      yield* assertWorkspaceBoundCwd(input.cwd);
      const cwd = input.cwd;
      const name = input.name.startsWith("refs/tags/") ? input.name.slice(10) : input.name;
      const [described, peeled] = yield* Effect.all(
        [
          stdoutOf("tag.describe", cwd, [
            "for-each-ref",
            `--format=${[
              "%(objecttype)",
              "%(objectname)",
              "%(*objectname)",
              "%(taggername)",
              "%(taggeremail)",
              "%(taggerdate:unix)",
              "%(contents)",
            ].join(FIELD)}`,
            `refs/tags/${name}`,
          ]),
          stdoutOf("tag.peel", cwd, ["rev-list", "-n", "1", `refs/tags/${name}`]),
        ],
        { concurrency: 2 },
      );
      if (described.trim().length === 0) {
        return yield* new GitCommandError({
          operation: "GitGraphService.tag",
          command: "git for-each-ref",
          cwd,
          detail: `There is no tag named ${name}.`,
        });
      }
      const [objectType, objectName, peeledName, tagger, taggerEmail, taggerTime, ...contents] =
        described.split(FIELD);
      const annotated = objectType === "tag";
      const hash = (peeled.trim() || peeledName || objectName || "").trim();
      return {
        name,
        hash,
        annotated,
        tagger: annotated && tagger ? tagger : null,
        taggerEmail: annotated && taggerEmail ? taggerEmail.replace(/^<|>$/g, "") : null,
        taggerTime: annotated ? toSeconds(taggerTime) : null,
        message: annotated ? contents.join(FIELD).replace(/\n+$/, "") : "",
      } satisfies GitGraphTagDetails;
    },
  );

  /**
   * The tree a comparison starts from. A commit compares with its first parent, so a merge shows
   * what the merge brought in rather than everything its parents do. `head` null means the
   * checkout itself.
   */
  const resolveDiffBase = Effect.fn("GitGraphService.resolveDiffBase")(function* (
    cwd: string,
    target: GitGraphDiffInput["target"],
  ) {
    switch (target._tag) {
      case "range":
        return {
          base: yield* refCommit(cwd, target.baseRef),
          head: yield* refCommit(cwd, target.headRef),
        };
      case "worktree":
        return { base: yield* refCommit(cwd, target.baseRef), head: null };
      case "commit": {
        const hash = yield* resolveCommit(cwd, target.hash);
        const parents = (yield* stdoutOf("diffBase.parents", cwd, [
          "rev-list",
          "--parents",
          "-n",
          "1",
          hash,
        ]))
          .trim()
          .split(" ")
          .slice(1);
        return { base: parents[0] ?? EMPTY_TREE, head: hash };
      }
    }
  });

  /**
   * A working-tree comparison has to include untracked files, and no plain `git diff` shows
   * them. A throwing-away copy of the index with them added makes the diff see them, without
   * touching the checkout's own index. The copy outlives this call, so the caller scopes it.
   */
  const withUntrackedIndex = Effect.fn("GitGraphService.withUntrackedIndex")(function* <A, E>(
    cwd: string,
    body: (env: NodeJS.ProcessEnv) => Effect.Effect<A, E>,
  ) {
    const untracked = yield* stdoutOf(
      "diff.untracked",
      cwd,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { maxOutputBytes: DIFF_METADATA_MAX_OUTPUT_BYTES },
    );
    const paths = untracked.split("\0").filter((path) => path.length > 0);
    if (paths.length === 0) return yield* body({});
    const indexPath = (yield* stdoutOf("diff.indexPath", cwd, [
      "rev-parse",
      "--git-path",
      "index",
    ])).trim();
    const resolvedIndex = path.isAbsolute(indexPath) ? indexPath : path.resolve(cwd, indexPath);
    const prepared = yield* Effect.gen(function* () {
      const tempIndex = yield* fileSystem.makeTempFileScoped({
        prefix: `t3code-git-graph-index-${process.pid}-`,
      });
      if (yield* fileSystem.exists(resolvedIndex)) {
        yield* fileSystem.copyFile(resolvedIndex, tempIndex);
      }
      return tempIndex;
    }).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          Effect.fail(
            new GitCommandError({
              operation: "GitGraphService.withUntrackedIndex",
              command: "git diff",
              cwd,
              detail: "Could not prepare a temporary index for the comparison.",
              cause,
            }),
          ),
      }),
    );
    yield* run("diff.addUntracked", cwd, ["update-index", "--add", "-z", "--stdin"], {
      stdin: `${paths.join("\0")}\0`,
      env: { ...NON_INTERACTIVE, ...LITERAL_PATHSPECS, GIT_INDEX_FILE: prepared },
    });
    return yield* body({ GIT_INDEX_FILE: prepared });
  });

  /** The comparison's files and its patch, against the checkout when `head` is null. */
  const readDiff = Effect.fn("GitGraphService.readDiff")(function* (
    cwd: string,
    range: { readonly base: string; readonly head: string | null },
    pathArgs: ReadonlyArray<string>,
    indexEnv: NodeJS.ProcessEnv,
    ignoreWhitespace: boolean,
  ) {
    const common = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      ...(ignoreWhitespace ? ["--ignore-all-space"] : []),
      ...(range.head === null ? [range.base] : [range.base, range.head]),
      ...(pathArgs.length > 0 ? ["--", ...pathArgs] : []),
    ];
    const [numstatOut, nameStatusOut, patch] = yield* Effect.all(
      [
        stdoutOf("diff.numstat", cwd, [...common, "--numstat", "-z"], {
          maxOutputBytes: DIFF_METADATA_MAX_OUTPUT_BYTES,
          env: indexEnv,
        }),
        stdoutOf("diff.nameStatus", cwd, [...common, "--name-status", "-z"], {
          maxOutputBytes: DIFF_METADATA_MAX_OUTPUT_BYTES,
          env: indexEnv,
        }),
        run("diff.patch", cwd, [...common, "--no-color", "--patch"], {
          allowNonZeroExit: true,
          maxOutputBytes: DIFF_PATCH_MAX_OUTPUT_BYTES,
          appendTruncationMarker: true,
          env: { ...NON_INTERACTIVE, ...indexEnv },
        }),
      ],
      { concurrency: 3 },
    );
    return {
      files: mergeGitGraphDiffFiles(
        parseGitGraphNumstat(numstatOut),
        parseGitGraphNameStatus(nameStatusOut),
      ),
      patch: patch.stdout,
      truncated: patch.stdoutTruncated,
    } satisfies GitGraphDiffResult;
  });

  const diff: GitGraphService["Service"]["diff"] = Effect.fn("GitGraphService.diff")(
    function* (input) {
      yield* assertWorkspaceBoundCwd(input.cwd);
      const cwd = input.cwd;
      const pathArgs = input.file
        ? [...new Set([input.file.oldPath ?? input.file.path, input.file.path])].map(
            (path) => `:(top,literal)${path}`,
          )
        : [];
      const ignoreWhitespace = input.ignoreWhitespace === true;
      const range = yield* resolveDiffBase(cwd, input.target);
      return yield* Effect.scoped(
        range.head === null
          ? withUntrackedIndex(cwd, (indexEnv) =>
              readDiff(cwd, range, pathArgs, indexEnv, ignoreWhitespace),
            )
          : readDiff(cwd, range, pathArgs, {}, ignoreWhitespace),
      );
    },
  );

  const remotes: GitGraphService["Service"]["remotes"] = Effect.fn("GitGraphService.remotes")(
    function* (input) {
      yield* assertWorkspaceBoundCwd(input.cwd);
      const cwd = input.cwd;
      const namesOut = yield* stdoutOf("remotes.names", cwd, ["remote"]);
      const names = namesOut.split("\n").filter((name) => name.length > 0);
      const remotes = yield* Effect.forEach(
        names,
        (name) =>
          Effect.all(
            [
              stdoutOf("remotes.fetchUrl", cwd, ["remote", "get-url", name]),
              stdoutOf("remotes.pushUrl", cwd, ["remote", "get-url", "--push", name]),
            ],
            { concurrency: 2 },
          ).pipe(
            Effect.map(([fetchUrl, pushUrl]): GitGraphRemote => ({
              name,
              fetchUrl: fetchUrl.trim() || null,
              pushUrl: pushUrl.trim() || null,
            })),
          ),
        { concurrency: 4 },
      );
      return { remotes } satisfies GitGraphRemotesResult;
    },
  );

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
        case "DeleteBranch": {
          const branch = yield* findBranch(cwd, `refs/heads/${act.name}`);
          if (!branch || branch.kind !== "head") {
            return yield* new GitCommandError({
              operation: "GitGraphService.action",
              command: "git branch",
              cwd,
              detail: `There is no local branch named ${act.name}.`,
            });
          }
          return {
            output: yield* runAction(
              "deleteBranch",
              cwd,
              ["branch", act.force ? "-D" : "-d", "--", act.name],
              { clientPaths: true },
            ),
          };
        }
        case "RenameBranch": {
          yield* assertBranchName(cwd, act.newName);
          const branch = yield* findBranch(cwd, `refs/heads/${act.name}`);
          if (!branch || branch.kind !== "head") {
            return yield* new GitCommandError({
              operation: "GitGraphService.action",
              command: "git branch",
              cwd,
              detail: `There is no local branch named ${act.name}.`,
            });
          }
          return {
            output: yield* runAction("renameBranch", cwd, [
              "branch",
              "-m",
              "--",
              act.name,
              act.newName,
            ]),
          };
        }
        case "Push": {
          const branch = yield* findBranch(cwd, `refs/heads/${act.branch}`);
          if (!branch || branch.kind !== "head") {
            return yield* new GitCommandError({
              operation: "GitGraphService.action",
              command: "git push",
              cwd,
              detail: `There is no local branch named ${act.branch}.`,
            });
          }
          const remote =
            act.remote ??
            (yield* stdoutOf("push.remote", cwd, [
              "config",
              "--get",
              `branch.${act.branch}.remote`,
            ])).trim();
          return {
            output: yield* runAction(
              "push",
              cwd,
              [
                "push",
                ...(act.force ? ["--force-with-lease"] : []),
                ...(remote && remote !== "." ? ["--set-upstream"] : []),
                remote && remote !== "." ? remote : "origin",
                `refs/heads/${act.branch}:refs/heads/${act.branch}`,
              ],
              { timeoutMs: NETWORK_TIMEOUT_MS },
            ),
          };
        }
        case "Pull": {
          const modeFlag =
            act.mode === "rebase"
              ? "--rebase"
              : act.mode === "ff-only"
                ? "--ff-only"
                : "--no-rebase";
          return {
            output: yield* runAction("pull", cwd, ["pull", modeFlag, "--no-edit"], {
              timeoutMs: NETWORK_TIMEOUT_MS,
            }),
          };
        }
        case "Rebase": {
          const upstream = yield* refCommit(cwd, act.ref);
          return {
            output: yield* runAction("rebase", cwd, ["rebase", "--end-of-options", upstream], {
              timeoutMs: COMMIT_TIMEOUT_MS,
            }),
          };
        }
        case "Reset": {
          const target = yield* refCommit(cwd, act.ref);
          return {
            output: yield* runAction("reset", cwd, ["reset", `--${act.mode}`, target]),
          };
        }
        case "CherryPick": {
          const hash = yield* resolveCommit(cwd, act.hash);
          return {
            output: yield* runAction("cherryPick", cwd, ["cherry-pick", hash], {
              timeoutMs: COMMIT_TIMEOUT_MS,
            }),
          };
        }
        case "Revert": {
          const hash = yield* resolveCommit(cwd, act.hash);
          return {
            output: yield* runAction("revert", cwd, ["revert", "--no-edit", hash], {
              timeoutMs: COMMIT_TIMEOUT_MS,
            }),
          };
        }
        case "DropCommit": {
          const hash = yield* resolveCommit(cwd, act.hash);
          const head = (yield* stdoutOf("dropCommit.head", cwd, [
            "rev-parse",
            "--verify",
            "--quiet",
            "HEAD",
          ])).trim();
          if (!head) {
            return yield* new GitCommandError({
              operation: "GitGraphService.action",
              command: "git reset",
              cwd,
              detail: "This branch has no commit to drop.",
            });
          }
          // Rebasing rewrites the checked-out branch, so a commit it does not contain cannot
          // be dropped by this repository's checkout.
          const onHead =
            (yield* run("dropCommit.ancestor", cwd, ["merge-base", "--is-ancestor", hash, head], {
              allowNonZeroExit: true,
            })).exitCode === 0;
          if (!onHead) {
            return yield* new GitCommandError({
              operation: "GitGraphService.action",
              command: "git merge-base",
              cwd,
              detail: "That commit is not on the checked-out branch, so it cannot be dropped here.",
            });
          }
          if (hash === head) {
            return { output: yield* runAction("dropCommit", cwd, ["reset", "--hard", "HEAD~1"]) };
          }
          // Rebase replays everything after the commit onto its parent, leaving it out.
          return {
            output: yield* runAction("dropCommit", cwd, ["rebase", "--onto", `${hash}~1`, hash], {
              timeoutMs: COMMIT_TIMEOUT_MS,
            }),
          };
        }
        case "CreateTag": {
          yield* assertTagName(cwd, act.name);
          const hash = yield* resolveCommit(cwd, act.hash);
          const message = act.message?.trim();
          const output = yield* runAction(
            "createTag",
            cwd,
            message
              ? ["tag", "-a", "-F", "-", "--", act.name, hash]
              : ["tag", "--", act.name, hash],
            message ? { stdin: message } : {},
          );
          if (!act.push) return { output };
          const pushed = yield* runAction(
            "pushTag",
            cwd,
            ["push", "origin", `refs/tags/${act.name}`],
            {
              timeoutMs: NETWORK_TIMEOUT_MS,
            },
          );
          return { output: [output, pushed].filter((line) => line.length > 0).join("\n") };
        }
        case "DeleteTag": {
          yield* assertTagName(cwd, act.name);
          return { output: yield* runAction("deleteTag", cwd, ["tag", "-d", "--", act.name]) };
        }
        case "PushTag": {
          yield* assertTagName(cwd, act.name);
          return {
            output: yield* runAction("pushTag", cwd, ["push", "origin", `refs/tags/${act.name}`], {
              timeoutMs: NETWORK_TIMEOUT_MS,
            }),
          };
        }
        case "CleanUntracked":
          return {
            output: yield* runAction("cleanUntracked", cwd, ["clean", "-f", "-d"]),
          };
        case "AddRemote": {
          yield* assertRemoteName(cwd, act.name);
          return {
            output: yield* runAction("addRemote", cwd, ["remote", "add", "--", act.name, act.url], {
              clientPaths: true,
            }),
          };
        }
        case "EditRemote": {
          yield* assertRemoteName(cwd, act.name);
          return {
            output: yield* runAction(
              "editRemote",
              cwd,
              ["remote", "set-url", "--", act.name, act.url],
              { clientPaths: true },
            ),
          };
        }
        case "RemoveRemote": {
          yield* assertRemoteName(cwd, act.name);
          return {
            output: yield* runAction("removeRemote", cwd, ["remote", "remove", "--", act.name]),
          };
        }
      }
    },
  );

  return GitGraphService.of({ log, worktrees, action, commit, tag, diff, remotes });
});

export const layer = Layer.effect(GitGraphService, make);
