import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import type { ProviderCloudAgent, ProviderInstance } from "@t3tools/provider-core/server/driver";
import { ProviderInstanceId, ProviderDriverKind } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CloudAgentsService from "./CloudAgentsService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";

const instanceId = ProviderInstanceId.make("cursor");
const driverKind = ProviderDriverKind.make("cursor");

function cloudAgent(overrides: Partial<ProviderCloudAgent> = {}): ProviderCloudAgent {
  return {
    id: "agent-1",
    name: "Review the payroll change",
    summary: null,
    phase: "running",
    lastActivityAtMs: Date.parse("2026-10-27T12:00:00.000Z"),
    webUrl: "https://cursor.com/agents/agent-1",
    ...overrides,
  };
}

function instance(
  read: (() => Effect.Effect<ReadonlyArray<ProviderCloudAgent>, ProviderDriverError>) | undefined,
  id = instanceId,
): ProviderInstance {
  return {
    instanceId: id,
    driverKind,
    continuationIdentity: { driverKind, continuationKey: `${driverKind}:${id}` },
    displayName: "Cursor",
    enabled: true,
    // Only the fields this service reads matter here.
    snapshot: {} as ProviderInstance["snapshot"],
    orchestrationAdapter: {} as ProviderInstance["orchestrationAdapter"],
    textGeneration: {} as ProviderInstance["textGeneration"],
    ...(read === undefined ? {} : { listCloudAgents: read }),
  };
}

const run = (instances: ReadonlyArray<ProviderInstance>) =>
  CloudAgentsService.make.pipe(
    Effect.provideService(
      ProviderInstanceRegistry.ProviderInstanceRegistry,
      ProviderInstanceRegistry.ProviderInstanceRegistry.of({
        listInstances: Effect.succeed(instances),
      } as unknown as ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]),
    ),
    Effect.provide(Layer.empty),
  );

it.effect("skips providers without a cloud surface", () =>
  Effect.gen(function* () {
    const service = yield* run([instance(undefined)]);
    const result = yield* service.list();
    assert.deepEqual(result.agents, []);
    assert.deepEqual(result.failures, []);
  }),
);

it.effect("ranks running agents above finished ones, then by recency", () =>
  Effect.gen(function* () {
    const service = yield* run([
      instance(() =>
        Effect.succeed([
          cloudAgent({
            id: "finished-new",
            name: "Finished new",
            phase: "finished",
            lastActivityAtMs: 3000,
          }),
          cloudAgent({
            id: "running-old",
            name: "Running old",
            phase: "running",
            lastActivityAtMs: 1000,
          }),
          cloudAgent({
            id: "running-new",
            name: "Running new",
            phase: "running",
            lastActivityAtMs: 2000,
          }),
        ]),
      ),
    ]);
    const result = yield* service.list();
    assert.deepEqual(
      result.agents.map((agent) => agent.id),
      ["running-new", "running-old", "finished-new"],
    );
  }),
);

it.effect("keeps other providers' agents when one provider fails", () =>
  Effect.gen(function* () {
    const otherId = ProviderInstanceId.make("cursor-work");
    const service = yield* run([
      instance(() =>
        Effect.fail(
          new ProviderDriverError({
            driver: driverKind,
            instanceId,
            detail: "boom",
          }),
        ),
      ),
      instance(() => Effect.succeed([cloudAgent({ id: "kept" })]), otherId),
    ]);
    const result = yield* service.list();
    assert.deepEqual(
      result.agents.map((agent) => agent.id),
      ["kept"],
    );
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.providerInstanceId, instanceId);
  }),
);

it.effect("serves a cached result until refresh is requested", () =>
  Effect.gen(function* () {
    let reads = 0;
    const service = yield* run([
      instance(() => {
        reads += 1;
        return Effect.succeed([cloudAgent()]);
      }),
    ]);
    yield* service.list();
    yield* service.list();
    assert.equal(reads, 1);
    yield* service.list({ refresh: true });
    assert.equal(reads, 2);
  }),
);
