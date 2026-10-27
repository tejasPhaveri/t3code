import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  type BrowserPersistence,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
  type PreviewZoomFactor,
  ProjectId,
  type ScopedThreadRef,
  ThreadId,
  previewSessionVisibleTo,
} from "@t3tools/contracts";

import type { DesktopPreviewOverlay, ThreadPreviewState } from "~/previewStateStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { readThreadShell, useThreadShells } from "~/state/entities";

export interface LocatedPreviewSession {
  readonly owner: ScopedThreadRef;
  readonly snapshot: PreviewSessionSnapshot;
  readonly serverEpoch: string | null;
  readonly desktop: DesktopPreviewOverlay | null;
}

export function locatePreviewSession(
  byThreadKey: Readonly<Record<string, ThreadPreviewState>>,
  environmentId: string,
  tabId: string,
): LocatedPreviewSession | null {
  let fallback: LocatedPreviewSession | null = null;
  for (const [threadKey, state] of Object.entries(byThreadKey)) {
    const ref = parseScopedThreadKey(threadKey);
    const snapshot = state.sessions[tabId];
    if (!ref || ref.environmentId !== environmentId || !snapshot) continue;
    const located: LocatedPreviewSession = {
      owner: ref,
      snapshot,
      serverEpoch: state.serverEpoch,
      desktop: state.desktopByTabId[tabId] ?? null,
    };
    if (snapshot.threadId === ref.threadId) return located;
    fallback ??= located;
  }
  return fallback;
}

export interface SharedPreviewIndex {
  readonly tabIds: readonly string[];
  readonly sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
}

/**
 * Tabs other chats in this scope already own. The caller references them;
 * it does not copy the browser session into this chat.
 */
export function sharedPreviewIndex(input: {
  readonly persistence: BrowserPersistence;
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectId: string | undefined;
  readonly byThreadKey: Readonly<Record<string, ThreadPreviewState>>;
  readonly projectIdByThreadKey: ReadonlyMap<string, string>;
}): SharedPreviewIndex {
  const tabIds: string[] = [];
  const sessions: Record<string, PreviewSessionSnapshot> = {};
  const desktopByTabId: Record<string, DesktopPreviewOverlay> = {};
  for (const [threadKey, state] of Object.entries(input.byThreadKey)) {
    const ref = parseScopedThreadKey(threadKey);
    if (!ref || ref.environmentId !== input.environmentId) continue;
    for (const snapshot of Object.values(state.sessions)) {
      if (snapshot.runtime === "server" && snapshot.reveal === false) continue;
      const ownerKey = scopedThreadKey(
        scopeThreadRef(ref.environmentId, ThreadId.make(snapshot.threadId)),
      );
      const projectId = snapshot.projectId ?? input.projectIdByThreadKey.get(ownerKey);
      if (
        !previewSessionVisibleTo(
          {
            threadId: snapshot.threadId,
            ...(projectId === undefined ? {} : { projectId }),
            ...(snapshot.persistence === undefined ? {} : { persistence: snapshot.persistence }),
            ...(snapshot.isolated === undefined ? {} : { isolated: snapshot.isolated }),
          },
          {
            threadId: input.threadId,
            ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
            persistence: input.persistence,
          },
        )
      ) {
        continue;
      }
      if (sessions[snapshot.tabId]) continue;
      sessions[snapshot.tabId] = snapshot;
      tabIds.push(snapshot.tabId);
      const desktop = state.desktopByTabId[snapshot.tabId];
      if (desktop) desktopByTabId[snapshot.tabId] = desktop;
    }
  }
  return { tabIds: tabIds.toSorted(compareBrowserTabIds), sessions, desktopByTabId };
}

/** Every chat's project, drafts included, keyed like `scopedThreadKey`. */
export function useProjectIdByThreadKey(): ReadonlyMap<string, string> {
  const shells = useThreadShells();
  const drafts = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const projectIdByThreadKey = new Map<string, string>();
  for (const draft of Object.values(drafts)) {
    projectIdByThreadKey.set(
      scopedThreadKey(scopeThreadRef(draft.environmentId, draft.threadId)),
      draft.projectId,
    );
  }
  for (const shell of shells) {
    projectIdByThreadKey.set(
      scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)),
      shell.projectId,
    );
  }
  return projectIdByThreadKey;
}

/** A chat is a draft until its first message, with no server shell yet; its project is on the draft. */
export function readThreadProjectId(threadRef: ScopedThreadRef): string | undefined {
  return (
    readThreadShell(threadRef)?.projectId ??
    useComposerDraftStore.getState().getDraftThreadByRef(threadRef)?.projectId
  );
}

export function previewOpenScope(input: {
  readonly persistence: BrowserPersistence;
  readonly threadRef: ScopedThreadRef;
  readonly projectId?: string | undefined;
  readonly isolated?: boolean | undefined;
}): {
  readonly persistence: BrowserPersistence;
  readonly projectId?: PreviewSessionSnapshot["projectId"];
  readonly isolated?: true;
} {
  const projectId = input.projectId ?? readThreadProjectId(input.threadRef);
  return {
    persistence: input.persistence,
    ...(projectId === undefined ? {} : { projectId: ProjectId.make(projectId) }),
    ...(input.isolated ? { isolated: true } : {}),
  };
}

/** A tab as saved between runs: what reopening it needs, and the id it had. */
export interface SavedBrowserTab {
  readonly url: string;
  readonly title?: string;
  readonly profileId?: string;
  readonly isolated?: true;
  readonly viewport?: PreviewViewportSetting;
  /** A zoom picked for this tab; without one it follows the default zoom. */
  readonly zoomFactor?: PreviewZoomFactor;
  /** Its id when saved. Ids do not outlive a server, so the reopened tab takes over this one's place. */
  readonly tabId?: string;
}

/**
 * Where a tab is restored, matching who can see it: its project, the whole
 * environment, or (for per-chat and isolated tabs) the chat that opened it.
 */
export function browserRestoreScopeKey(input: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectId?: string | undefined;
  readonly persistence?: BrowserPersistence | undefined;
  readonly isolated?: boolean | undefined;
}): string {
  const threadScope = JSON.stringify(["thread", input.environmentId, input.threadId]);
  if (input.isolated === true) return threadScope;
  const persistence = input.persistence ?? "thread";
  switch (persistence) {
    case "thread":
      return threadScope;
    case "project":
      return input.projectId === undefined
        ? threadScope
        : JSON.stringify(["project", input.environmentId, input.projectId]);
    case "environment":
      return JSON.stringify(["environment", input.environmentId]);
    default: {
      const _exhaustive: never = persistence;
      return _exhaustive;
    }
  }
}

/** Tab ids come from a per-server counter, so this is the order tabs were opened in. */
export function compareBrowserTabIds(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

function savedBrowserTabOf(snapshot: PreviewSessionSnapshot): SavedBrowserTab | null {
  if (snapshot.runtime === "server" && snapshot.reveal === false) return null;
  if (snapshot.navStatus._tag === "Idle" || !/^https?:/i.test(snapshot.navStatus.url)) return null;
  const title = snapshot.navStatus.title.trim();
  return {
    url: snapshot.navStatus.url,
    ...(title.length === 0 ? {} : { title }),
    ...(snapshot.profileId === undefined ? {} : { profileId: snapshot.profileId }),
    ...(snapshot.isolated === true ? { isolated: true as const } : {}),
    ...(snapshot.viewport === undefined ? {} : { viewport: snapshot.viewport }),
    ...(snapshot.zoomFactor === undefined ? {} : { zoomFactor: snapshot.zoomFactor }),
    tabId: snapshot.tabId,
  };
}

/**
 * The live tabs of every scope, in open order. `panelOrder` (the focused chat's
 * tab strip) wins for the tabs it shows, so a reordered strip reopens as arranged.
 */
export function savedBrowserTabsByScope(input: {
  readonly byThreadKey: Readonly<Record<string, ThreadPreviewState>>;
  readonly projectIdByThreadKey: ReadonlyMap<string, string>;
  readonly panelOrder?: readonly string[];
}): Record<string, SavedBrowserTab[]> {
  const entries = new Map<string, { scopeKey: string; tab: SavedBrowserTab }>();
  for (const [threadKey, state] of Object.entries(input.byThreadKey)) {
    const ref = parseScopedThreadKey(threadKey);
    if (!ref) continue;
    for (const snapshot of Object.values(state.sessions)) {
      if (entries.has(snapshot.tabId)) continue;
      const tab = savedBrowserTabOf(snapshot);
      if (!tab) continue;
      const projectId =
        snapshot.projectId ??
        input.projectIdByThreadKey.get(
          scopedThreadKey(scopeThreadRef(ref.environmentId, ThreadId.make(snapshot.threadId))),
        );
      entries.set(snapshot.tabId, {
        scopeKey: browserRestoreScopeKey({
          environmentId: ref.environmentId,
          threadId: snapshot.threadId,
          projectId,
          persistence: snapshot.persistence,
          isolated: snapshot.isolated,
        }),
        tab,
      });
    }
  }
  const panelIndex = new Map((input.panelOrder ?? []).map((tabId, index) => [tabId, index]));
  const ordered = [...entries.keys()].toSorted((left, right) => {
    const leftPanel = panelIndex.get(left);
    const rightPanel = panelIndex.get(right);
    if (leftPanel !== undefined && rightPanel !== undefined) return leftPanel - rightPanel;
    if (leftPanel !== undefined) return -1;
    if (rightPanel !== undefined) return 1;
    return compareBrowserTabIds(left, right);
  });
  const scopes: Record<string, SavedBrowserTab[]> = {};
  for (const tabId of ordered) {
    const { scopeKey, tab } = entries.get(tabId)!;
    (scopes[scopeKey] ??= []).push(tab);
  }
  return scopes;
}

export function savedBrowserTabsInScope(
  sessions: readonly PreviewSessionSnapshot[],
  environmentId: string,
  scopeKey: string,
): SavedBrowserTab[] {
  return sessions
    .toSorted((left, right) => compareBrowserTabIds(left.tabId, right.tabId))
    .filter(
      (snapshot) =>
        browserRestoreScopeKey({
          environmentId,
          threadId: snapshot.threadId,
          projectId: snapshot.projectId,
          persistence: snapshot.persistence,
          isolated: snapshot.isolated,
        }) === scopeKey,
    )
    .flatMap((snapshot) => {
      const tab = savedBrowserTabOf(snapshot);
      return tab ? [tab] : [];
    });
}

const savedTabIdentity = (tab: SavedBrowserTab) =>
  JSON.stringify([tab.profileId ?? "", tab.url, tab.isolated === true]);

/** Saved tabs not already open. Counted, so two saved copies of one page need two live ones. */
export function browserTabsToRestore(
  saved: readonly SavedBrowserTab[],
  live: readonly SavedBrowserTab[],
): SavedBrowserTab[] {
  const liveCounts = new Map<string, number>();
  for (const tab of live) {
    const key = savedTabIdentity(tab);
    liveCounts.set(key, (liveCounts.get(key) ?? 0) + 1);
  }
  return saved.filter((tab) => {
    const key = savedTabIdentity(tab);
    const remaining = liveCounts.get(key) ?? 0;
    if (remaining === 0) return true;
    liveCounts.set(key, remaining - 1);
    return false;
  });
}

/**
 * The next saved state. A scope restored this run (or with nothing saved) is
 * mirrored exactly, so closing its last tab saves that. A scope not yet restored
 * keeps its saved tabs and gains any opened meanwhile, so nothing is lost before
 * the project is visited.
 */
export function nextSavedBrowserScopes(input: {
  readonly saved: Readonly<Record<string, readonly SavedBrowserTab[]>>;
  readonly live: Readonly<Record<string, readonly SavedBrowserTab[]>>;
  readonly restoredScopeKeys: ReadonlySet<string>;
}): Record<string, readonly SavedBrowserTab[]> {
  const next: Record<string, readonly SavedBrowserTab[]> = {};
  for (const scopeKey of new Set([...Object.keys(input.saved), ...Object.keys(input.live)])) {
    const saved = input.saved[scopeKey];
    const live = input.live[scopeKey] ?? [];
    if (saved === undefined || input.restoredScopeKeys.has(scopeKey)) {
      if (live.length > 0) next[scopeKey] = live;
      continue;
    }
    next[scopeKey] = [...saved, ...browserTabsToRestore(live, saved)];
  }
  return next;
}
