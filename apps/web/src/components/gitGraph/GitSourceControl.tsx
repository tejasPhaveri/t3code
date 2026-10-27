import type { GitGraphAction, GitGraphWorktree, GitGraphWorktreeFile } from "@t3tools/contracts";
import { ChevronDown, ChevronRight, FileText, GitBranch, Minus, Plus, Undo2 } from "lucide-react";
import { useState } from "react";

import { resolveDiffPathForWorkspace } from "~/diffFileActions";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { buildFileTree, type FileTreeNode } from "./fileTree";
import { useSourceControlLayoutStore, useSourceControlOpen } from "./sourceControlLayoutStore";
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

/**
 * Diff and file tabs read the chat's own checkout, so only that worktree's files open in them.
 * Paths are repository-relative.
 */
interface FileOpeners {
  readonly diff: (path: string) => void;
  readonly file: (path: string) => void;
}

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
  readonly open: FileOpeners | null;
  readonly isCollapsed: (key: string) => boolean;
  readonly onToggle: (key: string) => void;
  readonly onStage: (paths: readonly string[]) => void;
  readonly onUnstage: (paths: readonly string[]) => void;
  readonly onDiscard: (paths: readonly string[]) => void;
}) {
  const { open } = props;
  return props.nodes.map((node) => {
    const isCollapsed = props.isCollapsed(node.key);
    const { file } = node;
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
          {file && open ? (
            <button
              type="button"
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                file.status === "deleted" && "line-through opacity-70",
              )}
              onClick={() => open.diff(file.path)}
            >
              {node.name}
            </button>
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                node.file?.status === "deleted" && "line-through opacity-70",
              )}
            >
              {node.name}
            </span>
          )}
          <span className="hidden shrink-0 items-center group-hover:flex">
            {file && open && file.status !== "deleted" ? (
              <RowAction label="Open file" onClick={() => open.file(file.path)}>
                <FileText />
              </RowAction>
            ) : null}
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
  /** Identifies this group across chats, so its open state and folders are remembered. */
  readonly layoutKey: string;
  readonly title: string;
  readonly files: readonly GitGraphWorktreeFile[];
  readonly staged: boolean;
  readonly open: FileOpeners | null;
  readonly onStage: (paths: readonly string[]) => void;
  readonly onUnstage: (paths: readonly string[]) => void;
  readonly onDiscard: (paths: readonly string[]) => void;
}) {
  const [open, setOpen] = useSourceControlOpen(props.layoutKey, true);
  const openByKey = useSourceControlLayoutStore((state) => state.openByKey);
  const setLayoutOpen = useSourceControlLayoutStore((state) => state.setOpen);
  const folderKey = (key: string) => `${props.layoutKey}/${key}`;
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
          open={props.open}
          isCollapsed={(key) => openByKey[folderKey(key)] === false}
          onToggle={(key) => setLayoutOpen(folderKey(key), openByKey[folderKey(key)] === false)}
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
  readonly cwd: string;
  readonly runAction: RunAction;
  readonly onOpenDiff: (filePath: string) => void;
  readonly onOpenFile: (relativePath: string) => void;
}) {
  const { worktree } = props;
  const [expanded, setExpanded] = useSourceControlOpen(worktree.path, worktree.current);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const target = worktree.current ? {} : { worktreePath: worktree.path };
  const changeCount = worktree.staged.length + worktree.unstaged.length;
  const open: FileOpeners | null = worktree.current
    ? {
        diff: props.onOpenDiff,
        file: (path) => {
          // A project can be rooted below the repository, and file tabs are relative to it.
          const relativePath = resolveDiffPathForWorkspace({
            filePath: path,
            workspaceRoot: props.cwd,
            repositoryRoot: worktree.path,
          });
          if (relativePath) props.onOpenFile(relativePath);
        },
      }
    : null;

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
  const untrackedCount = worktree.unstaged.filter((file) => file.status === "untracked").length;
  // `git clean` deletes every untracked file, so this is a separate, explicit action.
  const cleanUntracked = async () => {
    const confirmed = await confirmGitGraphAction(
      `Delete ${untrackedCount === 1 ? "the untracked file" : `all ${untrackedCount} untracked files`}?\nThis can't be undone.`,
    );
    if (confirmed) void props.runAction({ _tag: "CleanUntracked" }, target);
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
            layoutKey={`${worktree.path}:staged`}
            title="Staged Changes"
            files={worktree.staged}
            staged
            open={open}
            onStage={stage}
            onUnstage={unstage}
            onDiscard={(paths) => void discard(paths)}
          />
          <ChangeGroup
            layoutKey={`${worktree.path}:changes`}
            title="Changes"
            files={worktree.unstaged}
            staged={false}
            open={open}
            onStage={stage}
            onUnstage={unstage}
            onDiscard={(paths) => void discard(paths)}
          />
          {untrackedCount > 0 ? (
            <div className="px-2 pt-1">
              <Button size="xs" variant="ghost-muted" onClick={() => void cleanUntracked()}>
                Clean {untrackedCount} untracked
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Source control for the project's checkout and each of its worktrees. */
export function GitSourceControl(props: {
  readonly worktrees: readonly GitGraphWorktree[] | null;
  readonly error: string | null;
  readonly cwd: string;
  readonly runAction: RunAction;
  readonly onOpenDiff: (filePath: string) => void;
  readonly onOpenFile: (relativePath: string) => void;
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
          cwd={props.cwd}
          runAction={props.runAction}
          onOpenDiff={props.onOpenDiff}
          onOpenFile={props.onOpenFile}
        />
      ))}
    </div>
  );
}
