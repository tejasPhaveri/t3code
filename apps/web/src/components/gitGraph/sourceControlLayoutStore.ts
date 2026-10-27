import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveSharedWindowStorage } from "~/lib/storage";

/** Old entries fall off the start, so deleted worktrees and folders cannot grow it forever. */
const MAX_ENTRIES = 500;

interface SourceControlLayoutStoreState {
  /** Sections and folders the user opened or closed, by worktree path; the rest use defaults. */
  readonly openByKey: Readonly<Record<string, boolean>>;
  readonly setOpen: (key: string, open: boolean) => void;
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
    }),
    {
      name: "t3code:git-source-control-layout:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveSharedWindowStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ openByKey: state.openByKey }),
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
