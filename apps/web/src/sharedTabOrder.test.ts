import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface } from "./rightPanelStore";
import {
  applySharedTabOrder,
  followSharedActiveTab,
  includeSharedTabs,
  recordSharedTabOrder,
  sharedSurfaceKey,
} from "./sharedTabOrder";

const browser = (tabId: string): RightPanelSurface => ({
  id: `browser:${tabId}`,
  kind: "preview",
  resourceId: tabId,
});
const ownTerminal = (terminalId: string): RightPanelSurface => ({
  id: `terminal:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
});
const sharedTerminal = (ownerThreadId: string, terminalId: string): RightPanelSurface => ({
  id: `terminal:${ownerThreadId}:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
  ownerThreadId,
});
const gitGraph: RightPanelSurface = { id: "git-graph", kind: "git-graph" };
const diff: RightPanelSurface = { id: "diff", kind: "diff" };

const ids = (surfaces: readonly RightPanelSurface[]) => surfaces.map((surface) => surface.id);

describe("shared tab order", () => {
  it("shows a tab dragged in one chat in the same place in another chat of the project", () => {
    // Chat A owns terminal t1; chat B shows it by reference and has its own diff tab.
    const chatA = [browser("tab_1"), ownTerminal("t1"), gitGraph, browser("tab_2")];
    const chatB = [diff, browser("tab_1"), browser("tab_2"), gitGraph, sharedTerminal("A", "t1")];

    const dragged = [gitGraph, browser("tab_2"), browser("tab_1"), ownTerminal("t1")];
    const order = recordSharedTabOrder(includeSharedTabs([], "A", chatA), "A", dragged);

    expect(ids(applySharedTabOrder("B", chatB, order))).toEqual([
      "diff",
      "git-graph",
      "browser:tab_2",
      "browser:tab_1",
      "terminal:A:t1",
    ]);
    expect(applySharedTabOrder("A", dragged, order)).toBe(dragged);
  });

  it("agrees on tabs nobody has dragged, keeping a chat's own tabs in their slots", () => {
    const order = includeSharedTabs([], "A", [ownTerminal("t1"), browser("tab_1")]);
    const chatB = [browser("tab_1"), diff, sharedTerminal("A", "t1"), browser("tab_9")];

    expect(ids(applySharedTabOrder("B", chatB, order))).toEqual([
      "terminal:A:t1",
      "diff",
      "browser:tab_1",
      "browser:tab_9",
    ]);
    expect(includeSharedTabs(order, "A", [browser("tab_1")])).toBe(order);
  });

  it("switches a chat to the tab selected in another chat of the project", () => {
    // Chat A selected its own terminal; chat B sees it by reference.
    const key = sharedSurfaceKey("A", ownTerminal("t1"))!;
    const tabs = [browser("tab_1"), sharedTerminal("A", "t1")];

    expect(followSharedActiveTab("B", tabs, "browser:tab_1", key)).toBe("terminal:A:t1");
    expect(followSharedActiveTab("B", tabs, "terminal:A:t1", key)).toBeNull();
    // A new chat whose tabs have not arrived yet waits for them.
    expect(followSharedActiveTab("B", [browser("tab_1")], "browser:tab_1", key)).toBeNull();
    expect(followSharedActiveTab("B", tabs, "browser:tab_1", undefined)).toBeNull();
  });

  it("leaves a chat on a tab of its own", () => {
    const key = sharedSurfaceKey("A", gitGraph)!;
    expect(followSharedActiveTab("B", [diff, gitGraph], "diff", key)).toBeNull();
    expect(followSharedActiveTab("B", [diff, gitGraph], null, key)).toBe("git-graph");
  });
});
