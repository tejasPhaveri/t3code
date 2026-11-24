// This fork sends no product analytics: no events, no install or owner ids, and no
// reads of provider auth files. Callers keep the upstream interface so merges stay small.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TelemetryOwner } from "./Identify.ts";

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    /** Always false: this fork sends no product analytics. */
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<boolean>;

    readonly flush: Effect.Effect<void>;

    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      observedBy: "server" | "client",
    ) => Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {}

/** @public */
export const make = Effect.succeed(
  AnalyticsService.of({
    record: Effect.fn("AnalyticsService.record")(function* () {
      return yield* Effect.succeed(false);
    }),
    flush: Effect.void,
    recordOwners: Effect.fn("AnalyticsService.recordOwners")(function* () {
      yield* Effect.void;
    }),
  }),
);

export const layer = Layer.effect(AnalyticsService, make);
