import type { EnvironmentId } from "@t3tools/contracts";

import { previewBridge } from "~/components/preview/previewBridge";
import { readActivePreviewSessions } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";

import { locatePreviewSession } from "./browserScope";
import {
  activateBrowserTab,
  browserTabNeedsPage,
  readActivatedBrowserTabs,
} from "./browserTabActivation";
import { previewRuntimeTabId } from "./previewRuntimeTabId";
import { rendersServerTabNatively } from "./previewRuntime";

/** Only the desktop app hosts the pages itself; elsewhere each tab's own view reloads it. */
export const canReloadBrowserTabs = previewBridge !== null;

/**
 * Reloads every page these tabs have, e.g. after a restart left them on an error because
 * their dev servers were not up yet, and loads the restored tabs that have no page yet.
 * Returns how many tabs it reloaded or started loading.
 */
export function reloadBrowserTabs(environmentId: EnvironmentId, tabIds: readonly string[]): number {
  if (!previewBridge) return 0;
  const sessions = readActivePreviewSessions();
  const activated = readActivatedBrowserTabs();
  const primaryEnvironmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
  let count = 0;
  for (const tabId of tabIds) {
    const located = locatePreviewSession(sessions, environmentId, tabId);
    if (!located) continue;
    // A remote server tab streams from that server; only its own view can reload it.
    if (
      located.snapshot.runtime === "server" &&
      !rendersServerTabNatively(environmentId, primaryEnvironmentId, located.snapshot)
    ) {
      continue;
    }
    if (browserTabNeedsPage(located.snapshot, activated)) {
      void previewBridge
        .refresh(previewRuntimeTabId(located.owner, located.serverEpoch, tabId))
        .catch(() => undefined);
    } else {
      // The browser host creates the page, which loads the tab's saved URL.
      activateBrowserTab(tabId);
    }
    count += 1;
  }
  return count;
}
