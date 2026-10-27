import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveSharedWindowStorage } from "~/lib/storage";

import type { RightPanelSurface } from "./rightPanelStore";

/** Old tabs fall off the end, so closed terminals and browser tabs cannot grow it forever. */
const MAX_ORDER_LENGTH = 300;

/**
 * Identity of a tab every chat in the project shows, the same in each chat; null for a
 * chat's own tabs. A terminal is shown in its owner by plain id and elsewhere by reference.
 */
export function sharedSurfaceKey(threadId: string, surface: RightPanelSurface): string | null {
  switch (surface.kind) {
    case "preview":
      return surface.resourceId === null ? null : surface.id;
    case "git-graph":
      return surface.id;
    case "terminal":
      return `terminal:${surface.ownerThreadId ?? threadId}:${surface.resourceId}`;
    default:
      return null;
  }
}

/**
 * Sorts a chat's shared tabs into the project order. They only trade places among
 * themselves, so the chat's own tabs keep their slots; tabs the order does not know
 * yet stay after the known ones in their current order.
 */
export function applySharedTabOrder(
  threadId: string,
  surfaces: readonly RightPanelSurface[],
  order: readonly string[],
): readonly RightPanelSurface[] {
  const rank = new Map(order.map((key, index) => [key, index]));
  const rankOf = (surface: RightPanelSurface) => {
    const key = sharedSurfaceKey(threadId, surface);
    return key === null ? null : (rank.get(key) ?? Number.POSITIVE_INFINITY);
  };
  const shared = surfaces.filter((surface) => rankOf(surface) !== null);
  const sorted = shared.toSorted((left, right) => rankOf(left)! - rankOf(right)!);
  if (sorted.every((surface, index) => surface === shared[index])) return surfaces;
  let next = 0;
  return surfaces.map((surface) => (rankOf(surface) === null ? surface : sorted[next++]!));
}

/** The project order after a chat rearranged its shared tabs: its order first, then the rest. */
export function recordSharedTabOrder(
  order: readonly string[],
  threadId: string,
  surfaces: readonly RightPanelSurface[],
): string[] {
  const keys = surfaces.flatMap((surface) => sharedSurfaceKey(threadId, surface) ?? []);
  const present = new Set(keys);
  return [...keys, ...order.filter((key) => !present.has(key))].slice(0, MAX_ORDER_LENGTH);
}

/** Appends shared tabs the project order has not seen, so chats agree before anyone drags. */
export function includeSharedTabs(
  order: readonly string[],
  threadId: string,
  surfaces: readonly RightPanelSurface[],
): readonly string[] {
  const known = new Set(order);
  const added = surfaces.flatMap((surface) => {
    const key = sharedSurfaceKey(threadId, surface);
    return key === null || known.has(key) ? [] : [key];
  });
  return added.length === 0 ? order : [...order, ...added].slice(-MAX_ORDER_LENGTH);
}

/**
 * The tab a chat should switch to so it shows the project's selected tab, or null when it
 * already does, does not have that tab yet, or is showing one of its own tabs. A chat with
 * no tab selected takes its first until the project's arrives, rather than show none.
 */
export function followSharedActiveTab(
  threadId: string,
  surfaces: readonly RightPanelSurface[],
  activeSurfaceId: string | null,
  activeKey: string | undefined,
): string | null {
  const active = surfaces.find((surface) => surface.id === activeSurfaceId);
  if (active && sharedSurfaceKey(threadId, active) === null) return null;
  const target =
    (activeKey === undefined
      ? undefined
      : surfaces.find((surface) => sharedSurfaceKey(threadId, surface) === activeKey)) ??
    (active ? undefined : surfaces[0]);
  return target === undefined || target === active ? null : target.id;
}

/** With the panel in its own window, the main window can keep some tabs beside the chat. */
export type PanelWindowRole = "main" | "panel";

/** A tab's identity for where it is shown: the same tab in every chat of the project. */
export function placementKey(threadId: string, surface: RightPanelSurface): string {
  return sharedSurfaceKey(threadId, surface) ?? surface.id;
}

type BrowserTabKeys = Pick<
  SharedTabOrderStoreState,
  "byProjectKey" | "activeByProjectKey" | "mainWindowByProjectKey" | "shownByWindowKey"
>;

/**
 * The keys once saved browser tabs reopened under new ids, or `state` itself when none of the old
 * ids appear. Ids come from a per-server counter, so without this a restart loses each browser
 * tab's place in the order, selection and window. A new id the order already picked up while the
 * tabs reopened gives way to the old id's place.
 */
export function renameBrowserTabKeys(
  state: BrowserTabKeys,
  renamedTabIds: ReadonlyMap<string, string>,
): BrowserTabKeys {
  const renamed = new Map<string, string>(
    [...renamedTabIds].map(([from, to]) => [`browser:${from}`, `browser:${to}`]),
  );
  let changed = false;
  const rename = (key: string) => {
    const next = renamed.get(key);
    if (next === undefined) return key;
    changed = true;
    return next;
  };
  const renameLists = (byKey: Readonly<Record<string, readonly string[]>>) =>
    Object.fromEntries(
      Object.entries(byKey).map(([key, keys]) => [key, [...new Set(keys.map(rename))]]),
    );
  const renameValues = (byKey: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(byKey).map(([key, value]) => [key, rename(value)]));
  const next = {
    byProjectKey: renameLists(state.byProjectKey),
    activeByProjectKey: renameValues(state.activeByProjectKey),
    mainWindowByProjectKey: renameLists(state.mainWindowByProjectKey),
    shownByWindowKey: renameValues(state.shownByWindowKey),
  };
  return changed ? next : state;
}

/**
 * The tabs one window shows of a chat whose panel is split across two windows, and the one it
 * has selected: the chat's selection when that tab is here, else the tab this window showed
 * last, else its first.
 */
export function windowPanelView(
  threadId: string,
  surfaces: readonly RightPanelSurface[],
  activeSurfaceId: string | null,
  role: PanelWindowRole,
  mainWindowKeys: readonly string[],
  shownKey: string | undefined,
): { surfaces: RightPanelSurface[]; activeSurfaceId: string | null } {
  const inMain = new Set(mainWindowKeys);
  const shown = surfaces.filter(
    (surface) => inMain.has(placementKey(threadId, surface)) === (role === "main"),
  );
  const active =
    shown.find((surface) => surface.id === activeSurfaceId) ??
    shown.find((surface) => placementKey(threadId, surface) === shownKey) ??
    shown[0];
  return { surfaces: shown, activeSurfaceId: active?.id ?? null };
}

interface SharedTabOrderStoreState {
  readonly byProjectKey: Readonly<Record<string, readonly string[]>>;
  /** The shared tab selected in the project, so every chat in it shows the same one. */
  readonly activeByProjectKey: Readonly<Record<string, string>>;
  readonly record: (
    projectKey: string,
    threadId: string,
    surfaces: readonly RightPanelSurface[],
  ) => void;
  readonly include: (
    projectKey: string,
    threadId: string,
    surfaces: readonly RightPanelSurface[],
  ) => void;
  readonly setActive: (projectKey: string, key: string) => void;
  /** Tabs the main window keeps while the panel has its own window; the rest go there. */
  readonly mainWindowByProjectKey: Readonly<Record<string, readonly string[]>>;
  /** The tab each window last showed, by `${role}:${projectKey}`. */
  readonly shownByWindowKey: Readonly<Record<string, string>>;
  readonly place: (projectKey: string, key: string, role: PanelWindowRole) => void;
  readonly setShown: (role: PanelWindowRole, projectKey: string, key: string) => void;
  /** Old browser tab id to new, for tabs reopened after a restart. */
  readonly renameBrowserTabs: (renamedTabIds: ReadonlyMap<string, string>) => void;
}

/**
 * Browser tabs this window renamed after reopening them. The other window can save its copy from
 * before the rename over it a moment later; whenever old ids come back, they are renamed again.
 */
const renamedThisRun = new Map<string, string>();

/** Tab order shared by every chat in a project, so dragging a tab in one moves it in all. */
export const useSharedTabOrderStore = create<SharedTabOrderStoreState>()(
  persist(
    (set) => ({
      byProjectKey: {},
      activeByProjectKey: {},
      mainWindowByProjectKey: {},
      shownByWindowKey: {},
      record: (projectKey, threadId, surfaces) =>
        set((state) => ({
          byProjectKey: {
            ...state.byProjectKey,
            [projectKey]: recordSharedTabOrder(
              state.byProjectKey[projectKey] ?? [],
              threadId,
              surfaces,
            ),
          },
        })),
      include: (projectKey, threadId, surfaces) =>
        set((state) => {
          const order = state.byProjectKey[projectKey] ?? [];
          const next = includeSharedTabs(order, threadId, surfaces);
          return next === order
            ? state
            : { byProjectKey: { ...state.byProjectKey, [projectKey]: next } };
        }),
      setActive: (projectKey, key) =>
        set((state) =>
          state.activeByProjectKey[projectKey] === key
            ? state
            : { activeByProjectKey: { ...state.activeByProjectKey, [projectKey]: key } },
        ),
      place: (projectKey, key, role) =>
        set((state) => {
          const keys = state.mainWindowByProjectKey[projectKey] ?? [];
          if (keys.includes(key) === (role === "main")) return state;
          const next =
            role === "main"
              ? [...keys, key].slice(-MAX_ORDER_LENGTH)
              : keys.filter((candidate) => candidate !== key);
          return {
            mainWindowByProjectKey: { ...state.mainWindowByProjectKey, [projectKey]: next },
            shownByWindowKey: { ...state.shownByWindowKey, [`${role}:${projectKey}`]: key },
          };
        }),
      setShown: (role, projectKey, key) =>
        set((state) => {
          const windowKey = `${role}:${projectKey}`;
          return state.shownByWindowKey[windowKey] === key
            ? state
            : { shownByWindowKey: { ...state.shownByWindowKey, [windowKey]: key } };
        }),
      renameBrowserTabs: (renamedTabIds) => {
        for (const [from, to] of renamedTabIds) renamedThisRun.set(from, to);
        set((state) => renameBrowserTabKeys(state, renamedThisRun));
      },
    }),
    {
      name: "t3code:shared-tab-order:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveSharedWindowStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byProjectKey: state.byProjectKey,
        activeByProjectKey: state.activeByProjectKey,
        mainWindowByProjectKey: state.mainWindowByProjectKey,
        shownByWindowKey: state.shownByWindowKey,
      }),
    },
  ),
);

useSharedTabOrderStore.subscribe((state) => {
  if (renamedThisRun.size === 0) return;
  const next = renameBrowserTabKeys(state, renamedThisRun);
  if (next !== state) useSharedTabOrderStore.setState(next);
});
