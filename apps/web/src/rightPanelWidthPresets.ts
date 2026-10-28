import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export interface RightPanelWidthPreset {
  readonly name: string;
  readonly width: number;
}

interface RightPanelWidthPresetsState {
  readonly presets: readonly RightPanelWidthPreset[];
  /** A preset with the same name is replaced. */
  readonly save: (name: string, width: number) => void;
  readonly remove: (name: string) => void;
}

/** Saved widths for the right panel beside the chat, applied from the chat header. */
export const useRightPanelWidthPresetsStore = create<RightPanelWidthPresetsState>()(
  persist(
    (set) => ({
      presets: [],
      save: (name, width) =>
        set((state) => ({
          presets: [
            ...state.presets.filter((preset) => preset.name !== name),
            { name, width: Math.round(width) },
          ],
        })),
      remove: (name) =>
        set((state) => ({ presets: state.presets.filter((preset) => preset.name !== name) })),
    }),
    {
      name: "t3code:right-panel-width-presets:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ presets: state.presets }),
    },
  ),
);

/** Each chat remembers its own right panel width. */
export function rightPanelWidthStorageKey(threadKey: string): string {
  return `t3code:preview-panel-width:${threadKey}`;
}
