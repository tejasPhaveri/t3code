import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

import type { RightPanelSurface } from "./rightPanelStore";

/** Old tabs fall off the end, so closed terminals and browser tabs cannot grow it forever. */
const MAX_ORDER_LENGTH = 300;

/**
 * Identity of a tab every chat in the project shows, the same in each chat; null for a
 * chat's own tabs. A terminal is shown in its owner by plain id and elsewhere by reference.
 */
function sharedSurfaceKey(threadId: string, surface: RightPanelSurface): string | null {
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

interface SharedTabOrderStoreState {
  readonly byProjectKey: Readonly<Record<string, readonly string[]>>;
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
}

/** Tab order shared by every chat in a project, so dragging a tab in one moves it in all. */
export const useSharedTabOrderStore = create<SharedTabOrderStoreState>()(
  persist(
    (set) => ({
      byProjectKey: {},
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
    }),
    {
      name: "t3code:shared-tab-order:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProjectKey: state.byProjectKey }),
    },
  ),
);
