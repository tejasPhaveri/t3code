import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { type PreviewEvent, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import { expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as PreviewManager from "./Manager.ts";

const DRAIN_LIMIT = 100;

interface EventCollector {
  readonly drain: Effect.Effect<ReadonlyArray<PreviewEvent>>;
}

/** The shared live layer retains state between tests; counts need unique thread ids. */
let nextThreadId = 0;
const freshThreadId = () => ThreadId.make(`thread-${++nextThreadId}`);

/** Subscribe synchronously before publishing so the forked consumer cannot miss events. */
const collectEvents = Effect.gen(function* () {
  const manager = yield* PreviewManager.PreviewManager;
  const subscription = yield* manager.subscribeEvents;
  const collector: EventCollector = {
    drain: PubSub.takeUpTo(subscription, DRAIN_LIMIT),
  };
  return collector;
}).pipe(Effect.withSpan("preview.test.collectEvents"));

const layer = PreviewManager.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-preview-manager-" })),
  Layer.provide(NodeCrypto.layer),
  Layer.provide(NodeServices.layer),
);

it.layer(layer)("PreviewManager", (it) => {
  it.effect("opens a session and emits opened with normalized URL", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;

      const snapshot = yield* manager.open({ threadId, url: "localhost:5173" });
      expect(snapshot.tabId.startsWith("tab_")).toBe(true);
      expect(snapshot.navStatus._tag).toBe("Loading");
      if (snapshot.navStatus._tag === "Loading") {
        expect(snapshot.navStatus.url).toBe("http://localhost:5173/");
      }

      const events = yield* collector.drain;
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("opened");
      if (events[0]?.type === "opened") {
        expect(events[0].tabId).toBe(snapshot.tabId);
      }
    }),
  );

  it.effect("opens a restored lazy tab at its saved page and zoom without claiming to load", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;

      const snapshot = yield* manager.open({
        threadId,
        url: "https://staging.example.com/admin?role=owner",
        title: "Admin",
        lazy: true,
        zoomFactor: 1.25,
      });

      expect(snapshot.lazy).toBe(true);
      expect(snapshot.zoomFactor).toBe(1.25);
      expect(snapshot.navStatus).toEqual({
        _tag: "Success",
        url: "https://staging.example.com/admin?role=owner",
        title: "Admin",
      });
    }),
  );

  it.effect("keeps the tab's profile across status reports", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;

      const opened = yield* manager.open({ threadId, profileId: "work" });
      expect(opened.profileId).toBe("work");

      yield* manager.reportStatus({
        threadId,
        tabId: opened.tabId,
        navStatus: { _tag: "Success", url: "http://localhost:5173/", title: "Dev" },
        canGoBack: true,
        canGoForward: false,
      });
      const listed = yield* manager.list({ threadId });
      expect(listed.sessions.find((s) => s.tabId === opened.tabId)?.profileId).toBe("work");
    }),
  );

  it.effect("reissues presentation requests without replaying them on navigation", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;
      const opened = yield* manager.open({ threadId, runtime: "server", reveal: false });
      yield* manager.requestReveal({ threadId, tabId: opened.tabId, force: true });
      const first = (yield* manager.list({ threadId })).sessions[0];
      expect(first?.reveal).toBe(true);
      expect(first?.revealRequest?.force).toBe(true);
      yield* manager.reportStatus({
        threadId,
        tabId: opened.tabId,
        serverControlled: true,
        navStatus: { _tag: "Success", url: "http://localhost:5173/", title: "Dev" },
        canGoBack: false,
        canGoForward: false,
      });
      expect((yield* manager.list({ threadId })).sessions[0]?.revealRequest).toEqual(
        first?.revealRequest,
      );
      yield* manager.requestReveal({ threadId, tabId: opened.tabId, force: false });
      const second = (yield* manager.list({ threadId })).sessions[0];
      expect(second?.revealRequest?.id).not.toBe(first?.revealRequest?.id);
      expect(second?.revealRequest?.force).toBe(false);
      const events = yield* collector.drain;
      const last = events.at(-1);
      expect(last?.type).toBe("navigated");
      if (last?.type === "navigated")
        expect(last.snapshot.revealRequest).toEqual(second?.revealRequest);
    }),
  );

  it.effect("orders list snapshots and events with one monotonic revision", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;
      const before = yield* manager.list({ threadId });

      const opened = yield* manager.open({ threadId, url: "http://localhost:5173" });
      yield* manager.reportStatus({
        threadId,
        tabId: opened.tabId,
        navStatus: { _tag: "Success", url: "http://localhost:5173/ready", title: "Ready" },
        canGoBack: true,
        canGoForward: false,
      });

      const events = yield* collector.drain;
      const listed = yield* manager.list({ threadId });
      expect(events).toHaveLength(2);
      expect(events[0]!.serverEpoch).toBe(listed.serverEpoch);
      expect(events[1]!.serverEpoch).toBe(listed.serverEpoch);
      expect(events[0]!.revision).toBeGreaterThan(before.revision);
      expect(events[1]!.revision).toBeGreaterThan(events[0]!.revision);
      expect(listed.revision).toBe(events[1]!.revision);
      expect(listed.sessions).toHaveLength(1);
    }),
  );

  it.effect("resizes a tab and preserves its viewport across navigation reports", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const collector = yield* collectEvents;
      const opened = yield* manager.open({ threadId, url: "http://localhost:5173" });

      const resized = yield* manager.resize({
        threadId,
        tabId: opened.tabId,
        viewport: { _tag: "freeform", width: 1024, height: 768 },
      });
      expect(resized.viewport).toEqual({ _tag: "freeform", width: 1024, height: 768 });

      yield* manager.reportStatus({
        threadId,
        tabId: opened.tabId,
        navStatus: { _tag: "Success", url: "http://localhost:5173/resized", title: "Resized" },
        canGoBack: true,
        canGoForward: false,
      });
      const listed = yield* manager.list({ threadId });
      expect(listed.sessions[0]?.viewport).toEqual(resized.viewport);

      const events = yield* collector.drain;
      expect(events.map((event) => event.type)).toEqual(["opened", "resized", "navigated"]);
    }),
  );

  it.effect(
    "rejects client status reports for server tabs without changing state or emitting events",
    () =>
      Effect.gen(function* () {
        const threadId = freshThreadId();
        const manager = yield* PreviewManager.PreviewManager;
        const opened = yield* manager.open({ threadId, runtime: "server", reveal: false });
        const collector = yield* collectEvents;
        const before = yield* manager.list({ threadId });
        const input = {
          threadId,
          tabId: opened.tabId,
          navStatus: {
            _tag: "Success" as const,
            url: "http://localhost:5173/changed",
            title: "Changed",
          },
          canGoBack: true,
          canGoForward: true,
        };
        const rejected = yield* manager.reportStatus(input).pipe(Effect.flip);
        expect(rejected._tag).toBe("PreviewControlRequiredError");
        expect(yield* manager.list({ threadId })).toEqual(before);
        expect(yield* collector.drain).toEqual([]);

        yield* manager.reportStatus({ ...input, serverControlled: true });
        expect((yield* manager.list({ threadId })).sessions[0]).toMatchObject({
          navStatus: input.navStatus,
          canGoBack: true,
          canGoForward: true,
        });
        const events = yield* collector.drain;
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type: "navigated",
          snapshot: { navStatus: input.navStatus },
        });
      }),
  );

  it.effect("gives every tab in a batch close its own monotonic revision", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      yield* manager.open({ threadId, url: "http://localhost:5173" });
      yield* manager.open({ threadId, url: "http://localhost:3000" });
      const collector = yield* collectEvents;

      yield* manager.close({ threadId });

      const events = yield* collector.drain;
      const listed = yield* manager.list({ threadId });
      expect(events).toHaveLength(2);
      expect(events.every((event) => event.type === "closed")).toBe(true);
      expect(events[1]!.revision).toBeGreaterThan(events[0]!.revision);
      expect(listed.revision).toBe(events[1]!.revision);
      expect(listed.sessions).toHaveLength(0);
    }),
  );

  it.effect("lists a project's tabs to another chat and keeps an isolated tab private", () =>
    Effect.gen(function* () {
      const owner = freshThreadId();
      const sibling = freshThreadId();
      const otherProject = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const shared = yield* manager.open({
        threadId: owner,
        url: "http://localhost:5173",
        projectId: ProjectId.make("project-1"),
        persistence: "project",
      });
      const isolated = yield* manager.open({
        threadId: owner,
        url: "http://localhost:3000",
        projectId: ProjectId.make("project-1"),
        persistence: "project",
        isolated: true,
      });

      const siblingList = yield* manager.list({
        threadId: sibling,
        projectId: ProjectId.make("project-1"),
        persistence: "project",
      });
      expect(siblingList.sessions.map((session) => session.tabId)).toEqual([shared.tabId]);

      const ownerList = yield* manager.list({
        threadId: owner,
        projectId: ProjectId.make("project-1"),
        persistence: "project",
      });
      expect(ownerList.sessions.map((session) => session.tabId).toSorted()).toEqual(
        [shared.tabId, isolated.tabId].toSorted(),
      );

      const elsewhere = yield* manager.list({
        threadId: otherProject,
        projectId: ProjectId.make("project-2"),
        persistence: "project",
      });
      expect(elsewhere.sessions).toEqual([]);

      const environment = yield* manager.list({
        threadId: sibling,
        persistence: "environment",
      });
      // The manager layer is shared with earlier tests, so environment scope
      // also includes their non-isolated tabs. This test only owns these two.
      const environmentIds = environment.sessions.map((session) => session.tabId);
      expect(environmentIds).toContain(shared.tabId);
      expect(environmentIds).not.toContain(isolated.tabId);
    }),
  );

  it.effect("forgets a tab's own zoom so it follows the default again", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const opened = yield* manager.open({ threadId, url: "localhost:5173" });

      const zoomed = yield* manager.adjust({ threadId, tabId: opened.tabId, zoomFactor: 1.25 });
      expect(zoomed.zoomFactor).toBe(1.25);

      const following = yield* manager.adjust({
        threadId,
        tabId: opened.tabId,
        followDefaultZoom: true,
      });
      expect(following.zoomFactor).toBeUndefined();
    }),
  );

  it.effect("close with explicit tabId removes only that tab", () =>
    Effect.gen(function* () {
      const threadId = freshThreadId();
      const manager = yield* PreviewManager.PreviewManager;
      const a = yield* manager.open({ threadId, url: "http://localhost:5173" });
      const b = yield* manager.open({ threadId, url: "http://localhost:3000" });

      yield* manager.close({ threadId, tabId: a.tabId });

      const list = yield* manager.list({ threadId });
      expect(list.sessions.map((s) => s.tabId)).toEqual([b.tabId]);
    }),
  );
});
