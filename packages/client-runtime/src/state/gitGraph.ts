import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createGitGraphEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    log: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-graph:log",
      tag: WS_METHODS.gitGraphLog,
      staleTimeMs: 2_000,
    }),
    worktrees: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-graph:worktrees",
      tag: WS_METHODS.gitGraphWorktrees,
      staleTimeMs: 2_000,
    }),
    commit: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-graph:commit",
      tag: WS_METHODS.gitGraphCommit,
      // A commit is immutable, so its details never go stale.
      staleTimeMs: Number.POSITIVE_INFINITY,
    }),
    tag: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-graph:tag",
      tag: WS_METHODS.gitGraphTag,
      // Tags move, but rarely; refetching on every panel focus would be wasteful.
      staleTimeMs: 30_000,
    }),
    diff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-graph:diff",
      tag: WS_METHODS.gitGraphDiff,
      // A commit's patch cannot change. A working-tree patch can, so it refetches on demand.
      staleTimeMs: 5_000,
    }),
    remotes: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-graph:remotes",
      tag: WS_METHODS.gitGraphRemotes,
      staleTimeMs: 30_000,
    }),
    // Serial per checkout, shared with T3's other Git commands, so two quick clicks
    // never race on the index lock.
    action: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-graph:action",
      tag: WS_METHODS.gitGraphAction,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
