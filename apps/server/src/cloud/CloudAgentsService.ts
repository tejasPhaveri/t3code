import { CloudAgent, type CloudAgentListResult } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";

/**
 * Short enough that a finished agent clears on its own, long enough that several
 * open clients share one provider round trip instead of one each.
 */
const CLOUD_AGENT_CACHE_MS = 15_000;

type CachedList = { readonly result: CloudAgentListResult; readonly atMs: number };

export class CloudAgentsService extends Context.Service<
  CloudAgentsService,
  {
    readonly list: (input?: {
      readonly refresh?: boolean | undefined;
    }) => Effect.Effect<CloudAgentListResult>;
  }
>()("t3/cloud/CloudAgentsService") {}

export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const cache = yield* Ref.make<CachedList | null>(null);

  const collect = Effect.fn("CloudAgentsService.collect")(function* (
    agents: CloudAgent[],
    failures: Array<CloudAgentListResult["failures"][number]>,
  ) {
    const instances = yield* registry.listInstances;
    for (const instance of instances) {
      const read = instance.listCloudAgents;
      if (read === undefined) continue;
      const providerLabel = instance.displayName ?? instance.driverKind;
      const listed = yield* read().pipe(
        // One unreadable provider must not hide the others' agents.
        Effect.catch(() =>
          Effect.sync(() => {
            failures.push({
              providerInstanceId: instance.instanceId,
              providerLabel,
              message: "Could not read cloud agents for this provider.",
            });
            return null;
          }),
        ),
      );
      if (listed === null) continue;
      for (const agent of listed) {
        agents.push({
          id: agent.id,
          providerInstanceId: instance.instanceId,
          providerLabel,
          name: agent.name,
          summary: agent.summary,
          phase: agent.phase,
          lastActivityAt: DateTime.makeUnsafe(agent.lastActivityAtMs),
          webUrl: agent.webUrl,
        });
      }
    }
  });

  const load = Effect.fn("CloudAgentsService.load")(function* () {
    const agents: CloudAgent[] = [];
    const failures: Array<CloudAgentListResult["failures"][number]> = [];
    yield* collect(agents, failures);
    const nowMs = yield* Clock.currentTimeMillis;
    // Running first so work in flight outranks older finished agents.
    agents.sort((left, right) => {
      const leftRunning = left.phase === "running" ? 0 : 1;
      const rightRunning = right.phase === "running" ? 0 : 1;
      return leftRunning === rightRunning
        ? DateTime.toEpochMillis(right.lastActivityAt) - DateTime.toEpochMillis(left.lastActivityAt)
        : leftRunning - rightRunning;
    });
    return {
      result: {
        agents,
        checkedAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
        failures,
      } satisfies CloudAgentListResult,
      nowMs,
    };
  });

  const list: CloudAgentsService["Service"]["list"] = Effect.fn("CloudAgentsService.list")(
    function* (input) {
      if (input?.refresh !== true) {
        const nowMs = yield* Clock.currentTimeMillis;
        const cached = yield* Ref.get(cache);
        if (cached !== null && nowMs - cached.atMs < CLOUD_AGENT_CACHE_MS) return cached.result;
      }
      const loaded = yield* load();
      yield* Ref.set(cache, { result: loaded.result, atMs: loaded.nowMs });
      return loaded.result;
    },
  );

  return CloudAgentsService.of({ list });
});

export const layer = Layer.effect(CloudAgentsService, make);
