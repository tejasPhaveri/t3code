import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";

import { useBrowserShelfStore } from "./browser/browserShelfStore";
import { useBrowserHistoryStore } from "./browserHistoryStore";
import { useClosedViewStore } from "./closedViewStore";
import { useSourceControlLayoutStore } from "./components/gitGraph/sourceControlLayoutStore";
import { useComposerDraftStore } from "./composerDraftStore";
import { useDiffPanelStore } from "./diffPanelStore";
import { isElectron } from "./env";
import { readPanelWindowRole } from "./panelWindow";
import { useRememberedTerminalsStore } from "./rememberedTerminalsStore";
import { setRightPanelSurfaceOpenedListener, useRightPanelStore } from "./rightPanelStore";
import { placementKey, useSharedTabOrderStore } from "./sharedTabOrder";
import { readThreadShell } from "./state/entities";
import { useTerminalUiStateStore } from "./terminalUiStateStore";

const PANEL_STORES = [
  useRightPanelStore,
  useSharedTabOrderStore,
  useTerminalUiStateStore,
  useRememberedTerminalsStore,
  useSourceControlLayoutStore,
  useDiffPanelStore,
  useClosedViewStore,
  useBrowserShelfStore,
  useBrowserHistoryStore,
];

/**
 * The main window and the right panel's own window are two copies of the app over one
 * localStorage. A write in one fires `storage` in the other, which reloads that store, so a tab
 * opened beside the chat or reordered in the panel window shows in both. While the panel is split
 * across the two, a tab opens in the window it was opened from.
 */
export function installCrossWindowStoreSync(): () => void {
  if (!isElectron) return () => {};
  const storesByKey = new Map(
    PANEL_STORES.map((store) => [store.persist.getOptions().name, store] as const),
  );
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.storageArea !== window.localStorage) return;
    void storesByKey.get(event.key)?.persist.rehydrate();
  };
  window.addEventListener("storage", onStorage);
  setRightPanelSurfaceOpenedListener((ref, surface) => {
    const role = readPanelWindowRole();
    if (role === null) return;
    const projectId =
      readThreadShell(ref)?.projectId ??
      useComposerDraftStore.getState().getDraftThreadByRef(ref)?.projectId;
    if (projectId === undefined) return;
    useSharedTabOrderStore
      .getState()
      .place(
        scopedProjectKey(scopeProjectRef(ref.environmentId, projectId)),
        placementKey(ref.threadId, surface),
        role,
      );
  });
  return () => {
    window.removeEventListener("storage", onStorage);
    setRightPanelSurfaceOpenedListener(null);
  };
}
