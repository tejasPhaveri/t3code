import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

/** Git Graph belongs to the project: every chat in it shows the same tab. */
export interface GitGraphProjectState {
  readonly open: boolean;
}

const DEFAULT_GIT_GRAPH_PROJECT_STATE: GitGraphProjectState = { open: false };

interface GitGraphProjectStoreState {
  readonly byProjectKey: Readonly<Record<string, GitGraphProjectState>>;
  readonly update: (projectKey: string, patch: Partial<GitGraphProjectState>) => void;
}

export const useGitGraphProjectStore = create<GitGraphProjectStoreState>()(
  persist(
    (set) => ({
      byProjectKey: {},
      update: (projectKey, patch) =>
        set((state) => ({
          byProjectKey: {
            ...state.byProjectKey,
            [projectKey]: {
              ...(state.byProjectKey[projectKey] ?? DEFAULT_GIT_GRAPH_PROJECT_STATE),
              ...patch,
            },
          },
        })),
    }),
    {
      name: "t3code:git-graph-projects:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProjectKey: state.byProjectKey }),
    },
  ),
);

export function useGitGraphProjectState(projectKey: string | null): GitGraphProjectState {
  return useGitGraphProjectStore((state) =>
    projectKey === null
      ? DEFAULT_GIT_GRAPH_PROJECT_STATE
      : (state.byProjectKey[projectKey] ?? DEFAULT_GIT_GRAPH_PROJECT_STATE),
  );
}
