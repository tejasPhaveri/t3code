import { layoutGitGraph, type GitGraphLayout } from "@t3tools/client-runtime/git-graph/layout";
import type {
  GitGraphCommit,
  GitGraphLogResult,
  GitGraphRef,
  GitGraphStash,
} from "@t3tools/contracts";

export const UNCOMMITTED_ROW_KEY = "uncommitted";

/** A branch label: a local branch absorbs remotes of the same name on the same commit. */
export interface GitGraphBranchLabel {
  readonly kind: "head" | "remote";
  readonly name: string;
  readonly fullName: string;
  /** Remotes (`origin`) whose branch of this name sits on the same commit. */
  readonly remotes: readonly string[];
  readonly checkedOut: boolean;
}

export type GitGraphRowItem =
  | { readonly kind: "uncommitted"; readonly key: string; readonly fileCount: number }
  | { readonly kind: "stash"; readonly key: string; readonly stash: GitGraphStash }
  | {
      readonly kind: "commit";
      readonly key: string;
      readonly commit: GitGraphCommit;
      readonly branches: readonly GitGraphBranchLabel[];
      readonly tags: readonly GitGraphRef[];
      readonly isHead: boolean;
    };

export interface GitGraphRowsModel {
  readonly items: readonly GitGraphRowItem[];
  readonly layout: GitGraphLayout;
}

function branchLabels(
  refs: readonly GitGraphRef[],
  remotes: readonly string[],
  checkedOutBranch: string | null,
): GitGraphBranchLabel[] {
  const heads = refs.filter((ref) => ref.kind === "head");
  const absorbed = new Set<string>();
  const labels: GitGraphBranchLabel[] = heads.map((head) => {
    const matching = remotes.filter((remote) =>
      refs.some((ref) => ref.kind === "remote" && ref.name === `${remote}/${head.name}`),
    );
    for (const remote of matching) absorbed.add(`${remote}/${head.name}`);
    return {
      kind: "head",
      name: head.name,
      fullName: head.fullName,
      remotes: matching,
      checkedOut: head.name === checkedOutBranch,
    };
  });
  for (const ref of refs) {
    if (ref.kind !== "remote" || absorbed.has(ref.name)) continue;
    labels.push({
      kind: "remote",
      name: ref.name,
      fullName: ref.fullName,
      remotes: [],
      checkedOut: false,
    });
  }
  // The checked-out branch leads, as the label a reader looks for first.
  return labels.toSorted((left, right) => Number(right.checkedOut) - Number(left.checkedOut));
}

export function buildGitGraphRows(log: GitGraphLogResult): GitGraphRowsModel {
  const refsByHash = new Map<string, GitGraphRef[]>();
  for (const ref of log.refs) {
    const list = refsByHash.get(ref.hash);
    if (list) list.push(ref);
    else refsByHash.set(ref.hash, [ref]);
  }
  const stashesByBase = new Map<string, GitGraphStash[]>();
  for (const stash of log.stashes) {
    const list = stashesByBase.get(stash.baseHash);
    if (list) list.push(stash);
    else stashesByBase.set(stash.baseHash, [stash]);
  }

  const items: GitGraphRowItem[] = [];
  const parentsByKey = new Map<string, readonly string[]>();
  if (log.head !== null && log.uncommittedFileCount > 0) {
    items.push({
      kind: "uncommitted",
      key: UNCOMMITTED_ROW_KEY,
      fileCount: log.uncommittedFileCount,
    });
    parentsByKey.set(UNCOMMITTED_ROW_KEY, [log.head.hash]);
  }
  for (const commit of log.commits) {
    for (const stash of stashesByBase.get(commit.hash) ?? []) {
      const key = `stash:${stash.hash}`;
      items.push({ kind: "stash", key, stash });
      parentsByKey.set(key, [stash.baseHash]);
    }
    const refs = refsByHash.get(commit.hash) ?? [];
    items.push({
      kind: "commit",
      key: commit.hash,
      commit,
      branches: branchLabels(refs, log.remotes, log.head?.branch ?? null),
      tags: refs.filter((ref) => ref.kind === "tag"),
      isHead: log.head?.hash === commit.hash,
    });
    parentsByKey.set(commit.hash, commit.parents);
  }

  return {
    items,
    layout: layoutGitGraph(
      items.map((item) => ({ hash: item.key, parents: parentsByKey.get(item.key) ?? [] })),
    ),
  };
}
