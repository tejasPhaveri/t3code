import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { create } from "zustand";

/** Lazy tabs shown at least once this run. A page, once created, stays alive. */
const useActivatedBrowserTabsStore = create<{ readonly tabIds: ReadonlySet<string> }>(() => ({
  tabIds: new Set(),
}));

export function activateBrowserTab(tabId: string): void {
  const { tabIds } = useActivatedBrowserTabsStore.getState();
  if (tabIds.has(tabId)) return;
  useActivatedBrowserTabsStore.setState({ tabIds: new Set([...tabIds, tabId]) });
}

export function readActivatedBrowserTabs(): ReadonlySet<string> {
  return useActivatedBrowserTabsStore.getState().tabIds;
}

export function useActivatedBrowserTabs(): ReadonlySet<string> {
  return useActivatedBrowserTabsStore((state) => state.tabIds);
}

export function browserTabNeedsPage(
  snapshot: Pick<PreviewSessionSnapshot, "tabId" | "lazy">,
  activated: ReadonlySet<string>,
): boolean {
  return snapshot.lazy !== true || activated.has(snapshot.tabId);
}
