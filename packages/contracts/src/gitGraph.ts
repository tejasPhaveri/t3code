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

/** `git log`'s commit ordering, so a reader can pick how the graph lays out. */
export const GitGraphLogOrder = Schema.Literals(["date", "author", "topo"]);
export type GitGraphLogOrder = typeof GitGraphLogOrder.Type;

export const GitGraphLogInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  maxCount: PositiveInt.check(Schema.isLessThanOrEqualTo(GIT_GRAPH_MAX_COMMITS)),
  showRemoteBranches: Schema.Boolean,
  /** Full ref names to limit the graph to; absent shows every branch. */
  refs: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(500))),
  order: Schema.optional(GitGraphLogOrder),
  /** Follow only each commit's first parent, as `git log --first-parent` does. */
  firstParent: Schema.optionalKey(Schema.Boolean),
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

/** A change in a commit or between two refs, as `--numstat` reports it. */
export const GitGraphDiffFile = Schema.Struct({
  path: Schema.String,
  oldPath: Schema.NullOr(Schema.String),
  status: GitGraphWorktreeFileStatus,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  binary: Schema.Boolean,
});
export type GitGraphDiffFile = typeof GitGraphDiffFile.Type;

export const GitGraphSignature = Schema.Struct({
  /** `%G?`: `G` good, `B` bad, `U` good but untrusted, `X`/`Y` expired, `R`/`E` unusable, `N` none. */
  code: Schema.String,
  signer: Schema.NullOr(Schema.String),
  key: Schema.NullOr(Schema.String),
});
export type GitGraphSignature = typeof GitGraphSignature.Type;

export const GitGraphCommitDetails = Schema.Struct({
  hash: GitGraphHash,
  parents: Schema.Array(GitGraphHash),
  author: Schema.String,
  authorEmail: Schema.String,
  authorTime: NonNegativeInt,
  committer: Schema.String,
  committerEmail: Schema.String,
  commitTime: NonNegativeInt,
  subject: Schema.String,
  /** The message after the subject line, with its own trailing newline removed. */
  body: Schema.String,
  signature: Schema.NullOr(GitGraphSignature),
  files: Schema.Array(GitGraphDiffFile),
});
export type GitGraphCommitDetails = typeof GitGraphCommitDetails.Type;

export const GitGraphCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** A commit, or a tag that peels to one. */
  hash: GitGraphHash,
});
export type GitGraphCommitInput = typeof GitGraphCommitInput.Type;

export const GitGraphTagDetails = Schema.Struct({
  name: Schema.String,
  /** The commit the tag points at. */
  hash: GitGraphHash,
  annotated: Schema.Boolean,
  tagger: Schema.NullOr(Schema.String),
  taggerEmail: Schema.NullOr(Schema.String),
  taggerTime: Schema.NullOr(NonNegativeInt),
  message: Schema.String,
});
export type GitGraphTagDetails = typeof GitGraphTagDetails.Type;

export const GitGraphTagInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
});
export type GitGraphTagInput = typeof GitGraphTagInput.Type;

/**
 * What a diff is taken against. `commit` compares with its first parent (or the empty tree for a
 * root commit), `range` compares two trees directly, and `worktree` compares a base with the
 * checkout, listing untracked files as additions.
 */
export const GitGraphDiffTarget = Schema.Union([
  Schema.TaggedStruct("commit", { hash: GitGraphHash }),
  Schema.TaggedStruct("range", {
    baseRef: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
    headRef: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  }),
  Schema.TaggedStruct("worktree", {
    baseRef: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  }),
]);
export type GitGraphDiffTarget = typeof GitGraphDiffTarget.Type;

export const GitGraphDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: GitGraphDiffTarget,
  /** Limits the patch to one file, so a large change loads as it is read. */
  file: Schema.optional(
    Schema.Struct({
      path: Schema.String,
      oldPath: Schema.NullOr(Schema.String),
    }),
  ),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type GitGraphDiffInput = typeof GitGraphDiffInput.Type;

export const GitGraphDiffResult = Schema.Struct({
  files: Schema.Array(GitGraphDiffFile),
  patch: Schema.String,
  /** The patch hit the server's size limit; `files` still lists every change. */
  truncated: Schema.Boolean,
});
export type GitGraphDiffResult = typeof GitGraphDiffResult.Type;

const GitGraphPaths = Schema.Array(Schema.String).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(20_000),
);
const GitGraphBranchName = TrimmedNonEmptyString.check(Schema.isMaxLength(255));
const GitGraphRefValue = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
const GitGraphRemoteName = TrimmedNonEmptyString.check(Schema.isMaxLength(255));
const GitGraphTagName = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
const GitGraphRemoteUrl = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));

export const GitGraphPullMode = Schema.Literals(["merge", "rebase", "ff-only"]);
export type GitGraphPullMode = typeof GitGraphPullMode.Type;

export const GitGraphResetMode = Schema.Literals(["soft", "mixed", "hard"]);
export type GitGraphResetMode = typeof GitGraphResetMode.Type;

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
   * `ref` is a full local or remote branch name, a tag, or a commit hash (checked out detached).
   * A remote branch is checked out as a new local branch named `localName`.
   */
  Schema.TaggedStruct("Checkout", {
    ref: GitGraphRefValue,
    localName: Schema.optional(GitGraphBranchName),
  }),
  Schema.TaggedStruct("CreateBranch", {
    name: GitGraphBranchName,
    startPoint: GitGraphRefValue,
    checkout: Schema.Boolean,
  }),
  Schema.TaggedStruct("Stash", {
    message: Schema.optional(Schema.String.check(Schema.isMaxLength(1_000))),
    includeUntracked: Schema.Boolean,
  }),
  /** Merges a full branch name or a commit hash into the checked-out branch with a merge commit. */
  Schema.TaggedStruct("Merge", { ref: GitGraphRefValue }),
  Schema.TaggedStruct("MergeAbort", {}),
  Schema.TaggedStruct("StashApply", { selector: Schema.String }),
  Schema.TaggedStruct("StashPop", { selector: Schema.String }),
  Schema.TaggedStruct("StashDrop", { selector: Schema.String }),
  /** Deletes a local branch; `force` drops commits that are on no other branch. */
  Schema.TaggedStruct("DeleteBranch", { name: GitGraphBranchName, force: Schema.Boolean }),
  Schema.TaggedStruct("RenameBranch", {
    name: GitGraphBranchName,
    newName: GitGraphBranchName,
  }),
  /**
   * Pushes a local branch to a remote. Without an upstream the branch starts tracking the remote
   * branch of the same name.
   */
  Schema.TaggedStruct("Push", {
    branch: GitGraphBranchName,
    remote: Schema.optional(GitGraphRemoteName),
    force: Schema.Boolean,
  }),
  /** Integrates the branch's upstream into the checkout. */
  Schema.TaggedStruct("Pull", { mode: GitGraphPullMode }),
  /** Rebases the checked-out branch onto `ref`. */
  Schema.TaggedStruct("Rebase", { ref: GitGraphRefValue }),
  Schema.TaggedStruct("Reset", { ref: GitGraphRefValue, mode: GitGraphResetMode }),
  /** Applies a commit from anywhere onto the checked-out branch. */
  Schema.TaggedStruct("CherryPick", { hash: GitGraphHash }),
  Schema.TaggedStruct("Revert", { hash: GitGraphHash }),
  /** Removes the checked-out branch's tip commit, keeping the rest of the branch. */
  Schema.TaggedStruct("DropCommit", { hash: GitGraphHash }),
  Schema.TaggedStruct("CreateTag", {
    name: GitGraphTagName,
    hash: GitGraphHash,
    message: Schema.optional(Schema.String.check(Schema.isMaxLength(50_000))),
    push: Schema.Boolean,
  }),
  Schema.TaggedStruct("DeleteTag", { name: GitGraphTagName }),
  Schema.TaggedStruct("PushTag", { name: GitGraphTagName }),
  /** Deletes untracked files and folders. */
  Schema.TaggedStruct("CleanUntracked", {}),
  Schema.TaggedStruct("AddRemote", { name: GitGraphRemoteName, url: GitGraphRemoteUrl }),
  Schema.TaggedStruct("RemoveRemote", { name: GitGraphRemoteName }),
  Schema.TaggedStruct("EditRemote", { name: GitGraphRemoteName, url: GitGraphRemoteUrl }),
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

export const GitGraphRemotesInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type GitGraphRemotesInput = typeof GitGraphRemotesInput.Type;

export const GitGraphRemote = Schema.Struct({
  name: Schema.String,
  fetchUrl: Schema.NullOr(Schema.String),
  pushUrl: Schema.NullOr(Schema.String),
});
export type GitGraphRemote = typeof GitGraphRemote.Type;

export const GitGraphRemotesResult = Schema.Struct({
  remotes: Schema.Array(GitGraphRemote),
});
export type GitGraphRemotesResult = typeof GitGraphRemotesResult.Type;
