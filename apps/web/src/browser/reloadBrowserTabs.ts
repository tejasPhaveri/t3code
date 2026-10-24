import type { EnvironmentId } from "@t3tools/contracts";

import { previewBridge } from "~/components/preview/previewBridge";
import { readActivePreviewSessions } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";

import { locatePreviewSession } from "./browserScope";
import { browserTabNeedsPage, readActivatedBrowserTabs } from "./browserTabActivation";
import { previewRuntimeTabId } from "./previewRuntimeTabId";
import { rendersServerTabNatively } from "./previewRuntime";

/** Only the desktop app hosts the pages itself; elsewhere each tab's own view reloads it. */
export const canReloadBrowserTabs = previewBridge !== null;

/**
 * Reloads every page these tabs have loaded in this window, e.g. after a restart left them
 * on an error because their dev servers were not up yet. A restored tab that has not been
 * shown has no page; it loads fresh when shown. Returns how many pages were reloaded.
 */
export function reloadBrowserTabs(environmentId: EnvironmentId, tabIds: readonly string[]): number {
  if (!previewBridge) return 0;
  const sessions = readActivePreviewSessions();
  const activated = readActivatedBrowserTabs();
  const primaryEnvironmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
  let reloaded = 0;
  for (const tabId of tabIds) {
    const located = locatePreviewSession(sessions, environmentId, tabId);
    if (!located || !browserTabNeedsPage(located.snapshot, activated)) continue;
    // A remote server tab streams from that server; only its own view can reload it.
    if (
      located.snapshot.runtime === "server" &&
      !rendersServerTabNatively(environmentId, primaryEnvironmentId, located.snapshot)
    ) {
      continue;
    }
    void previewBridge
      .refresh(previewRuntimeTabId(located.owner, located.serverEpoch, tabId))
      .catch(() => undefined);
    reloaded += 1;
  }
  return reloaded;
}
