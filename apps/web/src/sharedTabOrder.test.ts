import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface } from "./rightPanelStore";
import {
  applySharedTabOrder,
  followSharedActiveTab,
  includeSharedTabs,
  recordSharedTabOrder,
  sharedSurfaceKey,
  windowPanelView,
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

  it("selects a tab in a chat that has tabs but none selected", () => {
    const key = sharedSurfaceKey("A", gitGraph)!;
    const tabs = [browser("tab_1"), gitGraph];

    expect(followSharedActiveTab("B", tabs, null, key)).toBe("git-graph");
    // A selection whose tab is gone counts as none.
    expect(followSharedActiveTab("B", tabs, "browser:tab_9", key)).toBe("git-graph");
    expect(followSharedActiveTab("B", [browser("tab_1")], null, key)).toBe("browser:tab_1");
    expect(followSharedActiveTab("B", tabs, null, undefined)).toBe("browser:tab_1");
    expect(followSharedActiveTab("B", [], null, key)).toBeNull();
  });

  it("leaves a chat on a tab of its own", () => {
    const key = sharedSurfaceKey("A", gitGraph)!;
    expect(followSharedActiveTab("B", [diff, gitGraph], "diff", key)).toBeNull();
  });

  it("splits a chat's tabs between the main window and the panel window", () => {
    const tabs = [gitGraph, browser("tab_1"), browser("tab_2"), diff];
    const mainKeys = ["git-graph", "browser:tab_2"];

    const main = windowPanelView("A", tabs, "browser:tab_1", "main", mainKeys, "browser:tab_2");
    expect(ids(main.surfaces)).toEqual(["git-graph", "browser:tab_2"]);
    // The chat's selection is in the other window, so this one keeps the tab it showed last.
    expect(main.activeSurfaceId).toBe("browser:tab_2");

    const panel = windowPanelView("A", tabs, "browser:tab_1", "panel", mainKeys, undefined);
    expect(ids(panel.surfaces)).toEqual(["browser:tab_1", "diff"]);
    expect(panel.activeSurfaceId).toBe("browser:tab_1");

    expect(windowPanelView("A", tabs, "diff", "main", mainKeys, undefined).activeSurfaceId).toBe(
      "git-graph",
    );
    expect(windowPanelView("A", tabs, null, "main", [], undefined)).toEqual({
      surfaces: [],
      activeSurfaceId: null,
    });
  });
});
