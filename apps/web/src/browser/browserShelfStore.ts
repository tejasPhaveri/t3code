import type { PreviewViewportSetting } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

import { browserRestoreScopeKey, type SavedBrowserTab } from "./browserScope";

interface BrowserShelfState {
  /** Saved tabs per restore scope, in tab strip order. */
  readonly scopes: Readonly<Record<string, readonly SavedBrowserTab[]>>;
  readonly replace: (scopes: Readonly<Record<string, readonly SavedBrowserTab[]>>) => void;
}

interface ShelfTabV1 {
  readonly environmentId: string;
  readonly ownerThreadId: string;
  readonly projectId?: string;
  readonly profileId?: string;
  readonly url: string;
  readonly isolated: boolean;
  readonly viewport?: PreviewViewportSetting;
}

function migrateV1(tabs: readonly ShelfTabV1[]): BrowserShelfState["scopes"] {
  const scopes: Record<string, SavedBrowserTab[]> = {};
  for (const tab of tabs) {
    const scopeKey = browserRestoreScopeKey({
      environmentId: tab.environmentId,
      threadId: tab.ownerThreadId,
      projectId: tab.projectId,
      persistence: "project",
      isolated: tab.isolated,
    });
    (scopes[scopeKey] ??= []).push({
      url: tab.url,
      ...(tab.profileId === undefined ? {} : { profileId: tab.profileId }),
      ...(tab.isolated ? { isolated: true as const } : {}),
      ...(tab.viewport === undefined ? {} : { viewport: tab.viewport }),
    });
  }
  return scopes;
}

export const useBrowserShelfStore = create<BrowserShelfState>()(
  persist(
    (set) => ({
      scopes: {},
      replace: (scopes) => set({ scopes }),
    }),
    {
      name: "t3code:browser-shelf:v1",
      version: 2,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ scopes: state.scopes }),
      migrate: (persisted, version) => {
        if (version < 2) {
          const tabs = (persisted as { tabs?: readonly ShelfTabV1[] } | null)?.tabs ?? [];
          return { scopes: migrateV1(tabs) };
        }
        return persisted as Pick<BrowserShelfState, "scopes">;
      },
    },
  ),
);
