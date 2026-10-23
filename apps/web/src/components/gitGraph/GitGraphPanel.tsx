import {
  type EnvironmentId,
  GIT_GRAPH_MAX_COMMITS,
  GIT_GRAPH_PAGE_SIZE,
  type PullRequestListEntry,
  ProjectId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { GitGraphLayout } from "@t3tools/client-runtime/git-graph/layout";
import { CloudDownload, GitBranch, Tag } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { gitGraphEnvironment } from "~/state/gitGraph";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { type TextPrompt, TextPromptDialog } from "../TextPromptDialog";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { formatGitGraphDate, gitGraphColor, shortHash } from "./gitGraphFormat";
import { buildGitGraphRows, type GitGraphBranchLabel, type GitGraphRowItem } from "./gitGraphRows";
import { GitSourceControl } from "./GitSourceControl";
import { confirmGitGraphAction, useGitGraphAction } from "./useGitGraphAction";

const ROW_HEIGHT = 24;
const LANE_WIDTH = 14;
const OVERSCAN_ROWS = 12;
const BACKGROUND_REFRESH_MS = 10_000;

const laneX = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;

/** Lines and nodes for the rows on screen, plus the line entering from the row above. */
function GraphWindow(props: {
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
        <circle
          key={item.key}
          cx={cx}
          cy={cy}
          r={4.5}
          fill="var(--background)"
          stroke={color}
          strokeWidth={2}
        />
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

type RowMenuAction =
  | "checkout"
  | "merge"
  | "create-branch"
  | "copy-hash"
  | "stash"
  | "stash-apply"
  | "stash-pop"
  | "stash-drop";

type BranchMenuAction = "checkout" | "merge" | "create-branch" | "copy-name";

export function GitGraphPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | null;
  readonly projectId: string | null;
  readonly visible: boolean;
}) {
  const { environmentId, cwd, visible } = props;
  const [maxCount, setMaxCount] = useState(GIT_GRAPH_PAGE_SIZE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [prompt, setPrompt] = useState<TextPrompt | null>(null);
  const [fetching, setFetching] = useState(false);
  // Background refreshes stay silent; a click shows its work until newer data lands.
  const [refreshRequestedAt, setRefreshRequestedAt] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const openPrLink = useOpenPrLink(props.threadRef);

  const log = useEnvironmentQuery(
    cwd === null
      ? null
      : gitGraphEnvironment.log({
          environmentId,
          input: { cwd, maxCount, showRemoteBranches: true },
        }),
  );
  const worktrees = useEnvironmentQuery(
    cwd === null ? null : gitGraphEnvironment.worktrees({ environmentId, input: { cwd } }),
  );
  const pullRequests = useEnvironmentQuery(
    props.projectId === null
      ? null
      : pullRequestEnvironment.list({
          environmentId,
          input: { state: "open", projectId: ProjectId.make(props.projectId), limit: 200 },
        }),
  );
  const pullRequestByBranch = new Map(
    (pullRequests.data?.entries ?? []).map((entry) => [entry.headBranch, entry] as const),
  );
  const refreshLog = log.refresh;
  const refreshWorktrees = worktrees.refresh;
  const refreshAll = useStableCallback(() => {
    refreshLog();
    refreshWorktrees();
  });
  const runAction = useGitGraphAction({ environmentId, cwd, onSettled: refreshAll });

  useEffect(() => {
    if (!visible) return;
    const refreshIfShown = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    const interval = window.setInterval(refreshIfShown, BACKGROUND_REFRESH_MS);
    window.addEventListener("focus", refreshIfShown);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfShown);
    };
  }, [refreshAll, visible]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    return observeResize(element, ([entry]) =>
      setViewportHeight(Math.round(entry?.contentRect.height ?? 0)),
    );
  }, []);

  const model = log.data ? buildGitGraphRows(log.data) : null;
  const items = model?.items ?? [];
  const graphWidth = Math.max(1, Math.min(model?.layout.laneCount ?? 1, 24)) * LANE_WIDTH + 8;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const end = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );

  const promptCreateBranch = (startPoint: string, label: string) =>
    setPrompt({
      title: "Create branch",
      description: `From ${label}.`,
      placeholder: "feature/name",
      initialValue: "",
      confirmLabel: "Create branch",
      checkbox: { label: "Check out the new branch", initial: true },
      onConfirm: (name, checkout) =>
        void runAction(
          { _tag: "CreateBranch", name, startPoint, checkout },
          { success: `Created ${name}` },
        ),
    });

  const currentBranch = log.data?.head?.branch ?? null;
  const mergeEntry = (disabled: boolean) => ({
    id: "merge" as const,
    label: currentBranch ? `Merge into ${currentBranch}…` : "Merge into current branch…",
    disabled: disabled || currentBranch === null,
  });
  const mergeIntoCurrent = async (ref: string, label: string) => {
    if (currentBranch === null) return;
    const confirmed = await confirmGitGraphAction(
      `Merge ${label} into ${currentBranch}?\nCreates a merge commit on ${currentBranch}.`,
      "default",
    );
    if (confirmed) {
      void runAction({ _tag: "Merge", ref }, { success: `Merged ${label} into ${currentBranch}` });
    }
  };

  const showMenu = async <T extends string>(
    event: MouseEvent,
    entries: readonly {
      id: T;
      label: string;
      disabled?: boolean;
      destructive?: boolean;
      separatorBefore?: boolean;
    }[],
  ): Promise<T | null> => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api) return null;
    return (
      (await api.contextMenu.show([...entries], { x: event.clientX, y: event.clientY })) ?? null
    );
  };

  const onRowContextMenu = async (event: MouseEvent, item: GitGraphRowItem) => {
    setSelectedKey(item.key);
    if (item.kind === "uncommitted") {
      const choice = await showMenu<RowMenuAction>(event, [
        { id: "stash", label: "Stash changes…" },
      ]);
      if (choice === "stash") {
        setPrompt({
          title: "Stash changes",
          placeholder: "Message (optional)",
          initialValue: "",
          optional: true,
          confirmLabel: "Stash",
          checkbox: { label: "Include untracked files", initial: true },
          onConfirm: (message, includeUntracked) =>
            void runAction(
              {
                _tag: "Stash",
                includeUntracked,
                ...(message.length > 0 ? { message } : {}),
              },
              { success: "Changes stashed" },
            ),
        });
      }
      return;
    }
    if (item.kind === "stash") {
      const { selector } = item.stash;
      const choice = await showMenu<RowMenuAction>(event, [
        { id: "stash-apply", label: "Apply stash" },
        { id: "stash-pop", label: "Pop stash" },
        { id: "create-branch", label: "Create branch from stash commit…", separatorBefore: true },
        { id: "stash-drop", label: "Drop stash…", destructive: true, separatorBefore: true },
      ]);
      if (choice === "stash-apply") {
        void runAction({ _tag: "StashApply", selector }, { success: `Applied ${selector}` });
      } else if (choice === "stash-pop") {
        void runAction({ _tag: "StashPop", selector }, { success: `Popped ${selector}` });
      } else if (choice === "create-branch") {
        promptCreateBranch(item.stash.baseHash, `the commit ${selector} was made on`);
      } else if (choice === "stash-drop") {
        if (await confirmGitGraphAction(`Drop ${selector}?\nIts changes are deleted.`)) {
          void runAction({ _tag: "StashDrop", selector }, { success: `Dropped ${selector}` });
        }
      }
      return;
    }
    const { hash } = item.commit;
    const choice = await showMenu<RowMenuAction>(event, [
      { id: "checkout", label: "Check out this commit (detached)" },
      mergeEntry(item.commit.hash === log.data?.head?.hash),
      { id: "create-branch", label: "Create branch here…" },
      { id: "copy-hash", label: "Copy commit hash", separatorBefore: true },
    ]);
    if (choice === "checkout") {
      void runAction(
        { _tag: "Checkout", ref: hash },
        { success: `Checked out ${shortHash(hash)}` },
      );
    } else if (choice === "merge") {
      void mergeIntoCurrent(hash, `commit ${shortHash(hash)}`);
    } else if (choice === "create-branch") {
      promptCreateBranch(hash, `commit ${shortHash(hash)}`);
    } else if (choice === "copy-hash") {
      void navigator.clipboard.writeText(hash);
    }
  };

  const onBranchContextMenu = async (event: MouseEvent, branch: GitGraphBranchLabel) => {
    if (branch.kind === "remote") {
      const choice = await showMenu<BranchMenuAction>(event, [
        { id: "checkout", label: "Check out as local branch…" },
        mergeEntry(false),
        { id: "create-branch", label: "Create branch from here…" },
        { id: "copy-name", label: "Copy branch name", separatorBefore: true },
      ]);
      if (choice === "checkout") {
        setPrompt({
          title: "Check out remote branch",
          description: `Creates a local branch tracking ${branch.name}.`,
          placeholder: "Local branch name",
          initialValue: branch.name.slice(branch.name.indexOf("/") + 1),
          confirmLabel: "Check out",
          onConfirm: (localName) =>
            void runAction(
              { _tag: "Checkout", ref: branch.fullName, localName },
              { success: `Checked out ${localName}` },
            ),
        });
      } else if (choice === "merge") {
        void mergeIntoCurrent(branch.fullName, branch.name);
      } else if (choice === "create-branch") {
        promptCreateBranch(branch.fullName, branch.name);
      } else if (choice === "copy-name") {
        void navigator.clipboard.writeText(branch.name);
      }
      return;
    }
    const choice = await showMenu<BranchMenuAction>(event, [
      { id: "checkout", label: "Check out", disabled: branch.checkedOut },
      mergeEntry(branch.checkedOut),
      { id: "create-branch", label: "Create branch from here…" },
      { id: "copy-name", label: "Copy branch name", separatorBefore: true },
    ]);
    if (choice === "checkout") {
      void runAction(
        { _tag: "Checkout", ref: branch.fullName },
        { success: `Checked out ${branch.name}` },
      );
    } else if (choice === "merge") {
      void mergeIntoCurrent(branch.fullName, branch.name);
    } else if (choice === "create-branch") {
      promptCreateBranch(branch.fullName, branch.name);
    } else if (choice === "copy-name") {
      void navigator.clipboard.writeText(branch.name);
    }
  };

  const fetchAll = async () => {
    setFetching(true);
    await runAction({ _tag: "Fetch" }, { success: "Fetched all remotes" });
    setFetching(false);
  };

  if (cwd === null) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Git Graph needs a project folder.</div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-background text-xs">
      <aside className="w-72 min-w-56 shrink-0 overflow-auto border-r border-border">
        <GitSourceControl
          worktrees={worktrees.data?.worktrees ?? null}
          error={worktrees.error}
          runAction={runAction}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-2 py-1">
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={fetching}
            onClick={() => void fetchAll()}
          >
            <CloudDownload />
            {fetching ? "Fetching…" : "Fetch"}
          </Button>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => {
              setRefreshRequestedAt(Date.now());
              refreshAll();
            }}
          >
            <RefreshIcon
              refreshing={
                (log.isPending && log.data === null) ||
                (refreshRequestedAt !== null &&
                  log.error === null &&
                  (log.dataUpdatedAt < refreshRequestedAt ||
                    worktrees.dataUpdatedAt < refreshRequestedAt))
              }
            />
            Refresh
          </Button>
        </div>
        <div
          className="flex shrink-0 items-center border-b border-border text-muted-foreground"
          style={{ height: ROW_HEIGHT }}
        >
          <div className="shrink-0 px-2" style={{ width: graphWidth }}>
            Graph
          </div>
          <div className="min-w-0 flex-1 px-2">Description</div>
          <div className="w-36 shrink-0 px-2">Date</div>
          <div className="w-32 shrink-0 px-2">Author</div>
          <div className="w-20 shrink-0 px-2">Commit</div>
        </div>
        <div
          ref={scrollerRef}
          className="relative min-h-0 flex-1 overflow-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {log.error && !log.data ? <div className="p-3 text-destructive">{log.error}</div> : null}
          <div
            className="relative"
            style={{ height: (items.length + (log.data?.hasMore ? 1 : 0)) * ROW_HEIGHT }}
          >
            {items.slice(start, end).map((item, offset) => {
              const index = start + offset;
              const color = gitGraphColor(model!.layout.rows[index]!.color);
              return (
                <div
                  key={item.key}
                  role="row"
                  className={cn(
                    "absolute right-0 left-0 flex items-center hover:bg-accent/60",
                    item.key === selectedKey && "bg-accent",
                    item.kind === "commit" && item.isHead && "font-medium",
                  )}
                  style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                  onClick={() => setSelectedKey(item.key)}
                  onContextMenu={(event) => void onRowContextMenu(event, item)}
                >
                  <div className="shrink-0" style={{ width: graphWidth }} />
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
                            color={color}
                            pullRequest={pullRequestByBranch.get(
                              branch.kind === "head"
                                ? branch.name
                                : branch.name.slice(branch.name.indexOf("/") + 1),
                            )}
                            onContextMenu={(event, target) =>
                              void onBranchContextMenu(event, target)
                            }
                            onOpenPullRequest={(event, url) => void openPrLink(event, url)}
                          />
                        ))}
                        {item.tags.map((tag) => (
                          <span
                            key={tag.fullName}
                            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-1 text-2xs leading-4"
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
            })}
            {model ? (
              <GraphWindow
                layout={model.layout}
                items={items}
                start={start}
                end={end}
                width={graphWidth}
              />
            ) : null}
            {log.data?.hasMore && end >= items.length ? (
              <div
                className="absolute right-0 left-0 flex justify-center"
                style={{ top: items.length * ROW_HEIGHT }}
              >
                <Button
                  size="xs"
                  variant="ghost-muted"
                  onClick={() =>
                    setMaxCount((count) =>
                      Math.min(count + GIT_GRAPH_PAGE_SIZE, GIT_GRAPH_MAX_COMMITS),
                    )
                  }
                >
                  Load more commits
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {prompt ? <TextPromptDialog prompt={prompt} onClose={() => setPrompt(null)} /> : null}
    </div>
  );
}
