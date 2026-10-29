import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationV2RunStatus, RunId, ThreadId } from "@t3tools/contracts";

import { latestSideChatSource } from "./useSideChat";

const threadId = "thread-source" as ThreadId;

const run = (id: string, status: OrchestrationV2RunStatus) => ({
  id: id as RunId,
  status,
});

const assistant = (id: string, runId: string | null, status: "completed" | "running") =>
  ({
    sourceThreadId: threadId,
    sourceItemId: `item-${id}`,
    item: {
      type: "assistant_message",
      id: `message-${id}`,
      runId: runId === null ? null : (runId as RunId),
      status,
    },
  }) as never;

describe("latestSideChatSource", () => {
  it("branches from the last response of a settled run", () => {
    expect(
      latestSideChatSource(
        [assistant("a", "run-1", "completed"), assistant("b", "run-2", "completed")],
        [run("run-1", "completed"), run("run-2", "waiting")],
      ),
    ).toEqual({ sourceThreadId: threadId, runId: "run-2" });
  });

  it("ignores a completed response inside a run that is still streaming", () => {
    // A turn writes finished assistant messages as it works, so the newest completed message can
    // belong to the running run. The server refuses to fork that run; branching from it showed
    // "Fork source run ... is running; in-progress and rolled-back runs cannot be forked."
    expect(
      latestSideChatSource(
        [assistant("done", "run-1", "completed"), assistant("live", "run-2", "completed")],
        [run("run-1", "completed"), run("run-2", "running")],
      ),
    ).toEqual({ sourceThreadId: threadId, runId: "run-1" });
  });

  it("offers no source while the only response belongs to a running run", () => {
    expect(
      latestSideChatSource([assistant("live", "run-1", "completed")], [run("run-1", "running")]),
    ).toBeNull();
  });

  it.each(["preparing", "queued", "starting", "running", "rolled_back"] as const)(
    "never offers a response from a %s run",
    (status) => {
      expect(
        latestSideChatSource([assistant("live", "run-1", "completed")], [run("run-1", status)]),
      ).toBeNull();
    },
  );

  it("ignores a run the projection left out and messages with no run", () => {
    expect(latestSideChatSource([assistant("orphan", "run-missing", "completed")], [])).toBeNull();
    expect(latestSideChatSource([assistant("local", null, "completed")], [])).toBeNull();
  });
});
