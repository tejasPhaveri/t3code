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
