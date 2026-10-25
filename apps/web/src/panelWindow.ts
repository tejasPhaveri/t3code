import { useSyncExternalStore } from "react";

import { isElectron } from "./env";

/**
 * The desktop shell can move the right panel into a window of its own, which loads this same app
 * with `?t3window=panel`. Hash routing never touches the query, so it holds across navigation.
 */
export const isPanelWindow =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("t3window") === "panel";

function panelWindowBridge() {
  return isElectron ? (window.desktopBridge?.panelWindow ?? null) : null;
}

/** Older desktop shells, and the browser, cannot give the panel its own window. */
export function canDetachRightPanel(): boolean {
  return panelWindowBridge() !== null;
}

const listeners = new Set<() => void>();
// Read before the first render: a main window that drew its browser pages before learning the
// panel window has them would release those tabs just as the panel window claims them.
let panelWindowOpen = panelWindowBridge()?.isOpen() ?? false;
let stopListening: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const bridge = panelWindowBridge();
  if (listeners.size === 1 && bridge) {
    stopListening = bridge.onOpenChange((open) => {
      panelWindowOpen = open;
      for (const notify of listeners) notify();
    });
    // The window may have opened or closed before this subscription.
    panelWindowOpen = bridge.isOpen();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopListening?.();
    stopListening = null;
  };
}

function readPanelWindowOpen(): boolean {
  return panelWindowOpen;
}

/** True in the main window while the right panel lives in its own window. */
export function useRightPanelDetached(): boolean {
  const open = useSyncExternalStore(subscribe, readPanelWindowOpen);
  return !isPanelWindow && open;
}

export function setRightPanelDetached(detached: boolean): void {
  void panelWindowBridge()?.setOpen(detached);
}
