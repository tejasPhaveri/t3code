import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/**
 * Cloud agents live outside T3's run lifecycle, so the client polls rather than
 * subscribing: the provider only learns of a change when it is asked.
 */
export function createCloudAgentsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:cloud-agents:list",
      tag: WS_METHODS.cloudAgentsList,
      staleTimeMs: 15_000,
      refreshIntervalMs: 30_000,
    }),
  };
}
