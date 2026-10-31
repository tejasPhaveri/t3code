import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveSharedWindowStorage } from "~/lib/storage";

export const terminalNameKey = (environmentId: string, threadId: string, terminalId: string) =>
  `${environmentId}\u0000${threadId}\u0000${terminalId}`;

interface TerminalNamesStoreState {
  readonly names: Readonly<Record<string, string>>;
  /** An empty name restores the terminal's own label. */
  readonly rename: (
    environmentId: string,
    threadId: string,
    terminalId: string,
    name: string,
  ) => void;
}

/** Names the user gave terminals on this device. Closing a terminal frees its id for reuse. */
export const useTerminalNamesStore = create<TerminalNamesStoreState>()(
  persist(
    (set) => ({
      names: {},
      rename: (environmentId, threadId, terminalId, name) =>
        set((state) => {
          const key = terminalNameKey(environmentId, threadId, terminalId);
          const trimmed = name.trim().slice(0, 128);
          if ((state.names[key] ?? "") === trimmed) return state;
          const { [key]: _previous, ...rest } = state.names;
          return { names: trimmed.length === 0 ? rest : { ...rest, [key]: trimmed } };
        }),
    }),
    {
      name: "t3code:terminal-names:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveSharedWindowStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ names: state.names }),
    },
  ),
);
