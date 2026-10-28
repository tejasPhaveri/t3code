import {
  type EnvironmentId,
  GIT_GRAPH_MAX_COMMITS,
  GIT_GRAPH_PAGE_SIZE,
  type GitGraphLogOrder,
  type GitGraphRef,
  ProjectId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { ChevronDown, CloudDownload, GitBranch, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { observeResize } from "~/lib/observeResize";
import { readLocalApi } from "~/localApi";
import { gitGraphEnvironment } from "~/state/gitGraph";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { type TextPrompt, TextPromptDialog } from "../TextPromptDialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  branchFilterOptions,
  branchFilterRefs,
  DEFAULT_BRANCH_FILTER,
  describeBranchFilter,
  type BranchFilterState,
} from "./gitGraphBranches";
import { buildFindableRows, findMatchingRows, stepMatch } from "./gitGraphFind";
import { gitGraphColor, shortHash } from "./gitGraphFormat";
import { GraphRow, GraphWindow, ROW_HEIGHT } from "./GitGraphCanvas";
import {
  buildGitGraphRows,
  findChildRow,
  type GitGraphBranchLabel,
  type GitGraphRowItem,
} from "./gitGraphRows";
import { GitComparePanel } from "./GitComparePanel";
import { GitCommitDetailsPanel } from "./GitCommitDetailsPanel";
import { GitGraphRemotesDialog } from "./GitGraphRemotesDialog";
import { GitSourceControl } from "./GitSourceControl";
import { confirmGitGraphAction, useGitGraphAction } from "./useGitGraphAction";

const OVERSCAN_ROWS = 12;
const LANE_WIDTH = 14;
const BACKGROUND_REFRESH_MS = 10_000;

type RowMenuAction =
  | "checkout"
  | "merge"
  | "create-branch"
  | "create-tag"
  | "copy-hash"
  | "copy-subject"
  | "compare"
  | "cherry-pick"
  | "revert"
  | "reset-soft"
  | "reset-mixed"
  | "reset-hard"
  | "drop"
  | "stash"
  | "stash-apply"
  | "stash-pop"
  | "stash-drop"
  | "view-details";

type BranchMenuAction =
  | "checkout"
  | "merge"
  | "rebase"
  | "create-branch"
  | "rename"
  | "delete"
  | "push"
  | "push-force"
  | "compare-with-head"
  | "copy-name";

type TagMenuAction = "details" | "delete" | "push" | "checkout" | "copy-name" | "create-branch";

/** The repository's web page, from its first remote, so issue numbers can become links. */
function repositoryHost(remoteUrls: readonly string[]): string | null {
  for (const url of remoteUrls) {
    const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(url);
    if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
    const https = /^(https?:\/\/[^/]+)\/(.+?)(?:\.git)?$/.exec(url);
    if (https) return `${https[1]}/${https[2]}`;
    const git = /^git:\/\/([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
    if (git) return `https://${git[1]}/${git[2]}`;
  }
  return null;
}

export function GitGraphPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | null;
  readonly projectId: string | null;
  readonly visible: boolean;
  readonly onOpenDiff: (filePath: string) => void;
  readonly onOpenFile: (relativePath: string) => void;
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
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [order, setOrder] = useState<GitGraphLogOrder>("topo");
  const [firstParent, setFirstParent] = useState(false);
  const [branchFilter, setBranchFilter] = useState<BranchFilterState>(DEFAULT_BRANCH_FILTER);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const openPrLink = useOpenPrLink(props.threadRef);

  const log = useEnvironmentQuery(
    cwd === null
      ? null
      : gitGraphEnvironment.log({
          environmentId,
          input: {
            cwd,
            maxCount,
            showRemoteBranches: true,
            order,
            firstParent,
          },
        }),
  );
  const worktrees = useEnvironmentQuery(
    cwd === null ? null : gitGraphEnvironment.worktrees({ environmentId, input: { cwd } }),
  );
  const remotes = useEnvironmentQuery(
    cwd === null ? null : gitGraphEnvironment.remotes({ environmentId, input: { cwd } }),
  );
  const pullRequests = useEnvironmentQuery(
    props.projectId === null
      ? null
      : pullRequestEnvironment.list({
          environmentId,
          input: { state: "open", projectId: ProjectId.make(props.projectId), limit: 200 },
        }),
  );

  const branchOptions = branchFilterOptions(log.data?.refs ?? [], log.data?.head?.branch ?? null);
  const filteredRefs = branchFilterRefs(branchFilter, branchOptions);
  const host = repositoryHost(
    (remotes.data?.remotes ?? []).flatMap((remote) => [remote.fetchUrl ?? ""]),
  );

  // Filtering is a separate log query scoped to the chosen refs, so the full graph stays cached.
  const filteredLog = useEnvironmentQuery(
    cwd === null || filteredRefs === undefined
      ? null
      : gitGraphEnvironment.log({
          environmentId,
          input: {
            cwd,
            maxCount,
            showRemoteBranches: true,
            order,
            firstParent,
            refs: [...filteredRefs],
          },
        }),
  );
  const activeLog = filteredRefs === undefined ? log : filteredLog;
  // While a filtered query is in flight the unfiltered commits must not stand in for it, or
  // the graph would show branches the filter excludes.
  const activeModel = activeLog.data ? buildGitGraphRows(activeLog.data) : null;
  const activeItems = activeModel?.items ?? [];

  const pullRequestByBranch = new Map(
    (pullRequests.data?.entries ?? []).map((entry) => [entry.headBranch, entry] as const),
  );
  const refreshLog = log.refresh;
  const refreshFilteredLog = filteredLog.refresh;
  const refreshWorktrees = worktrees.refresh;
  const refreshRemotes = remotes.refresh;
  const refreshAll = useStableCallback(() => {
    refreshLog();
    if (filteredRefs !== undefined) refreshFilteredLog();
    refreshWorktrees();
    refreshRemotes();
  });
  const runAction = useGitGraphAction({ environmentId, cwd, onSettled: refreshAll });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refreshes the graph on a timer while the panel is visible
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Observes the scroller height so the graph rows can size to it
  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    return observeResize(element, ([entry]) =>
      setViewportHeight(Math.round(entry?.contentRect.height ?? 0)),
    );
  }, []);

  const graphWidth = Math.max(1, Math.min(activeModel?.layout.laneCount ?? 1, 24)) * LANE_WIDTH + 8;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const end = Math.min(
    activeItems.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );

  const scrollToRow = (row: number) => {
    const element = scrollerRef.current;
    if (!element) return;
    const top = row * ROW_HEIGHT;
    const height = element.clientHeight;
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + height) {
      element.scrollTop = Math.max(0, top - height / 2 + ROW_HEIGHT / 2);
    }
  };

  const findRows = buildFindableRows(activeItems);
  const findMatches = findMatchingRows(findRows, findQuery);
  const findMatchSet = new Set(findMatches);
  const currentMatch = findMatches[findIndex] ?? null;

  const jumpToMatch = (row: number | null) => {
    if (row === null) return;
    const item = activeItems[row];
    if (item?.kind === "commit") {
      setSelectedKey(item.commit.hash);
      setDetailsOpen(true);
      setCompareBase(null);
    }
    scrollToRow(row);
  };

  const moveMatch = (step: 1 | -1) => {
    const target = stepMatch(findMatches, currentMatch ?? -1, step);
    if (target === null) return;
    setFindIndex(findMatches.indexOf(target));
    jumpToMatch(target);
  };

  const scrollToHead = () => {
    const head = log.data?.head?.hash;
    if (head === undefined || activeModel === null) return;
    const row = activeModel.rowByHash.get(head);
    if (row === undefined) return;
    scrollToRow(row);
    setSelectedKey(head);
  };

  const scrollToStash = (direction: 1 | -1) => {
    const rows = activeItems.flatMap((item, index) => (item.kind === "stash" ? [index] : []));
    if (rows.length === 0) return;
    const currentRow = scrollTop / ROW_HEIGHT;
    const target =
      direction === 1
        ? (rows.find((row) => row > currentRow) ?? rows[0]!)
        : (rows.toReversed().find((row) => row < currentRow) ?? rows.at(-1)!);
    scrollToRow(target);
  };

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

  const promptCreateTag = (hash: string) =>
    setPrompt({
      title: "Create tag",
      description: `On commit ${shortHash(hash)}. Leave the message empty for a lightweight tag.`,
      placeholder: "v1.0.0",
      initialValue: "",
      confirmLabel: "Create tag",
      checkbox: { label: "Push the tag to origin", initial: false },
      onConfirm: (name, push) =>
        void runAction({ _tag: "CreateTag", name, hash, push }, { success: `Tagged ${name}` }),
    });

  const promptRenameBranch = (name: string) =>
    setPrompt({
      title: "Rename branch",
      description: `Renames ${name}.`,
      placeholder: "new-name",
      initialValue: name,
      confirmLabel: "Rename",
      onConfirm: (newName) =>
        void runAction(
          { _tag: "RenameBranch", name, newName },
          { success: `Renamed to ${newName}` },
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

  const onRowClick = (event: MouseEvent, item: GitGraphRowItem, row: number) => {
    if (item.kind !== "commit") {
      setSelectedKey(item.key);
      return;
    }
    // Ctrl/Cmd-click starts a comparison, as Git Graph does.
    if (event.metaKey || event.ctrlKey) {
      setCompareBase((current) => (current === null ? item.commit.hash : null));
      setSelectedKey(item.commit.hash);
      return;
    }
    setSelectedKey(item.commit.hash);
    setDetailsOpen(true);
    setSelectedTag(null);
    setCompareBase(null);
    scrollToRow(row);
  };

  const onRowContextMenu = async (event: MouseEvent, item: GitGraphRowItem) => {
    setSelectedKey(item.key);
    if (item.kind === "uncommitted") {
      const choice = await showMenu<RowMenuAction>(event, [
        { id: "view-details", label: `${item.fileCount} uncommitted changes` },
        { id: "stash", label: "Stash changes…", separatorBefore: true },
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
        { id: "copy-hash", label: "Copy stash hash" },
        { id: "stash-drop", label: "Drop stash…", destructive: true, separatorBefore: true },
      ]);
      if (choice === "stash-apply") {
        void runAction({ _tag: "StashApply", selector }, { success: `Applied ${selector}` });
      } else if (choice === "stash-pop") {
        void runAction({ _tag: "StashPop", selector }, { success: `Popped ${selector}` });
      } else if (choice === "create-branch") {
        promptCreateBranch(item.stash.baseHash, `the commit ${selector} was made on`);
      } else if (choice === "copy-hash") {
        void navigator.clipboard.writeText(item.stash.hash);
      } else if (choice === "stash-drop") {
        if (await confirmGitGraphAction(`Drop ${selector}?\nIts changes are deleted.`)) {
          void runAction({ _tag: "StashDrop", selector }, { success: `Dropped ${selector}` });
        }
      }
      return;
    }
    const { hash, subject } = item.commit;
    const isHead = item.commit.hash === log.data?.head?.hash;
    const row = activeModel?.rowByHash.get(hash) ?? -1;
    const childRow = activeModel === null ? null : findChildRow(activeModel, row);
    const choice = await showMenu<RowMenuAction>(event, [
      { id: "view-details", label: "View commit details" },
      { id: "checkout", label: "Check out this commit (detached)" },
      mergeEntry(isHead),
      { id: "create-branch", label: "Create branch here…" },
      { id: "create-tag", label: "Create tag here…" },
      {
        id: "compare",
        label:
          compareBase === null ? "Compare with another commit (Ctrl-click)" : "Cancel comparison",
        separatorBefore: true,
      },
      {
        id: "cherry-pick",
        label: `Cherry-pick onto ${currentBranch ?? "current branch"}`,
        disabled: isHead,
      },
      { id: "revert", label: "Revert this commit" },
      {
        id: "drop",
        label: "Drop this commit…",
        destructive: true,
        // Dropping rewrites every commit after this one on the branch, so it is only offered
        // where there is a single line to rewrite.
        disabled: childRow === null,
      },
      { id: "reset-soft", label: "Reset to here (keep changes staged)…", separatorBefore: true },
      { id: "reset-mixed", label: "Reset to here (keep changes unstaged)…" },
      { id: "reset-hard", label: "Reset to here (discard changes)…", destructive: true },
      { id: "copy-hash", label: "Copy commit hash", separatorBefore: true },
      { id: "copy-subject", label: "Copy message" },
    ]);
    switch (choice) {
      case "view-details":
        setDetailsOpen(true);
        setSelectedTag(null);
        break;
      case "checkout":
        void runAction(
          { _tag: "Checkout", ref: hash },
          { success: `Checked out ${shortHash(hash)}` },
        );
        break;
      case "merge":
        void mergeIntoCurrent(hash, `commit ${shortHash(hash)}`);
        break;
      case "create-branch":
        promptCreateBranch(hash, `commit ${shortHash(hash)}`);
        break;
      case "create-tag":
        promptCreateTag(hash);
        break;
      case "compare":
        setCompareBase((current) => (current === null ? hash : null));
        break;
      case "cherry-pick":
        void runAction(
          { _tag: "CherryPick", hash },
          { success: `Cherry-picked ${shortHash(hash)}` },
        );
        break;
      case "revert":
        void runAction({ _tag: "Revert", hash }, { success: `Reverted ${shortHash(hash)}` });
        break;
      case "drop":
        if (await confirmGitGraphAction(`Drop commit ${shortHash(hash)}?\n${subject}`)) {
          void runAction({ _tag: "DropCommit", hash }, { success: `Dropped ${shortHash(hash)}` });
        }
        break;
      case "reset-soft":
      case "reset-mixed":
      case "reset-hard": {
        const mode = choice === "reset-soft" ? "soft" : choice === "reset-mixed" ? "mixed" : "hard";
        const warning =
          mode === "hard"
            ? `\nThis discards every uncommitted change and can't be undone.`
            : mode === "mixed"
              ? "\nUncommitted changes are kept, unstaged."
              : "\nUncommitted changes are kept and staged.";
        if (
          await confirmGitGraphAction(
            `Reset ${currentBranch ?? "the branch"} to ${shortHash(hash)}?${warning}`,
            mode === "hard" ? "destructive" : "default",
          )
        ) {
          void runAction(
            { _tag: "Reset", ref: hash, mode },
            { success: `Reset to ${shortHash(hash)}` },
          );
        }
        break;
      }
      case "copy-hash":
        void navigator.clipboard.writeText(hash);
        break;
      case "copy-subject":
        void navigator.clipboard.writeText(subject);
        break;
      default:
        break;
    }
  };

  const onBranchContextMenu = async (event: MouseEvent, branch: GitGraphBranchLabel) => {
    if (branch.kind === "remote") {
      const choice = await showMenu<BranchMenuAction>(event, [
        { id: "checkout", label: "Check out as local branch…" },
        mergeEntry(false),
        { id: "create-branch", label: "Create branch from here…" },
        {
          id: "compare-with-head",
          label: "Compare with the checked-out branch",
          separatorBefore: true,
        },
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
      } else if (choice === "compare-with-head") {
        const headCommit = log.data?.head?.hash;
        const remoteCommit = activeItems.find(
          (item) =>
            item.kind === "commit" &&
            item.branches.some((label) => label.fullName === branch.fullName),
        );
        if (headCommit !== undefined && remoteCommit?.kind === "commit") {
          setCompareBase(remoteCommit.commit.hash);
          setSelectedKey(headCommit);
          setDetailsOpen(true);
        }
      } else if (choice === "copy-name") {
        void navigator.clipboard.writeText(branch.name);
      }
      return;
    }
    const choice = await showMenu<BranchMenuAction>(event, [
      { id: "checkout", label: "Check out", disabled: branch.checkedOut },
      mergeEntry(branch.checkedOut),
      { id: "rebase", label: "Rebase onto this branch…", disabled: branch.checkedOut },
      { id: "create-branch", label: "Create branch from here…" },
      { id: "push", label: "Push", disabled: !branch.checkedOut, separatorBefore: true },
      { id: "push-force", label: "Force push (with lease)", disabled: !branch.checkedOut },
      { id: "rename", label: "Rename…", separatorBefore: true },
      { id: "delete", label: "Delete…", destructive: true, disabled: branch.checkedOut },
      { id: "copy-name", label: "Copy branch name", separatorBefore: true },
    ]);
    switch (choice) {
      case "checkout":
        void runAction(
          { _tag: "Checkout", ref: branch.fullName },
          { success: `Checked out ${branch.name}` },
        );
        break;
      case "merge":
        void mergeIntoCurrent(branch.fullName, branch.name);
        break;
      case "rebase": {
        if (
          await confirmGitGraphAction(
            `Rebase the checked-out branch onto ${branch.name}?\nThis rewrites its commits.`,
            "default",
          )
        ) {
          void runAction(
            { _tag: "Rebase", ref: branch.fullName },
            { success: `Rebased onto ${branch.name}` },
          );
        }
        break;
      }
      case "create-branch":
        promptCreateBranch(branch.fullName, branch.name);
        break;
      case "push":
        void runAction(
          { _tag: "Push", branch: branch.name, force: false },
          { success: `Pushed ${branch.name}` },
        );
        break;
      case "push-force":
        void runAction(
          { _tag: "Push", branch: branch.name, force: true },
          { success: `Force pushed ${branch.name}` },
        );
        break;
      case "rename":
        promptRenameBranch(branch.name);
        break;
      case "delete":
        if (
          await confirmGitGraphAction(
            `Delete the branch ${branch.name}?\nCommits on it that are on no other branch are lost.`,
          )
        ) {
          void runAction(
            { _tag: "DeleteBranch", name: branch.name, force: true },
            { success: `Deleted ${branch.name}` },
          );
        }
        break;
      case "copy-name":
        void navigator.clipboard.writeText(branch.name);
        break;
      default:
        break;
    }
  };

  const onTagContextMenu = async (event: MouseEvent, tag: GitGraphRef) => {
    event.preventDefault();
    event.stopPropagation();
    const choice = await showMenu<TagMenuAction>(event, [
      { id: "details", label: "View tag details" },
      { id: "checkout", label: "Check out this commit (detached)" },
      { id: "create-branch", label: "Create branch from here…" },
      { id: "push", label: "Push tag to origin", separatorBefore: true },
      { id: "delete", label: "Delete tag…", destructive: true },
      { id: "copy-name", label: "Copy tag name", separatorBefore: true },
    ]);
    switch (choice) {
      case "details":
        setSelectedKey(tag.hash);
        setSelectedTag(tag.name);
        setDetailsOpen(true);
        break;
      case "checkout":
        void runAction({ _tag: "Checkout", ref: tag.hash }, { success: `Checked out ${tag.name}` });
        break;
      case "create-branch":
        promptCreateBranch(tag.fullName, `tag ${tag.name}`);
        break;
      case "push":
        void runAction({ _tag: "PushTag", name: tag.name }, { success: `Pushed ${tag.name}` });
        break;
      case "delete":
        if (await confirmGitGraphAction(`Delete the tag ${tag.name}?`)) {
          void runAction({ _tag: "DeleteTag", name: tag.name }, { success: `Deleted ${tag.name}` });
        }
        break;
      case "copy-name":
        void navigator.clipboard.writeText(tag.name);
        break;
      default:
        break;
    }
  };

  const fetchAll = async () => {
    setFetching(true);
    await runAction({ _tag: "Fetch" });
    setFetching(false);
  };

  // Git Graph's keyboard shortcuts: find, jump to HEAD, refresh, and stash navigation.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Binds window-level keydown listeners while the panel is visible
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "f") {
        event.preventDefault();
        setFindOpen(true);
        findInputRef.current?.focus();
        findInputRef.current?.select();
        return;
      }
      if (key === "h") {
        event.preventDefault();
        scrollToHead();
        return;
      }
      if (key === "r") {
        event.preventDefault();
        setRefreshRequestedAt(Date.now());
        refreshAll();
        return;
      }
      if (key === "s") {
        event.preventDefault();
        scrollToStash(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [refreshAll, scrollToHead, scrollToStash, visible]);

  const selectedItem =
    selectedKey === null ? null : (activeItems.find((item) => item.key === selectedKey) ?? null);
  const selectedCommitHash =
    selectedItem !== null && selectedItem.kind === "commit" ? selectedItem.commit.hash : null;
  const selectedRow =
    selectedCommitHash === null ? -1 : (activeModel?.rowByHash.get(selectedCommitHash) ?? -1);
  const selectedRefs: readonly GitGraphRef[] =
    selectedCommitHash === null
      ? []
      : (log.data?.refs.filter((ref) => ref.hash === selectedCommitHash) ?? []);

  const navigateCommit = (direction: "older" | "newer") => {
    if (selectedRow === -1) return;
    const nextRow = direction === "older" ? selectedRow + 1 : selectedRow - 1;
    const next = activeItems[nextRow];
    if (next?.kind !== "commit") return;
    setSelectedKey(next.commit.hash);
    setSelectedTag(null);
    scrollToRow(nextRow);
  };

  if (cwd === null) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Git Graph needs a project folder.</div>
    );
  }

  const graph = activeModel;
  const showDetails = detailsOpen && selectedCommitHash !== null;
  const compareHead =
    compareBase !== null && selectedCommitHash !== null && selectedCommitHash !== compareBase
      ? selectedCommitHash
      : null;

  return (
    <div className="flex h-full min-h-0 bg-background text-xs">
      <aside className="w-72 min-w-56 shrink-0 overflow-auto border-r border-border">
        <GitSourceControl
          worktrees={worktrees.data?.worktrees ?? null}
          error={worktrees.error}
          cwd={cwd}
          runAction={runAction}
          onOpenDiff={props.onOpenDiff}
          onOpenFile={props.onOpenFile}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="xs" variant="ghost-muted">
                  <GitBranch />
                  <span className="max-w-48 truncate">
                    {describeBranchFilter(branchFilter, branchOptions)}
                  </span>
                  <ChevronDown />
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
              <DropdownMenuRadioGroup
                value={branchFilter.mode}
                onValueChange={(value) => {
                  if (value === "all" || value === "selected" || value === "glob") {
                    setBranchFilter((current) => ({ ...current, mode: value }));
                  }
                }}
              >
                <DropdownMenuRadioItem value="all">Show all branches</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="selected">
                  Show selected branches
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="glob">
                  Show branches matching a pattern
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {branchFilter.mode === "glob" ? (
                <div className="px-2 py-1">
                  <Input
                    size="sm"
                    aria-label="Branch pattern"
                    placeholder="feature/*"
                    value={branchFilter.glob}
                    onChange={(event) =>
                      setBranchFilter((current) => ({ ...current, glob: event.target.value }))
                    }
                  />
                </div>
              ) : null}
              {branchFilter.mode === "selected"
                ? branchOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.fullName}
                      onClick={() =>
                        setBranchFilter((current) => {
                          const has = current.selected.includes(option.fullName);
                          return {
                            ...current,
                            selected: has
                              ? current.selected.filter((ref) => ref !== option.fullName)
                              : [...current.selected, option.fullName],
                          };
                        })
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">{option.name}</span>
                      {branchFilter.selected.includes(option.fullName) ? "✓" : null}
                    </DropdownMenuItem>
                  ))
                : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="xs" variant="ghost-muted">
                  Order
                  <ChevronDown />
                </Button>
              }
            />
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={order}
                onValueChange={(value) => {
                  if (value === "date" || value === "author" || value === "topo") setOrder(value);
                }}
              >
                <DropdownMenuRadioItem value="date">Commit date</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="author">Author date</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="topo">Topological</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setFirstParent((value) => !value)}>
                <span className="min-w-0 flex-1 truncate">First parent only</span>
                {firstParent ? "✓" : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ml-auto flex items-center gap-1">
            {findOpen ? (
              <div className="flex items-center gap-1 rounded-md border border-border px-1">
                <Search className="size-3 shrink-0 text-muted-foreground" />
                <Input
                  ref={findInputRef}
                  size="compact"
                  unstyled
                  className="w-40"
                  aria-label="Find commits"
                  placeholder="Find commits"
                  value={findQuery}
                  onChange={(event) => {
                    setFindQuery(event.target.value);
                    setFindIndex(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      moveMatch(event.shiftKey ? -1 : 1);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setFindOpen(false);
                      setFindQuery("");
                    }
                  }}
                />
                <span className="shrink-0 tabular-nums text-2xs text-muted-foreground">
                  {findMatches.length === 0
                    ? "0/0"
                    : `${Math.min(findIndex + 1, findMatches.length)}/${findMatches.length}`}
                </span>
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label="Previous match"
                  onClick={() => moveMatch(-1)}
                >
                  <ChevronDown className="rotate-180" />
                </Button>
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label="Next match"
                  onClick={() => moveMatch(1)}
                >
                  <ChevronDown />
                </Button>
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label="Close find"
                  onClick={() => {
                    setFindOpen(false);
                    setFindQuery("");
                  }}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      aria-label="Find commits"
                      onClick={() => {
                        setFindOpen(true);
                        window.setTimeout(() => findInputRef.current?.focus(), 0);
                      }}
                    />
                  }
                >
                  <Search />
                </TooltipTrigger>
                <TooltipPopup side="bottom">Find commits (⌘F)</TooltipPopup>
              </Tooltip>
            )}
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
              onClick={() => void runAction({ _tag: "Pull", mode: "merge" }, { success: "Pulled" })}
            >
              Pull
            </Button>
            <Button size="xs" variant="ghost-muted" onClick={() => setRemotesOpen(true)}>
              Remotes
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
                  (activeLog.isPending && activeLog.data === null) ||
                  (refreshRequestedAt !== null &&
                    activeLog.error === null &&
                    (activeLog.dataUpdatedAt < refreshRequestedAt ||
                      worktrees.dataUpdatedAt < refreshRequestedAt))
                }
              />
              Refresh
            </Button>
          </div>
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
          {activeLog.error && !activeLog.data ? (
            <div className="p-3 text-destructive">{activeLog.error}</div>
          ) : null}
          {activeLog.isPending && activeItems.length === 0 ? (
            <div className="p-3 text-muted-foreground">Loading commits…</div>
          ) : null}
          {!activeLog.isPending && activeLog.data !== null && activeItems.length === 0 ? (
            <div className="p-3 text-muted-foreground">
              {filteredRefs === undefined
                ? "This repository has no commits yet."
                : "No commits match the branch filter."}
            </div>
          ) : null}
          <div
            className="relative"
            style={{
              height: (activeItems.length + (activeLog.data?.hasMore ? 1 : 0)) * ROW_HEIGHT,
            }}
          >
            {activeItems.slice(start, end).map((item, offset) => {
              const index = start + offset;
              return (
                <GraphRow
                  key={item.key}
                  item={item}
                  index={index}
                  graphWidth={graphWidth}
                  color={gitGraphColor(graph!.layout.rows[index]!.color)}
                  selected={item.key === selectedKey}
                  isMatch={findMatchSet.has(index)}
                  isCurrentMatch={currentMatch === index}
                  pullRequestByBranch={pullRequestByBranch}
                  onClick={(event) => onRowClick(event, item, index)}
                  onContextMenu={(event) => void onRowContextMenu(event, item)}
                  onBranchContextMenu={(event, target) => void onBranchContextMenu(event, target)}
                  onTagClick={(tag) => {
                    setSelectedKey(tag.hash);
                    setSelectedTag(tag.name);
                    setDetailsOpen(true);
                  }}
                  onTagContextMenu={(event, tag) => void onTagContextMenu(event, tag)}
                  onOpenPullRequest={(event, url) => void openPrLink(event, url)}
                />
              );
            })}
            {graph ? (
              <GraphWindow
                layout={graph.layout}
                items={activeItems}
                start={start}
                end={end}
                width={graphWidth}
              />
            ) : null}
            {activeLog.data?.hasMore && end >= activeItems.length ? (
              <div
                className="absolute right-0 left-0 flex justify-center"
                style={{ top: activeItems.length * ROW_HEIGHT }}
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
        <div className="flex h-6 shrink-0 items-center justify-between gap-2 border-t border-border px-2 text-2xs text-muted-foreground">
          <span>
            {activeItems.length} commits
            {activeLog.data?.hasMore ? " (more available)" : ""}
          </span>
          <span className="truncate">
            {compareBase === null ? null : `Comparing from ${shortHash(compareBase)}`}
          </span>
        </div>
      </div>
      {showDetails && selectedCommitHash !== null ? (
        <GitCommitDetailsPanel
          key={selectedCommitHash}
          environmentId={environmentId}
          cwd={cwd}
          hash={selectedCommitHash}
          refs={selectedRefs}
          host={host}
          visible={visible}
          selectedTag={selectedTag}
          onClose={() => setDetailsOpen(false)}
          onOpenDiff={props.onOpenDiff}
          onOpenFile={props.onOpenFile}
          onCheckout={(ref) => void runAction({ _tag: "Checkout", ref })}
          onCreateBranch={promptCreateBranch}
          onCreateTag={promptCreateTag}
          onCompareToParent={(parentHash) => {
            setCompareBase(parentHash);
            setSelectedKey(selectedCommitHash);
          }}
          onSelectTag={setSelectedTag}
          onNavigate={navigateCommit}
          canNavigateOlder={selectedRow >= 0 && selectedRow + 1 < activeItems.length}
          canNavigateNewer={selectedRow > 0}
        />
      ) : null}
      {compareBase !== null && compareHead !== null ? (
        <GitComparePanel
          key={`${compareBase}:${compareHead}`}
          environmentId={environmentId}
          cwd={cwd}
          baseHash={compareBase}
          headHash={compareHead}
          visible={visible}
          onClose={() => setCompareBase(null)}
          onOpenDiff={props.onOpenDiff}
          onOpenFile={props.onOpenFile}
        />
      ) : null}
      {prompt ? <TextPromptDialog prompt={prompt} onClose={() => setPrompt(null)} /> : null}
      <GitGraphRemotesDialog
        environmentId={environmentId}
        cwd={cwd}
        open={remotesOpen}
        runAction={runAction}
        onClose={() => setRemotesOpen(false)}
      />
    </div>
  );
}
