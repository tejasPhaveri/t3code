import type { CloudAgent } from "@t3tools/contracts";
import { CloudIcon, ExternalLinkIcon } from "lucide-react";

import type { SidebarCloudAgentRow } from "~/hooks/useSidebarCloudAgents";
import { cn } from "~/lib/utils";

function phaseLabel(agent: CloudAgent): string {
  switch (agent.phase) {
    case "running":
      return "Running";
    case "finished":
      return "Finished";
    case "error":
      return "Failed";
    case "unknown":
      return "Unknown";
  }
}

/** Cloud agents are another app's work; T3 only shows what that app reports. */
export function SidebarCloudAgentShelf(props: {
  rows: ReadonlyArray<SidebarCloudAgentRow>;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (props.rows.length === 0) return null;
  const running = props.rows.filter((row) => row.agent.phase === "running").length;
  return (
    <section className="mt-2 border-t border-sidebar-border px-2 pt-2 pb-1">
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:text-sidebar-foreground"
      >
        <CloudIcon className="size-3" />
        <span>Cloud agents</span>
        <span className="tabular-nums opacity-70">
          {running > 0 ? `${running} running` : props.rows.length}
        </span>
      </button>
      {props.expanded ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {props.rows.map((row) => {
            const label = phaseLabel(row.agent);
            return (
              <li key={row.key}>
                <a
                  href={row.agent.webUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-thread-selection-safe
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-1.5 py-1 text-xs",
                    "transition-colors hover:bg-sidebar-row-hover",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      row.agent.phase === "running"
                        ? "bg-accent"
                        : row.agent.phase === "error"
                          ? "bg-error"
                          : "bg-sidebar-muted-foreground/50",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-sidebar-foreground">
                    {row.agent.name}
                  </span>
                  <span className="shrink-0 text-2xs text-sidebar-muted-foreground">{label}</span>
                  <ExternalLinkIcon className="size-3 shrink-0 text-sidebar-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
