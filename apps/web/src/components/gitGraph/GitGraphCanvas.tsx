import type { GitGraphLayout } from "@t3tools/client-runtime/git-graph/layout";
import type { GitGraphRef, PullRequestListEntry } from "@t3tools/contracts";
import { GitBranch, Tag } from "lucide-react";
import type { MouseEvent } from "react";

import { cn } from "~/lib/utils";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { formatGitGraphDate, gitGraphColor, shortHash } from "./gitGraphFormat";
import type { GitGraphBranchLabel, GitGraphRowItem } from "./gitGraphRows";

export const ROW_HEIGHT = 24;
const LANE_WIDTH = 14;

const laneX = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;

/** Lines and nodes for the rows on screen, plus the line entering from the row above. */
export function GraphWindow(props: {
  readonly layout: GitGraphLayout;
  readonly items: readonly GitGraphRowItem[];
  readonly start: number;
  readonly end: number;
  readonly width: number;
}) {
  const { layout, items, start, end } = props;
  const y = (row: number) => (row - start) * ROW_HEIGHT + ROW_HEIGHT / 2;
  const paths: React.ReactNode[] = [];
  const nodes: React.ReactNode[] = [];
  for (let row = Math.max(0, start - 1); row < end; row += 1) {
    const layoutRow = layout.rows[row];
    const item = items[row];
    if (!layoutRow || !item) continue;
    for (const [index, segment] of layoutRow.below.entries()) {
      const x1 = laneX(segment.from);
      const x2 = laneX(segment.to);
      const y1 = y(row);
      const y2 = y(row + 1);
      const d =
        x1 === x2
          ? `M${x1} ${y1}V${y2}`
          : `M${x1} ${y1}C${x1} ${y1 + ROW_HEIGHT / 2} ${x2} ${y2 - ROW_HEIGHT / 2} ${x2} ${y2}`;
      paths.push(
        <path
          key={`${row}:${index}`}
          d={d}
          fill="none"
          stroke={
            item.kind === "uncommitted" ? "var(--muted-foreground)" : gitGraphColor(segment.color)
          }
          strokeWidth={2}
          strokeDasharray={item.kind === "uncommitted" ? "2 2" : undefined}
        />,
      );
    }
    if (row < start) continue;
    const cx = laneX(layoutRow.column);
    const cy = y(row);
    const color = gitGraphColor(layoutRow.color);
    nodes.push(
      item.kind === "uncommitted" ? (
        <circle
          key={item.key}
          cx={cx}
          cy={cy}
          r={4}
          fill="var(--background)"
          stroke="var(--muted-foreground)"
          strokeWidth={1.5}
          strokeDasharray="2 1.5"
        />
      ) : item.kind === "stash" ? (
        <g key={item.key}>
          <circle
            cx={cx}
            cy={cy}
            r={4.5}
            fill="var(--background)"
            stroke={color}
            strokeWidth={1.5}
          />
          <circle cx={cx} cy={cy} r={1.75} fill={color} />
        </g>
      ) : item.isHead ? (
        <circle cx={cx} cy={cy} r={4.5} fill="var(--background)" stroke={color} strokeWidth={2} />
      ) : (
        <circle key={item.key} cx={cx} cy={cy} r={4} fill={color} />
      ),
    );
  }
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 overflow-visible"
      style={{ top: start * ROW_HEIGHT, width: props.width, height: (end - start) * ROW_HEIGHT }}
    >
      {paths}
      {nodes}
    </svg>
  );
}

function BranchChip(props: {
  readonly branch: GitGraphBranchLabel;
  readonly color: string;
  readonly pullRequest: PullRequestListEntry | undefined;
  readonly onContextMenu: (event: MouseEvent, branch: GitGraphBranchLabel) => void;
  readonly onOpenPullRequest: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  const { branch, pullRequest } = props;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm border px-1 text-2xs leading-4",
        branch.checkedOut && "font-semibold",
      )}
      style={{ borderColor: props.color }}
      onContextMenu={(event) => props.onContextMenu(event, branch)}
    >
      <GitBranch className="size-3" style={{ color: props.color }} />
      {branch.name}
      {branch.remotes.map((remote) => (
        <span key={remote} className="text-muted-foreground italic">
          {remote}
        </span>
      ))}
      {pullRequest ? (
        <button
          type="button"
          aria-label={`Open pull request #${pullRequest.number}`}
          className="inline-flex items-center gap-0.5 rounded-sm px-0.5 text-info hover:bg-accent"
          onClick={(event) => props.onOpenPullRequest(event, pullRequest.url)}
        >
          {pullRequest.isDraft ? (
            <PullRequestGlyph.draft className="size-3" />
          ) : (
            <PullRequestGlyph.pullRequest className="size-3" />
          )}
          #{pullRequest.number}
        </button>
      ) : null}
    </span>
  );
}

/** One row: its description with branch and tag labels, then date, author and hash columns. */
export function GraphRow(props: {
  readonly item: GitGraphRowItem;
  readonly index: number;
  readonly graphWidth: number;
  readonly color: string;
  readonly selected: boolean;
  readonly isMatch: boolean;
  readonly isCurrentMatch: boolean;
  readonly pullRequestByBranch: ReadonlyMap<string, PullRequestListEntry>;
  readonly onClick: (event: MouseEvent) => void;
  readonly onContextMenu: (event: MouseEvent) => void;
  readonly onBranchContextMenu: (event: MouseEvent, branch: GitGraphBranchLabel) => void;
  readonly onTagClick: (tag: GitGraphRef) => void;
  readonly onTagContextMenu: (event: MouseEvent, tag: GitGraphRef) => void;
  readonly onOpenPullRequest: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  const { item } = props;
  return (
    <div
      role="row"
      className={cn(
        "absolute right-0 left-0 flex items-center hover:bg-accent/60",
        props.selected && "bg-accent",
        props.isMatch && !props.isCurrentMatch && "bg-warning/10",
        props.isCurrentMatch && "bg-warning/20",
        item.kind === "commit" && item.isHead && "font-medium",
      )}
      style={{ top: props.index * ROW_HEIGHT, height: ROW_HEIGHT }}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
    >
      <div className="shrink-0" style={{ width: props.graphWidth }} />
      <div className="flex min-w-0 flex-1 items-center gap-1 px-2">
        {item.kind === "uncommitted" ? (
          <span className="truncate text-muted-foreground italic">
            Uncommitted Changes ({item.fileCount})
          </span>
        ) : item.kind === "stash" ? (
          <>
            <span className="shrink-0 rounded-sm border border-border px-1 text-2xs leading-4 text-muted-foreground">
              {item.stash.selector}
            </span>
            <span className="truncate">{item.stash.subject}</span>
          </>
        ) : (
          <>
            {item.branches.map((branch) => (
              <BranchChip
                key={branch.fullName}
                branch={branch}
                color={props.color}
                pullRequest={props.pullRequestByBranch.get(
                  branch.kind === "head"
                    ? branch.name
                    : branch.name.slice(branch.name.indexOf("/") + 1),
                )}
                onContextMenu={props.onBranchContextMenu}
                onOpenPullRequest={props.onOpenPullRequest}
              />
            ))}
            {item.tags.map((tag) => (
              <span
                key={tag.fullName}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-1 text-2xs leading-4"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onTagClick(tag);
                }}
                onContextMenu={(event) => {
                  event.stopPropagation();
                  props.onTagContextMenu(event, tag);
                }}
              >
                <Tag className="size-3 text-muted-foreground" />
                {tag.name}
              </span>
            ))}
            <span className="truncate">{item.commit.subject}</span>
          </>
        )}
      </div>
      <div className="w-36 shrink-0 truncate px-2 text-muted-foreground">
        {item.kind === "commit"
          ? formatGitGraphDate(item.commit.authorTime)
          : item.kind === "stash"
            ? formatGitGraphDate(item.stash.authorTime)
            : ""}
      </div>
      <div className="w-32 shrink-0 truncate px-2 text-muted-foreground">
        {item.kind === "commit" ? item.commit.author : ""}
      </div>
      <div className="w-20 shrink-0 truncate px-2 font-mono text-muted-foreground">
        {item.kind === "commit"
          ? shortHash(item.commit.hash)
          : item.kind === "stash"
            ? shortHash(item.stash.hash)
            : "*"}
      </div>
    </div>
  );
}
