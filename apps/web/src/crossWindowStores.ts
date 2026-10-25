import { useBrowserShelfStore } from "./browser/browserShelfStore";
import { useBrowserHistoryStore } from "./browserHistoryStore";
import { useClosedViewStore } from "./closedViewStore";
import { useSourceControlLayoutStore } from "./components/gitGraph/sourceControlLayoutStore";
import { useDiffPanelStore } from "./diffPanelStore";
import { isElectron } from "./env";
import { useRememberedTerminalsStore } from "./rememberedTerminalsStore";
import { useRightPanelStore } from "./rightPanelStore";
import { useSharedTabOrderStore } from "./sharedTabOrder";
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
 * opened beside the chat or reordered in the panel window shows in both.
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
  return () => window.removeEventListener("storage", onStorage);
}
