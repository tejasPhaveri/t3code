import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";

import type { ThreadPreviewState } from "~/previewStateStore";

import {
  browserRestoreScopeKey,
  browserTabsToRestore,
  locatePreviewSession,
  nextSavedBrowserScopes,
  previewOpenScope,
  savedBrowserTabsByScope,
  sharedPreviewIndex,
} from "./browserScope";

const emptyState = (sessions: ThreadPreviewState["sessions"]): ThreadPreviewState => ({
  snapshot: null,
  sessions,
  suppressedTabIds: new Set(),
  activeTabId: null,
  desktopOverlay: null,
  desktopByTabId: {},
  recentlySeenUrls: [],
  listLoaded: true,
  serverEpoch: "epoch",
  serverRevision: 1,
});

const session = {
  threadId: "thread-a",
  tabId: "tab-1",
  navStatus: { _tag: "Success" as const, url: "https://example.com/", title: "Example" },
  canGoBack: false,
  canGoForward: false,
  projectId: "project-1" as ThreadPreviewState["sessions"][string]["projectId"],
  persistence: "project" as const,
  updatedAt: "2026-10-22T00:00:00.000Z",
};

describe("sharedPreviewIndex", () => {
  const byThreadKey = {
    "env:thread-a": emptyState({ "tab-1": session }),
  };

  it("references a project tab from another chat", () => {
    const index = sharedPreviewIndex({
      persistence: "project",
      environmentId: "env",
      threadId: "thread-b",
      projectId: "project-1",
      byThreadKey,
      projectIdByThreadKey: new Map(),
    });

    expect(index.tabIds).toEqual(["tab-1"]);
  });

  it("hides that tab from a different project", () => {
    const index = sharedPreviewIndex({
      persistence: "project",
      environmentId: "env",
      threadId: "thread-b",
      projectId: "project-2",
      byThreadKey,
      projectIdByThreadKey: new Map(),
    });

    expect(index.tabIds).toEqual([]);
  });
});

describe("locatePreviewSession", () => {
  it("returns the chat that owns the tab", () => {
    const located = locatePreviewSession(
      { "env:thread-a": emptyState({ "tab-1": session }) },
      "env",
      "tab-1",
    );

    expect(located?.owner.threadId).toBe(ThreadId.make("thread-a"));
    expect(located?.snapshot.tabId).toBe("tab-1");
  });
});

describe("browserTabsToRestore", () => {
  it("reopens only the saved tabs not already live, counting duplicates", () => {
    const owner = { url: "https://staging.example.com/", profileId: "owner" };
    const client = { url: "https://staging.example.com/", profileId: "client" };

    expect(browserTabsToRestore([owner, client, owner], [owner])).toEqual([client, owner]);
    expect(browserTabsToRestore([owner, client], [client, owner])).toEqual([]);
  });
});

describe("savedBrowserTabsByScope", () => {
  const tab = (tabId: string, url: string, profileId: string) => ({
    ...session,
    tabId,
    profileId,
    navStatus: { _tag: "Success" as const, url, title: "" },
  });

  it("groups a project's tabs from every chat once, in open order", () => {
    const scopes = savedBrowserTabsByScope({
      byThreadKey: {
        "env:thread-a": emptyState({
          tab_b: tab("tab_b", "https://dev.example.com/", "owner"),
          tab_2: tab("tab_2", "https://staging.example.com/", "owner"),
        }),
        "env:thread-b": emptyState({
          tab_2: tab("tab_2", "https://staging.example.com/", "owner"),
        }),
      },
      projectIdByThreadKey: new Map(),
    });

    expect(
      scopes[
        browserRestoreScopeKey({
          environmentId: "env",
          threadId: "thread-a",
          projectId: "project-1",
          persistence: "project",
        })
      ],
    ).toEqual([
      { url: "https://staging.example.com/", profileId: "owner" },
      { url: "https://dev.example.com/", profileId: "owner" },
    ]);
  });

  it("follows the focused chat's tab strip order", () => {
    const scopes = savedBrowserTabsByScope({
      byThreadKey: {
        "env:thread-a": emptyState({
          tab_1: tab("tab_1", "https://staging.example.com/", "owner"),
          tab_2: tab("tab_2", "https://dev.example.com/", "owner"),
        }),
      },
      projectIdByThreadKey: new Map(),
      panelOrder: ["tab_2", "tab_1"],
    });

    expect(Object.values(scopes)[0]?.map((saved) => saved.url)).toEqual([
      "https://dev.example.com/",
      "https://staging.example.com/",
    ]);
  });

  it("skips blank tabs and keeps an isolated tab with its chat", () => {
    const scopes = savedBrowserTabsByScope({
      byThreadKey: {
        "env:thread-a": emptyState({
          tab_1: { ...session, tabId: "tab_1", navStatus: { _tag: "Idle" as const } },
          tab_2: { ...tab("tab_2", "https://dev.example.com/", "owner"), isolated: true },
        }),
      },
      projectIdByThreadKey: new Map(),
    });

    expect(scopes).toEqual({
      [browserRestoreScopeKey({ environmentId: "env", threadId: "thread-a", isolated: true })]: [
        { url: "https://dev.example.com/", profileId: "owner", isolated: true },
      ],
    });
  });
});

describe("nextSavedBrowserScopes", () => {
  const staging = { url: "https://staging.example.com/" };
  const dev = { url: "https://dev.example.com/" };

  it("keeps a project's saved tabs until it is restored, adding tabs opened meanwhile", () => {
    expect(
      nextSavedBrowserScopes({
        saved: { project: [staging] },
        live: { project: [dev] },
        restoredScopeKeys: new Set(),
      }),
    ).toEqual({ project: [staging, dev] });
    expect(
      nextSavedBrowserScopes({
        saved: { project: [staging] },
        live: {},
        restoredScopeKeys: new Set(),
      }),
    ).toEqual({ project: [staging] });
  });

  it("mirrors a restored project exactly, so closing every tab is saved", () => {
    expect(
      nextSavedBrowserScopes({
        saved: { project: [staging, dev] },
        live: {},
        restoredScopeKeys: new Set(["project"]),
      }),
    ).toEqual({});
  });
});

describe("previewOpenScope", () => {
  it("gives a tab opened in a draft chat that chat's project", () => {
    const environmentId = EnvironmentId.make("env");
    const threadId = ThreadId.make("draft-thread");
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(
        scopeProjectRef(environmentId, ProjectId.make("project-1")),
        DraftId.make("draft-1"),
        { threadId },
      );
    onTestFinished(() => {
      useComposerDraftStore.setState({
        draftThreadsByThreadKey: {},
        logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      });
    });

    const scope = previewOpenScope({
      persistence: "project",
      threadRef: scopeThreadRef(environmentId, threadId),
    });

    expect(scope.projectId).toBe("project-1");
  });
});
