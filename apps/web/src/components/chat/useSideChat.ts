import type {
  ModelSelection,
  OrchestrationV2Run,
  ProviderInteractionMode,
  RunId,
  RuntimeMode,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { isForkableSourceRunStatus } from "@t3tools/contracts";
import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { newMessageId, newThreadId } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { waitForThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";

export interface SideChatSource {
  readonly sourceThreadId: ThreadId;
  readonly runId: RunId;
}

/**
 * The response a side chat branches from: the last assistant message in a run whose history has
 * settled. It carries its own source thread, so a side chat opened on a side chat branches from
 * the right one. A settled assistant message can still belong to a running turn — the server
 * refuses to fork one of those, so the run's status decides, not the message's.
 */
export function latestSideChatSource(
  items: ReadonlyArray<ThreadStructureVisibleTurnItem>,
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status">>,
): SideChatSource | null {
  const settledRuns = new Set(
    runs.filter((run) => isForkableSourceRunStatus(run.status)).map((run) => run.id),
  );
  const source = items.findLast(
    ({ item }) =>
      item.type === "assistant_message" &&
      item.status === "completed" &&
      item.runId !== null &&
      settledRuns.has(item.runId),
  );
  if (!source || source.item.type !== "assistant_message" || source.item.runId === null)
    return null;
  return { sourceThreadId: source.sourceThreadId, runId: source.item.runId };
}

interface SideChatInput {
  readonly threadRef: ScopedThreadRef | null;
  readonly title: string | undefined;
  readonly source: SideChatSource | null;
  readonly onError: (message: string) => void;
  /** The turn's provider settings; null while the composer has no provider to send to. */
  readonly getTurnSettings: () => {
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
  } | null;
}

/**
 * Opens a side chat: a fork of the response at `source`, shown as a right-panel tab and kept out
 * of every thread list. An optional first prompt is sent into it once its shell reaches this client.
 */
export function useSideChat(input: SideChatInput) {
  const [pending, setPending] = useState(false);
  const forkThreadFromRun = useAtomCommand(threadEnvironment.forkFromRun, { reportFailure: false });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });

  const openSideChat = async (prompt?: string) => {
    const { threadRef, source } = input;
    if (!threadRef || !source || pending) return;
    setPending(true);
    try {
      const targetThreadId = newThreadId();
      const result = await forkThreadFromRun({
        environmentId: threadRef.environmentId,
        input: {
          sourceThreadId: source.sourceThreadId,
          targetThreadId,
          runId: source.runId,
          title: `${input.title ?? "Thread"} side chat`,
          sideChat: true,
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          input.onError(error instanceof Error ? error.message : "Failed to start a side chat.");
        }
        return;
      }
      if (!(await waitForThreadShell(scopeThreadRef(threadRef.environmentId, targetThreadId)))) {
        input.onError("The side chat was created, but its thread data did not reach this client.");
        return;
      }
      useRightPanelStore.getState().openSideChat(threadRef, targetThreadId);
      const text = prompt?.trim();
      const settings = text ? input.getTurnSettings() : null;
      if (!text || !settings) return;
      const turn = await startThreadTurn({
        environmentId: threadRef.environmentId,
        input: {
          threadId: targetThreadId,
          message: { messageId: newMessageId(), role: "user", text, attachments: [] },
          ...settings,
          createdAt: new Date().toISOString(),
        },
      });
      if (turn._tag === "Failure" && !isAtomCommandInterrupted(turn)) {
        const error = squashAtomCommandFailure(turn);
        input.onError(
          error instanceof Error ? error.message : "Failed to send the side chat prompt.",
        );
      }
    } finally {
      setPending(false);
    }
  };

  return {
    available: input.threadRef !== null && input.source !== null && !pending,
    open: useStableCallback(openSideChat),
  };
}
