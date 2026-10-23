import type { GitGraphAction, GitGraphWorktree, GitGraphWorktreeFile } from "@t3tools/contracts";
import { ChevronDown, ChevronRight, GitBranch, Minus, Plus, Undo2 } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { buildFileTree, type FileTreeNode } from "./fileTree";
import { confirmGitGraphAction } from "./useGitGraphAction";

type RunAction = (
  action: GitGraphAction,
  options?: { readonly worktreePath?: string; readonly success?: string },
) => Promise<boolean>;

const STATUS_LETTER: Record<GitGraphWorktreeFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  untracked: "U",
  conflicted: "!",
};

const STATUS_CLASS: Record<GitGraphWorktreeFile["status"], string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-destructive",
  renamed: "text-info",
  copied: "text-info",
  "type-changed": "text-warning",
  untracked: "text-success",
  conflicted: "text-destructive",
};

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

function RowAction(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Button
      size="icon-micro"
      variant="ghost-muted"
      aria-label={props.label}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      {props.children}
    </Button>
  );
}

/** Stage, unstage and discard for a file or every file under a folder. */
function TreeActions(props: {
  readonly staged: boolean;
  readonly paths: readonly string[];
  readonly onStage: (paths: readonly string[]) => void;
  readonly onUnstage: (paths: readonly string[]) => void;
  readonly onDiscard: (paths: readonly string[]) => void;
}) {
  return props.staged ? (
    <RowAction label="Unstage" onClick={() => props.onUnstage(props.paths)}>
      <Minus />
    </RowAction>
  ) : (
    <>
      <RowAction label="Discard changes" onClick={() => props.onDiscard(props.paths)}>
        <Undo2 />
      </RowAction>
      <RowAction label="Stage" onClick={() => props.onStage(props.paths)}>
        <Plus />
      </RowAction>
    </>
  );
}

function FileTreeRows(props: {
  readonly nodes: readonly FileTreeNode[];
  readonly depth: number;
  readonly staged: boolean;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onStage: (paths: readonly string[]) => void;
  readonly onUnstage: (paths: readonly string[]) => void;
  readonly onDiscard: (paths: readonly string[]) => void;
}) {
  return props.nodes.map((node) => {
    const isCollapsed = props.collapsed.has(node.key);
    return (
      <div key={node.key}>
        <div
          className="group flex h-6 items-center gap-1 pr-1 hover:bg-accent/60"
          style={{ paddingLeft: 8 + props.depth * 12 }}
        >
          {node.file ? (
            <span className="w-3.5 shrink-0" />
          ) : (
            <button
              type="button"
              className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
              aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
              onClick={() => props.onToggle(node.key)}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </button>
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              node.file?.status === "deleted" && "line-through opacity-70",
            )}
          >
            {node.name}
          </span>
          <span className="hidden shrink-0 items-center group-hover:flex">
            <TreeActions
              staged={props.staged}
              paths={node.filePaths}
              onStage={props.onStage}
              onUnstage={props.onUnstage}
              onDiscard={props.onDiscard}
            />
          </span>
          {node.file ? (
            <span
              className={cn(
                "w-3 shrink-0 text-center font-mono font-semibold",
                STATUS_CLASS[node.file.status],
              )}
            >
              {STATUS_LETTER[node.file.status]}
            </span>
          ) : null}
        </div>
        {!node.file && !isCollapsed ? (
          <FileTreeRows {...props} nodes={node.children} depth={props.depth + 1} />
        ) : null}
      </div>
    );
  });
}

function ChangeGroup(props: {
  readonly title: string;
  readonly files: readonly GitGraphWorktreeFile[];
  readonly staged: boolean;
  readonly onStage: (paths: readonly string[]) => void;
  readonly onUnstage: (paths: readonly string[]) => void;
  readonly onDiscard: (paths: readonly string[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (props.files.length === 0) return null;
  const allPaths = props.files.map((file) => file.path);
  return (
    <div>
      <div className="group flex h-6 items-center gap-1 pr-1 pl-2 font-medium hover:bg-accent/60">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <span className="truncate">{props.title}</span>
        </button>
        <span className="hidden shrink-0 items-center group-hover:flex">
          <TreeActions
            staged={props.staged}
            paths={allPaths}
            onStage={props.onStage}
            onUnstage={props.onUnstage}
            onDiscard={props.onDiscard}
          />
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-2xs leading-4 text-muted-foreground tabular-nums">
          {props.files.length}
        </span>
      </div>
      {open ? (
        <FileTreeRows
          nodes={buildFileTree(props.files)}
          depth={1}
          staged={props.staged}
          collapsed={collapsed}
          onToggle={(key) => {
            const next = new Set(collapsed);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            setCollapsed(next);
          }}
          onStage={props.onStage}
          onUnstage={props.onUnstage}
          onDiscard={props.onDiscard}
        />
      ) : null}
    </div>
  );
}

function WorktreeSection(props: {
  readonly worktree: GitGraphWorktree;
  readonly showPath: boolean;
  readonly runAction: RunAction;
}) {
  const { worktree } = props;
  const [expanded, setExpanded] = useState(worktree.current);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const target = worktree.current ? {} : { worktreePath: worktree.path };
  const changeCount = worktree.staged.length + worktree.unstaged.length;

  const stage = (paths: readonly string[]) =>
    void props.runAction({ _tag: "Stage", paths: [...paths] }, target);
  const unstage = (paths: readonly string[]) =>
    void props.runAction({ _tag: "Unstage", paths: [...paths] }, target);
  const discard = async (paths: readonly string[]) => {
    const untracked = worktree.unstaged.filter(
      (file) => file.status === "untracked" && paths.includes(file.path),
    ).length;
    const confirmed = await confirmGitGraphAction(
      [
        paths.length === 1
          ? `Discard changes to "${basename(paths[0]!)}"?`
          : `Discard changes to ${paths.length} files?`,
        untracked > 0
          ? `This deletes ${untracked === 1 ? "an untracked file" : `${untracked} untracked files`} and can't be undone.`
          : "This can't be undone.",
      ].join("\n"),
    );
    if (confirmed) void props.runAction({ _tag: "Discard", paths: [...paths] }, target);
  };
  // A merge can be concluded with git's prepared message, so it needs no typed one.
  const canCommit =
    !committing && (worktree.merging || (message.trim().length > 0 && worktree.staged.length > 0));
  const commit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    const trimmed = message.trim();
    const committed = await props.runAction(
      { _tag: "Commit", ...(trimmed.length > 0 ? { message: trimmed } : {}) },
      { ...target, ...(worktree.merging ? { success: "Merge committed" } : {}) },
    );
    setCommitting(false);
    if (committed) setMessage("");
  };

  return (
    <div className="border-b border-border">
      <button
        type="button"
        className="flex h-7 w-full items-center gap-1.5 px-2 text-left hover:bg-accent/60"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <GitBranch className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{worktree.branch ?? "Detached HEAD"}</span>
        {props.showPath ? (
          <span className="min-w-0 truncate text-muted-foreground">{basename(worktree.path)}</span>
        ) : null}
        {changeCount > 0 ? (
          <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-2xs leading-4 text-muted-foreground tabular-nums">
            {changeCount}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="pb-2">
          <div className="space-y-1.5 px-2 pb-2">
            {worktree.merging ? (
              <div className="flex items-center gap-2 rounded-md bg-warning/10 px-2 py-1.5 text-warning-foreground">
                <span className="min-w-0 flex-1">
                  Merging. Resolve conflicts, stage the files, then commit.
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void props.runAction(
                      { _tag: "MergeAbort" },
                      { ...target, success: "Merge aborted" },
                    )
                  }
                >
                  Abort merge
                </Button>
              </div>
            ) : null}
            <Textarea
              size="sm"
              aria-label="Commit message"
              placeholder={
                worktree.merging
                  ? "Message (blank keeps the merge message)"
                  : "Message (⌘↵ to commit)"
              }
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void commit();
                }
              }}
            />
            <Button
              size="xs"
              className="w-full"
              disabled={!canCommit}
              onClick={() => void commit()}
            >
              {committing ? "Committing…" : worktree.merging ? "Commit merge" : "Commit"}
            </Button>
          </div>
          {changeCount === 0 ? <div className="px-3 text-muted-foreground">No changes.</div> : null}
          <ChangeGroup
            title="Staged Changes"
            files={worktree.staged}
            staged
            onStage={stage}
            onUnstage={unstage}
            onDiscard={(paths) => void discard(paths)}
          />
          <ChangeGroup
            title="Changes"
            files={worktree.unstaged}
            staged={false}
            onStage={stage}
            onUnstage={unstage}
            onDiscard={(paths) => void discard(paths)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Source control for the project's checkout and each of its worktrees. */
export function GitSourceControl(props: {
  readonly worktrees: readonly GitGraphWorktree[] | null;
  readonly error: string | null;
  readonly runAction: RunAction;
}) {
  if (props.error && !props.worktrees) {
    return <div className="p-3 text-destructive">{props.error}</div>;
  }
  if (!props.worktrees) return null;
  return (
    <div className="flex flex-col">
      {props.worktrees.map((worktree) => (
        <WorktreeSection
          key={worktree.path}
          worktree={worktree}
          showPath={props.worktrees!.length > 1}
          runAction={props.runAction}
        />
      ))}
    </div>
  );
}
