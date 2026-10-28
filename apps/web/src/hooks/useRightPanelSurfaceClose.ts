import {
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  ProjectId,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import { locatePreviewSession, readThreadProjectId } from "../browser/browserScope";
import { useGitGraphProjectStore } from "../components/gitGraph/gitGraphProjectStore";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import { agentControlledBrowserCloseConfirmation } from "../components/ChatView.logic";
import { closePreviewSession } from "../components/preview/closePreviewSession";
import { useThreadTerminalActions } from "../components/terminal/useThreadTerminalActions";
import { confirmTerminalClose } from "../lib/terminalCloseConfirm";
import { focusPanelTerminalAfterClose } from "../lib/terminalFocus";
import { readLocalApi } from "../localApi";
import {
  setActivePreviewTab,
  useActivePreviewSessions,
  useThreadPreviewState,
} from "../previewStateStore";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";
import { previewEnvironment } from "../state/preview";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useStableCallback } from "./useStableCallback";

/** Closing releases preview and terminal sessions. Agent-driven browsers and terminal tabs require confirmation. */
export function useRightPanelSurfaceClose(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly terminalLabelsById: ReadonlyMap<string, string>;
}) {
  const { threadRef, terminalLabelsById } = input;
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const canOperatePreview = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  const previewState = useThreadPreviewState(threadRef);
  const previewByThreadKey = useActivePreviewSessions();
  const terminalActions = useThreadTerminalActions(threadRef);
  const storeCloseTerminal = useTerminalUiStateStore((state) => state.closeTerminal);
  const surfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );

  const releaseSurfaceResources = (ref: ScopedThreadRef, surface: RightPanelSurface) => {
    // Without preview access, server state remains until an authorized close or restart.
    if (canOperatePreview && surface.kind === "preview" && surface.resourceId) {
      const located = locatePreviewSession(
        previewByThreadKey,
        ref.environmentId,
        surface.resourceId,
      );
      const owner = located?.owner ?? ref;
      void closePreviewSession({
        closePreview,
        snapshot: located?.snapshot ?? previewState.sessions[surface.resourceId] ?? null,
        tabId: surface.resourceId,
        threadRef: owner,
      });
      if (owner.threadId !== ref.threadId) {
        useRightPanelStore.getState().closeSurface(owner, surface.id);
      }
    }
    if (
      surface.kind === "terminal" &&
      readEnvironmentScope(ref.environmentId, AuthTerminalOperateScope)
    ) {
      for (const terminalId of surface.terminalIds) {
        // A shared terminal belongs to another chat; this chat's own ids may repeat it.
        if (surface.ownerThreadId === undefined) {
          storeCloseTerminal(ref, terminalId);
          terminalActions.closeTerminalSession(terminalId);
        } else {
          terminalActions.closeTerminalSession(terminalId, ThreadId.make(surface.ownerThreadId));
        }
      }
    }
    if (surface.kind === "git-graph") {
      const projectId = readThreadProjectId(ref);
      if (projectId !== undefined) {
        useGitGraphProjectStore
          .getState()
          .update(scopedProjectKey(scopeProjectRef(ref.environmentId, ProjectId.make(projectId))), {
            open: false,
          });
      }
    }
  };
  const closeAfterAgentBrowserConfirmation = (
    toClose: readonly RightPanelSurface[],
    closeSurfaces: () => void,
  ) => {
    const message = agentControlledBrowserCloseConfirmation(toClose, previewState.desktopByTabId);
    if (!message) {
      closeSurfaces();
      return;
    }
    const localApi = readLocalApi();
    if (!localApi) return;
    void localApi.dialogs.confirm(message, { variant: "destructive" }).then(
      (confirmed) => {
        if (confirmed) closeSurfaces();
      },
      () => undefined,
    );
  };
  // The active surface closes last so the panel does not flash through it.
  const finishClose = (toClose: readonly RightPanelSurface[]) => {
    if (!threadRef) return;
    const store = useRightPanelStore.getState();
    const activeId = selectThreadRightPanelState(store.byThreadKey, threadRef).activeSurfaceId;
    const ordered = toClose.toSorted(
      (left, right) => Number(left.id === activeId) - Number(right.id === activeId),
    );
    for (const surface of ordered) {
      // Releasing a browser drops its session, which prunes the tab automatically; close it
      // first so the close stays a user action that hides the panel after the last tab.
      store.closeSurface(threadRef, surface.id);
      releaseSurfaceResources(threadRef, surface);
    }
    const nextActiveSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    );
    if (nextActiveSurface?.kind === "preview" && nextActiveSurface.resourceId) {
      setActivePreviewTab(threadRef, nextActiveSurface.resourceId);
    }
    focusPanelTerminalAfterClose(threadRef, activeId);
  };
  const labelFor = (terminalId: string) =>
    terminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId);
  const closeSurfaces = (toClose: readonly RightPanelSurface[]) => {
    if (!threadRef) return;
    closeAfterAgentBrowserConfirmation(toClose, () => finishClose(toClose));
  };

  const closeSurface = useStableCallback((surface: RightPanelSurface) => {
    if (!threadRef) return;
    if (surface.kind === "preview") {
      closeSurfaces([surface]);
      return;
    }
    if (
      surface.kind !== "terminal" ||
      !readEnvironmentScope(threadRef.environmentId, AuthTerminalOperateScope)
    ) {
      finishClose([surface]);
      return;
    }
    const otherLabels = surface.terminalIds
      .filter((terminalId) => terminalId !== surface.activeTerminalId)
      .map(labelFor);
    void confirmTerminalClose([labelFor(surface.activeTerminalId), ...otherLabels]).then(
      (confirmed) => {
        if (confirmed) finishClose([surface]);
      },
    );
  });
  const closeOtherSurfaces = useStableCallback((surface: RightPanelSurface) =>
    closeSurfaces(surfaces.filter((entry) => entry.id !== surface.id)),
  );
  const closeSurfacesToRight = useStableCallback((surface: RightPanelSurface) => {
    const surfaceIndex = surfaces.findIndex((entry) => entry.id === surface.id);
    if (surfaceIndex < 0) return;
    closeSurfaces(surfaces.slice(surfaceIndex + 1));
  });
  const closeAllSurfaces = useStableCallback(() => closeSurfaces(surfaces));

  return { closeSurface, closeOtherSurfaces, closeSurfacesToRight, closeAllSurfaces };
}
