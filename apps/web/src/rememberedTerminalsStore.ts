import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

export interface RememberedTerminal {
  readonly threadId: string;
  readonly terminalId: string;
}

/** Terminals nobody closed but never came back fall off the oldest end. */
const MAX_REMEMBERED_TERMINALS = 200;

const sameTerminal = (left: RememberedTerminal, right: RememberedTerminal) =>
  left.threadId === right.threadId && left.terminalId === right.terminalId;

/** Adds terminals not seen before; the same list when there are none. */
export function rememberTerminals(
  remembered: readonly RememberedTerminal[],
  terminals: readonly RememberedTerminal[],
): readonly RememberedTerminal[] {
  const added = terminals.filter(
    (terminal, index) =>
      !remembered.some((entry) => sameTerminal(entry, terminal)) &&
      terminals.findIndex((entry) => sameTerminal(entry, terminal)) === index,
  );
  if (added.length === 0) return remembered;
  return [
    ...remembered,
    ...added.map(({ threadId, terminalId }) => ({ threadId, terminalId })),
  ].slice(-MAX_REMEMBERED_TERMINALS);
}

interface RememberedTerminalsStoreState {
  readonly byEnvironmentId: Readonly<Record<string, readonly RememberedTerminal[]>>;
  readonly remember: (environmentId: string, terminals: readonly RememberedTerminal[]) => void;
  readonly forget: (environmentId: string, terminal: RememberedTerminal) => void;
}

/**
 * Terminals a chat has seen running, so its project keeps showing them after a restart
 * ends every shell. Showing one reattaches it, which starts a new shell with its saved
 * scrollback. Closing a terminal forgets it.
 */
export const useRememberedTerminalsStore = create<RememberedTerminalsStoreState>()(
  persist(
    (set) => ({
      byEnvironmentId: {},
      remember: (environmentId, terminals) =>
        set((state) => {
          const current = state.byEnvironmentId[environmentId] ?? [];
          const next = rememberTerminals(current, terminals);
          return next === current
            ? state
            : { byEnvironmentId: { ...state.byEnvironmentId, [environmentId]: next } };
        }),
      forget: (environmentId, terminal) =>
        set((state) => {
          const current = state.byEnvironmentId[environmentId] ?? [];
          const next = current.filter((entry) => !sameTerminal(entry, terminal));
          return next.length === current.length
            ? state
            : { byEnvironmentId: { ...state.byEnvironmentId, [environmentId]: next } };
        }),
    }),
    {
      name: "t3code:remembered-terminals:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byEnvironmentId: state.byEnvironmentId }),
    },
  ),
);
