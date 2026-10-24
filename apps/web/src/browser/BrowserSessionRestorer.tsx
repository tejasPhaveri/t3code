import {
  scopeProjectRef,
  scopedProjectKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  type BrowserPersistence,
  type EnvironmentId,
  type PreviewListResult,
  ProjectId,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AtomRegistry } from "effect/reactivity";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { openPreviewSession } from "~/components/preview/openPreviewSession";
import {
  getClientSettings,
  useClientSettings,
  useClientSettingsHydrated,
} from "~/hooks/useSettings";
import { applyPreviewServerSnapshot, useActivePreviewSessions } from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  browserRestoreScopeKey,
  browserTabsToRestore,
  compareBrowserTabIds,
  readThreadProjectId,
  nextSavedBrowserScopes,
  savedBrowserTabsByScope,
  savedBrowserTabsInScope,
  type SavedBrowserTab,
  useProjectIdByThreadKey,
} from "./browserScope";
import { useBrowserShelfStore } from "./browserShelfStore";
import { activateBrowserTab } from "./browserTabActivation";

const RESTORE_RETRY_MS = 3_000;
const RESTORE_MAX_RETRIES = 20;
const EMPTY_TAB_IDS: readonly string[] = [];

/** Scopes whose saved tabs were reopened this run; from then on the live tabs are the truth. */
const useRestoredScopesStore = create<{ readonly scopeKeys: ReadonlySet<string> }>(() => ({
  scopeKeys: new Set(),
}));
const restoringScopeKeys = new Set<string>();
const useFocusedBrowserThreadStore = create<{ readonly threadRef: ScopedThreadRef | null }>(() => ({
  threadRef: null,
}));

function markScopeRestored(scopeKey: string): void {
  const { scopeKeys } = useRestoredScopesStore.getState();
  if (!scopeKeys.has(scopeKey)) {
    useRestoredScopesStore.setState({ scopeKeys: new Set([...scopeKeys, scopeKey]) });
  }
}

/** Mirrors every live tab into the saved shelf, in the focused chat's tab order. */
export function BrowserSessionRestorer() {
  const hydrated = useClientSettingsHydrated();
  const byThreadKey = useActivePreviewSessions();
  const projectIdByThreadKey = useProjectIdByThreadKey();
  const restoredScopeKeys = useRestoredScopesStore((state) => state.scopeKeys);
  const focusedThreadRef = useFocusedBrowserThreadStore((state) => state.threadRef);
  const panelSurfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, focusedThreadRef).surfaces,
  );

  useEffect(() => {
    if (!hydrated || !useBrowserShelfStore.persist.hasHydrated()) return;
    const panelOrder = panelSurfaces.flatMap((surface) =>
      surface.kind === "preview" && surface.resourceId ? [surface.resourceId] : EMPTY_TAB_IDS,
    );
    const live = savedBrowserTabsByScope({ byThreadKey, projectIdByThreadKey, panelOrder });
    const shelf = useBrowserShelfStore.getState();
    for (const scopeKey of Object.keys(live)) {
      if (shelf.scopes[scopeKey] === undefined) markScopeRestored(scopeKey);
    }
    const next = nextSavedBrowserScopes({ saved: shelf.scopes, live, restoredScopeKeys });
    if (JSON.stringify(next) !== JSON.stringify(shelf.scopes)) shelf.replace(next);
  }, [byThreadKey, hydrated, panelSurfaces, projectIdByThreadKey, restoredScopeKeys]);

  return null;
}

async function readScopeSessions(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: string | undefined;
  readonly persistence: BrowserPersistence;
}): Promise<PreviewListResult | null> {
  const atom = previewEnvironment.list({
    environmentId: input.environmentId,
    input: {
      threadId: input.threadId,
      persistence: input.persistence,
      ...(input.projectId === undefined ? {} : { projectId: ProjectId.make(input.projectId) }),
    },
  });
  appAtomRegistry.refresh(atom);
  const result = await Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, atom, { suspendOnWaiting: true }).pipe(
      Effect.timeout("15 seconds"),
      Effect.option,
    ),
  );
  return Option.getOrNull(result);
}

export function browserProjectSetupKey(environmentId: EnvironmentId, projectId: string): string {
  return scopedProjectKey(scopeProjectRef(environmentId, ProjectId.make(projectId)));
}

/**
 * Opens the given tabs in a scope unless an equal tab (same profile and page) is
 * already open there, in order and lazily. Resolves false when the scope's open
 * tabs could not be read, so nothing is opened twice.
 */
export async function openMissingBrowserTabs(input: {
  readonly openPreview: Parameters<typeof openPreviewSession>[0]["openPreview"];
  readonly threadRef: ScopedThreadRef;
  readonly projectId: string | undefined;
  readonly persistence: BrowserPersistence;
  readonly scopeKey: string;
  readonly tabs: readonly SavedBrowserTab[];
}): Promise<boolean> {
  const { threadRef, projectId, persistence } = input;
  const listed = await readScopeSessions({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    projectId,
    persistence,
  });
  if (!listed) return false;
  // After a window reload the server still has these; show them instead of reopening.
  for (const snapshot of listed.sessions) {
    applyPreviewServerSnapshot(
      scopeThreadRef(threadRef.environmentId, ThreadId.make(snapshot.threadId)),
      snapshot,
    );
  }
  const live = savedBrowserTabsInScope(listed.sessions, threadRef.environmentId, input.scopeKey);
  // Sequential, so tab ids (and with them the strip order) follow the given order.
  for (const tab of browserTabsToRestore(input.tabs, live)) {
    await openPreviewSession({
      openPreview: input.openPreview,
      threadRef,
      url: tab.url,
      lazy: true,
      persistence,
      ...(tab.title === undefined ? {} : { title: tab.title }),
      ...(tab.profileId === undefined ? {} : { profileId: tab.profileId }),
      ...(tab.viewport === undefined ? {} : { viewport: tab.viewport }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(tab.isolated ? { isolated: true } : {}),
    });
  }
  return true;
}

/**
 * Opens the pages a project is set up to open in one profile, then shows the first. Resolves
 * false when the chat's project has none for that profile, so the caller opens a blank tab.
 */
export async function openProfileProjectTabs(input: {
  readonly openPreview: Parameters<typeof openPreviewSession>[0]["openPreview"];
  readonly threadRef: ScopedThreadRef;
  readonly profileId: string;
}): Promise<boolean> {
  const { threadRef, profileId } = input;
  const projectId = readThreadProjectId(threadRef);
  if (projectId === undefined) return false;
  const settings = getClientSettings();
  const tabs = (
    settings.browserProjectSetups[browserProjectSetupKey(threadRef.environmentId, projectId)]
      ?.tabs ?? []
  ).filter((tab) => tab.profileId === profileId);
  const first = tabs[0];
  if (first === undefined) return false;
  const persistence = settings.browserPersistence;
  const opened = await openMissingBrowserTabs({
    openPreview: input.openPreview,
    threadRef,
    projectId,
    persistence,
    scopeKey: browserRestoreScopeKey({
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      projectId,
      persistence,
    }),
    tabs,
  });
  if (!opened) return false;
  const listed = await readScopeSessions({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    projectId,
    persistence,
  });
  const shown = listed?.sessions
    .toSorted((left, right) => compareBrowserTabIds(left.tabId, right.tabId))
    .find(
      (session) =>
        session.profileId === profileId &&
        session.navStatus._tag !== "Idle" &&
        session.navStatus.url === first.url,
    );
  if (shown) {
    useRightPanelStore.getState().openBrowser(threadRef, shown.tabId);
    activateBrowserTab(shown.tabId);
  }
  return true;
}

/**
 * Reopens the saved tabs of the chat's scope the first time it is shown this run.
 * Other projects stay on the shelf until visited, and every reopened tab is lazy:
 * its page loads only when the tab is first shown.
 */
export function useRestoreBrowserScope(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly projectId: string | undefined;
  readonly enabled: boolean;
}): void {
  const hydrated = useClientSettingsHydrated();
  const persistence = useClientSettings((settings) => settings.browserPersistence);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const [retryCount, setRetryCount] = useState(0);
  const { threadRef, projectId, enabled } = input;

  useEffect(() => {
    if (threadRef) useFocusedBrowserThreadStore.setState({ threadRef });
  }, [threadRef]);

  useEffect(() => {
    if (!enabled || !threadRef || !hydrated || !useBrowserShelfStore.persist.hasHydrated()) return;
    if (retryCount > RESTORE_MAX_RETRIES) return;
    const projectScopeKey = browserRestoreScopeKey({
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      projectId,
      persistence,
    });
    const scopeKeys = [
      ...new Set([
        projectScopeKey,
        browserRestoreScopeKey({
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
          isolated: true,
        }),
      ]),
    ];
    let retryTimer: number | null = null;
    for (const scopeKey of scopeKeys) {
      if (useRestoredScopesStore.getState().scopeKeys.has(scopeKey)) continue;
      if (restoringScopeKeys.has(scopeKey)) continue;
      const saved = useBrowserShelfStore.getState().scopes[scopeKey] ?? [];
      // A project with nothing saved from last run starts from its configured tabs.
      const setup =
        projectId !== undefined && scopeKey === projectScopeKey
          ? getClientSettings().browserProjectSetups[
              browserProjectSetupKey(threadRef.environmentId, projectId)
            ]
          : undefined;
      const planned = saved.length > 0 ? saved : setup?.openAutomatically ? setup.tabs : [];
      if (planned.length === 0) {
        markScopeRestored(scopeKey);
        continue;
      }
      restoringScopeKeys.add(scopeKey);
      // Finishes even if the chat changes: any chat in the scope owns its tabs equally.
      void openMissingBrowserTabs({
        openPreview,
        threadRef,
        projectId,
        persistence,
        scopeKey,
        tabs: planned,
      })
        .then((opened) => {
          if (opened) {
            markScopeRestored(scopeKey);
            return;
          }
          if (retryTimer !== null) return;
          retryTimer = window.setTimeout(
            () => setRetryCount((count) => count + 1),
            RESTORE_RETRY_MS,
          );
        })
        .finally(() => restoringScopeKeys.delete(scopeKey));
    }
    return () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [enabled, hydrated, openPreview, persistence, projectId, retryCount, threadRef]);
}
