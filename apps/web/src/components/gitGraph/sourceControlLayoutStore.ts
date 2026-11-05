import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveSharedWindowStorage } from "~/lib/storage";

/** Old entries fall off the start, so deleted worktrees and folders cannot grow it forever. */
const MAX_ENTRIES = 500;

export interface GitGraphColumnWidths {
  /** The source control sidebar beside the graph. */
  readonly sidebar: number;
  /** The most the graph column takes; `null` fits every lane. */
  readonly graph: number | null;
  /** The least the description takes; it grows into any room left over. */
  readonly description: number;
  readonly author: number;
}

export type GitGraphColumn = keyof GitGraphColumnWidths;

const DEFAULT_GIT_GRAPH_COLUMN_WIDTHS: GitGraphColumnWidths = {
  sidebar: 288,
  graph: null,
  description: 320,
  author: 128,
};

interface SourceControlLayoutStoreState {
  /** Sections and folders the user opened or closed, by worktree path; the rest use defaults. */
  readonly openByKey: Readonly<Record<string, boolean>>;
  readonly setOpen: (key: string, open: boolean) => void;
  /** Shared by every project, so a width set in one repository holds in the rest. */
  readonly columnWidths: GitGraphColumnWidths;
  readonly setColumnWidth: (column: GitGraphColumn, width: number | null) => void;
}

/**
 * Every chat shows its own Git Graph panel, so what is expanded lives here rather than in
 * component state: closing "Changes" in one chat closes it in every chat, and after a restart.
 */
export const useSourceControlLayoutStore = create<SourceControlLayoutStoreState>()(
  persist(
    (set) => ({
      openByKey: {},
      setOpen: (key, open) =>
        set((state) => {
          const { [key]: _previous, ...rest } = state.openByKey;
          return {
            openByKey: Object.fromEntries(
              [...Object.entries(rest), [key, open] as const].slice(-MAX_ENTRIES),
            ),
          };
        }),
      columnWidths: DEFAULT_GIT_GRAPH_COLUMN_WIDTHS,
      setColumnWidth: (column, width) =>
        set((state) => ({
          columnWidths: {
            ...state.columnWidths,
            [column]: width ?? DEFAULT_GIT_GRAPH_COLUMN_WIDTHS[column],
          },
        })),
    }),
    {
      name: "t3code:git-source-control-layout:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveSharedWindowStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ openByKey: state.openByKey, columnWidths: state.columnWidths }),
      // Widths saved before a column existed keep the defaults for the new ones.
      merge: (persisted, current) => {
        const saved = persisted as Partial<SourceControlLayoutStoreState> | undefined;
        return {
          ...current,
          ...saved,
          columnWidths: { ...current.columnWidths, ...saved?.columnWidths },
        };
      },
    },
  ),
);

/** Whether a section is open, and a setter, remembered for every chat. */
export function useSourceControlOpen(
  key: string,
  defaultOpen: boolean,
): readonly [boolean, (open: boolean) => void] {
  const open = useSourceControlLayoutStore((state) => state.openByKey[key] ?? defaultOpen);
  const setOpen = useSourceControlLayoutStore((state) => state.setOpen);
  return [open, (next) => setOpen(key, next)];
}
