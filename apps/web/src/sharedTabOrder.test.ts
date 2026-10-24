import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface } from "./rightPanelStore";
import {
  applySharedTabOrder,
  carryActiveSharedTab,
  includeSharedTabs,
  recordSharedTabOrder,
  sharedSurfaceKey,
  takeCarriedActiveTab,
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

  it("opens a new chat on the tab the chat it came from was showing", () => {
    // Chat A was showing its own terminal; the new chat B sees it by reference.
    carryActiveSharedTab("env:B", sharedSurfaceKey("A", ownTerminal("t1"))!);

    expect(takeCarriedActiveTab("env:B", "B", [diff])).toBeNull();
    expect(takeCarriedActiveTab("env:B", "B", [browser("tab_1"), sharedTerminal("A", "t1")])).toBe(
      "terminal:A:t1",
    );
    expect(takeCarriedActiveTab("env:B", "B", [sharedTerminal("A", "t1")])).toBeNull();
  });
});
