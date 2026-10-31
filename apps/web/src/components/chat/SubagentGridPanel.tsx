import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isOrchestrationV2WorkActive,
  type OrchestrationV2Subagent,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon, BotIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import { useState } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import { cn } from "../../lib/utils";
import { useQuietThreadProjection, useQuietThreadShell } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { BackgroundThreadContext } from "./backgroundThread";

type LocalSubagent = OrchestrationV2Subagent & { childThreadId: ThreadId };

const LIVE_STATUSES = new Set(["pending", "preparing", "queued", "starting", "running", "waiting"]);

/** One cell per local child thread, in spawn order so cells never jump while you watch. */
function localSubagents(subagents: ReadonlyArray<OrchestrationV2Subagent>) {
  const byThreadId = new Map<ThreadId, LocalSubagent>();
  for (const subagent of subagents) {
    if (subagent.childThreadId === null) continue;
    byThreadId.set(subagent.childThreadId, subagent as LocalSubagent);
  }
  return [...byThreadId.values()];
}

export function SubagentGridPanel(props: { readonly threadRef: ScopedThreadRef }) {
  const projection = useQuietThreadProjection(props.threadRef)?.projection ?? null;
  const [focusedThreadId, setFocusedThreadId] = useState<ThreadId | null>(null);
  const agents = localSubagents(projection?.subagents ?? []);
  const focused = agents.find((agent) => agent.childThreadId === focusedThreadId);
  const shown = focused ? [focused] : agents;

  if (agents.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <BotIcon aria-hidden className="size-5" />
        <p>No subagents yet. Agents this thread starts show up here as they run.</p>
      </div>
    );
  }

  return (
    <div className="@container/subagents min-h-0 flex-1 overflow-y-auto p-2">
      <div
        className={cn(
          "grid min-h-full gap-2",
          focused || agents.length === 1
            ? "grid-cols-1 auto-rows-[minmax(20rem,1fr)]"
            : "grid-cols-1 auto-rows-[minmax(20rem,1fr)] @min-[720px]/subagents:grid-cols-2",
        )}
      >
        {shown.map((agent) => (
          <SubagentCell
            key={agent.childThreadId}
            environmentId={props.threadRef.environmentId}
            agent={agent}
            focused={focused !== undefined}
            onToggleFocus={() =>
              setFocusedThreadId((current) =>
                current === agent.childThreadId ? null : agent.childThreadId,
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function SubagentCell(props: {
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly agent: LocalSubagent;
  readonly focused: boolean;
  readonly onToggleFocus: () => void;
}) {
  const { agent } = props;
  const navigate = useNavigate();
  const childRef = scopeThreadRef(props.environmentId, agent.childThreadId);
  const shell = useQuietThreadShell(childRef);
  // A delegate the user chatted with runs again after its task record settled; its shell knows.
  const runtimeStatus = shell?.runtime?.status ?? null;
  const status =
    runtimeStatus !== null &&
    (LIVE_STATUSES.has(runtimeStatus) || !isOrchestrationV2WorkActive(agent.status))
      ? runtimeStatus
      : agent.status;
  const live = LIVE_STATUSES.has(status);
  const title = agent.title ?? shell?.title ?? "Subagent";

  return (
    <section
      aria-label={title}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-background"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b ps-2.5 pe-1 text-xs">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            live ? "bg-success" : status === "failed" ? "bg-destructive" : "bg-muted-foreground/40",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{title}</span>
        <span className="shrink-0 text-muted-foreground">{status.replaceAll("_", " ")}</span>
        <Button
          size="icon-micro"
          variant="ghost"
          aria-label={props.focused ? "Show all subagents" : "Focus this subagent"}
          onClick={props.onToggleFocus}
        >
          {props.focused ? <Minimize2Icon /> : <Maximize2Icon />}
        </Button>
        <Button
          size="icon-micro"
          variant="ghost"
          aria-label="Open as thread"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(childRef),
            })
          }
        >
          <ArrowUpRightIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Each cell's composer stays its own, and global shortcuts stay with the parent chat. */}
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={props.environmentId}
              threadId={agent.childThreadId}
              routeKind="server"
              reserveTitleBarControlInset={false}
              embedded
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      </div>
    </section>
  );
}
