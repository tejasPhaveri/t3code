import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

export const GIT_GRAPH_PAGE_SIZE = 300;
export const GIT_GRAPH_MAX_COMMITS = 20_000;

/** Full or abbreviated object id. Never a ref name, so it cannot be read as a git option. */
export const GitGraphHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{4,64}$/));
export type GitGraphHash = typeof GitGraphHash.Type;

export const GitGraphCommit = Schema.Struct({
  hash: GitGraphHash,
  parents: Schema.Array(GitGraphHash),
  author: Schema.String,
  authorEmail: Schema.String,
  /** Unix seconds. */
  authorTime: NonNegativeInt,
  subject: Schema.String,
});
export type GitGraphCommit = typeof GitGraphCommit.Type;

export const GitGraphRefKind = Schema.Literals(["head", "remote", "tag"]);
export type GitGraphRefKind = typeof GitGraphRefKind.Type;

export const GitGraphRef = Schema.Struct({
  kind: GitGraphRefKind,
  /** `refs/heads/main`, `refs/remotes/origin/main`, `refs/tags/v1`. */
  fullName: Schema.String,
  /** `main`, `origin/main`, `v1`. */
  name: Schema.String,
  /** The commit it points at; annotated tags are peeled. */
  hash: GitGraphHash,
});
export type GitGraphRef = typeof GitGraphRef.Type;

export const GitGraphStash = Schema.Struct({
  hash: GitGraphHash,
  /** The commit the stash was made on. */
  baseHash: GitGraphHash,
  /** `stash@{0}`. */
  selector: Schema.String,
  subject: Schema.String,
  authorTime: NonNegativeInt,
});
export type GitGraphStash = typeof GitGraphStash.Type;

export const GitGraphLogInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  maxCount: PositiveInt.check(Schema.isLessThanOrEqualTo(GIT_GRAPH_MAX_COMMITS)),
  showRemoteBranches: Schema.Boolean,
  /** Full ref names to limit the graph to; absent shows every branch. */
  refs: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(500))),
});
export type GitGraphLogInput = typeof GitGraphLogInput.Type;

export const GitGraphLogResult = Schema.Struct({
  commits: Schema.Array(GitGraphCommit),
  /** More commits exist past `maxCount`. */
  hasMore: Schema.Boolean,
  refs: Schema.Array(GitGraphRef),
  head: Schema.NullOr(Schema.Struct({ hash: GitGraphHash, branch: Schema.NullOr(Schema.String) })),
  stashes: Schema.Array(GitGraphStash),
  remotes: Schema.Array(Schema.String),
  uncommittedFileCount: NonNegativeInt,
});
export type GitGraphLogResult = typeof GitGraphLogResult.Type;

export const GitGraphError = Schema.Union([VcsError, GitCommandError]);
export type GitGraphError = typeof GitGraphError.Type;

export const GitGraphWorktreeFileStatus = Schema.Literals([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "untracked",
  "conflicted",
]);
export type GitGraphWorktreeFileStatus = typeof GitGraphWorktreeFileStatus.Type;

export const GitGraphWorktreeFile = Schema.Struct({
  path: Schema.String,
  oldPath: Schema.optional(Schema.String),
  status: GitGraphWorktreeFileStatus,
});
export type GitGraphWorktreeFile = typeof GitGraphWorktreeFile.Type;

export const GitGraphWorktree = Schema.Struct({
  path: Schema.String,
  /** Short branch name; null when HEAD is detached. */
  branch: Schema.NullOr(Schema.String),
  head: Schema.NullOr(GitGraphHash),
  /** The checkout the request came from. */
  current: Schema.Boolean,
  /** A merge stopped on conflicts and waits for a commit or an abort. */
  merging: Schema.Boolean,
  staged: Schema.Array(GitGraphWorktreeFile),
  unstaged: Schema.Array(GitGraphWorktreeFile),
});
export type GitGraphWorktree = typeof GitGraphWorktree.Type;

export const GitGraphWorktreesInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type GitGraphWorktreesInput = typeof GitGraphWorktreesInput.Type;

export const GitGraphWorktreesResult = Schema.Struct({
  worktrees: Schema.Array(GitGraphWorktree),
});
export type GitGraphWorktreesResult = typeof GitGraphWorktreesResult.Type;

const GitGraphPaths = Schema.Array(Schema.String).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(20_000),
);
const GitGraphBranchName = TrimmedNonEmptyString.check(Schema.isMaxLength(255));

export const GitGraphAction = Schema.Union([
  Schema.TaggedStruct("Stage", { paths: GitGraphPaths }),
  Schema.TaggedStruct("Unstage", { paths: GitGraphPaths }),
  /** Drops unstaged changes; untracked files are deleted. */
  Schema.TaggedStruct("Discard", { paths: GitGraphPaths }),
  /** Without a message, concludes a merge with git's prepared merge message. */
  Schema.TaggedStruct("Commit", {
    message: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(50_000))),
  }),
  Schema.TaggedStruct("Fetch", {}),
  /**
   * `ref` is a full local or remote branch name, or a commit hash (checked out detached).
   * A remote branch is checked out as a new local branch named `localName`.
   */
  Schema.TaggedStruct("Checkout", {
    ref: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
    localName: Schema.optional(GitGraphBranchName),
  }),
  Schema.TaggedStruct("CreateBranch", {
    name: GitGraphBranchName,
    startPoint: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
    checkout: Schema.Boolean,
  }),
  Schema.TaggedStruct("Stash", {
    message: Schema.optional(Schema.String.check(Schema.isMaxLength(1_000))),
    includeUntracked: Schema.Boolean,
  }),
  /** Merges a full branch name or a commit hash into the checked-out branch with a merge commit. */
  Schema.TaggedStruct("Merge", { ref: TrimmedNonEmptyString.check(Schema.isMaxLength(512)) }),
  Schema.TaggedStruct("MergeAbort", {}),
  Schema.TaggedStruct("StashApply", { selector: Schema.String }),
  Schema.TaggedStruct("StashPop", { selector: Schema.String }),
  Schema.TaggedStruct("StashDrop", { selector: Schema.String }),
]);
export type GitGraphAction = typeof GitGraphAction.Type;

export const GitGraphActionInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Runs in this worktree of `cwd`'s repository instead of `cwd` itself. */
  worktreePath: Schema.optional(TrimmedNonEmptyString),
  action: GitGraphAction,
});
export type GitGraphActionInput = typeof GitGraphActionInput.Type;

export const GitGraphActionResult = Schema.Struct({ output: Schema.String });
export type GitGraphActionResult = typeof GitGraphActionResult.Type;
