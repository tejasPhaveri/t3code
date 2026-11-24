import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as AnalyticsService from "./AnalyticsService.ts";

// The layer needs no HttpClient, FileSystem, or home directory, so it cannot send or read anything.
it.effect("records nothing and reports every event as not sent", () =>
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;
    assert.equal(yield* analytics.record("thread.created", { model: "custom-model" }), false);
    yield* analytics.recordOwners([{ source: "claude", ownerId: "owner" }], "server");
    yield* analytics.flush;
  }).pipe(Effect.provide(AnalyticsService.layer)),
);
