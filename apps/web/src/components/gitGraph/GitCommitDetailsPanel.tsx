import type {
  EnvironmentId,
  GitGraphCommitDetails,
  GitGraphDiffFile,
  GitGraphDiffInput,
  GitGraphRef,
  GitGraphTagDetails,
} from "@t3tools/contracts";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  Tag,
  X,
} from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { gitGraphEnvironment } from "~/state/gitGraph";
import { useEnvironmentQuery } from "~/state/query";

import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { GitCommitMessage } from "./GitCommitMessage";
import { GitGraphPatchView } from "./GitGraphPatchView";
import { formatGitGraphDateTime, formatGitGraphRelative, shortHash } from "./gitGraphFormat";

type DiffStyle = "unified" | "split";

const ADDITIONS = (files: readonly GitGraphDiffFile[]) =>
  files.reduce((total, file) => total + file.additions, 0);
const DELETIONS = (files: readonly GitGraphDiffFile[]) =>
  files.reduce((total, file) => total + file.deletions, 0);

const STATUS_LETTER: Record<GitGraphDiffFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  untracked: "U",
  conflicted: "!",
};

const STATUS_CLASS: Record<GitGraphDiffFile["status"], string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-destructive",
  renamed: "text-info",
  copied: "text-info",
  "type-changed": "text-warning",
  untracked: "text-success",
  conflicted: "text-destructive",
};

const SIGNATURE_LABEL: Record<string, { readonly label: string; readonly className: string }> = {
  G: { label: "Good signature", className: "text-success" },
  U: { label: "Good signature, untrusted key", className: "text-warning" },
  B: { label: "Bad signature", className: "text-destructive" },
  X: { label: "Signature expired", className: "text-warning" },
  Y: { label: "Signing key expired", className: "text-warning" },
  R: { label: "Revoked signing key", className: "text-destructive" },
  E: { label: "Signature cannot be checked", className: "text-warning" },
};

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1_500);
    });
  };
  return { copied, copy };
}

function IconAction(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly side?: "top" | "bottom" | "left";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            aria-label={props.label}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side={props.side ?? "bottom"}>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function MetaRow(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-muted-foreground">{props.label}</span>
      <span className="min-w-0 flex-1 break-words">{props.children}</span>
    </div>
  );
}

/** A relative date that shows its exact timestamp in a tooltip. */
function RelativeDate(props: { readonly unixSeconds: number }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-default" />}>
        {formatGitGraphRelative(props.unixSeconds)}
      </TooltipTrigger>
      <TooltipPopup>{formatGitGraphDateTime(props.unixSeconds)}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * A tag's own details. Git Graph opens this when a tag chip is clicked, because an annotated
 * tag carries a message, a tagger and a date that the commit itself does not have.
 */
function TagDetailsBlock(props: { readonly tag: GitGraphTagDetails }) {
  const { tag } = props;
  return (
    <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
      <div className="flex items-center gap-1 font-medium">
        <Tag className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{tag.name}</span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {tag.annotated ? "annotated" : "lightweight"}
        </span>
      </div>
      {tag.annotated ? (
        <>
          <MetaRow label="Tagger">
            {tag.tagger ?? "Unknown"}
            {tag.taggerEmail ? (
              <span className="text-muted-foreground"> &lt;{tag.taggerEmail}&gt;</span>
            ) : null}
          </MetaRow>
          {tag.taggerTime !== null ? (
            <MetaRow label="Tagged">
              <RelativeDate unixSeconds={tag.taggerTime} />
            </MetaRow>
          ) : null}
          {tag.message.trim().length > 0 ? (
            <p className="whitespace-pre-wrap break-words text-muted-foreground">{tag.message}</p>
          ) : null}
        </>
      ) : (
        <p className="text-2xs text-muted-foreground">
          A lightweight tag: it points at this commit without its own message.
        </p>
      )}
    </div>
  );
}

function DiffStyleToggle(props: {
  readonly value: DiffStyle;
  readonly onChange: (v: DiffStyle) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Diff layout"
      size="sm"
      variant="segmented"
      value={[props.value]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "unified" || next === "split") props.onChange(next);
      }}
    >
      <Toggle aria-label="Stacked diff view" value="unified">
        <span className="text-2xs">Unified</span>
      </Toggle>
      <Toggle aria-label="Split diff view" value="split">
        <span className="text-2xs">Split</span>
      </Toggle>
    </ToggleGroup>
  );
}

/** A patch rendered with the same viewer the Diff tab uses, so it looks and scrolls the same. */
function PatchView(props: {
  readonly patch: string;
  readonly cacheScope: string;
  readonly diffStyle: DiffStyle;
}) {
  return (
    <GitGraphPatchView
      patch={props.patch}
      cacheScope={props.cacheScope}
      diffStyle={props.diffStyle}
    />
  );
}

function CommitFileRow(props: {
  readonly file: GitGraphDiffFile;
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly onOpenDiff: () => void;
  readonly onOpenFile: () => void;
}) {
  const { file } = props;
  return (
    <div
      className={cn(
        "group flex h-6 items-center gap-1 pr-1 pl-2 hover:bg-accent/60",
        props.selected && "bg-accent",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
        onClick={props.onToggle}
      >
        <span
          className={cn(
            "w-3 shrink-0 text-center font-mono font-semibold",
            STATUS_CLASS[file.status],
          )}
        >
          {STATUS_LETTER[file.status]}
        </span>
        <span
          className={cn("min-w-0 truncate", file.status === "deleted" && "line-through opacity-70")}
        >
          {file.oldPath !== null && file.oldPath !== file.path ? (
            <span className="text-muted-foreground">{file.oldPath} → </span>
          ) : null}
          {file.path}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1 tabular-nums">
        {file.binary ? (
          <span className="text-2xs text-muted-foreground">binary</span>
        ) : (
          <>
            <span className="text-success">+{file.additions}</span>
            <span className="text-destructive">-{file.deletions}</span>
          </>
        )}
      </span>
      <span className="hidden shrink-0 items-center group-hover:flex">
        <IconAction label="Open in Diff tab" side="left" onClick={props.onOpenDiff}>
          <GitCommitHorizontal />
        </IconAction>
        {file.status !== "deleted" ? (
          <IconAction label="Open file" side="left" onClick={props.onOpenFile}>
            <FileText />
          </IconAction>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Git Graph's commit details view: who wrote a commit and when, its message, its tags, the
 * files it touched, and the patch. One file's patch loads on its own, so a large commit is
 * browsed rather than sent whole.
 */
export function GitCommitDetailsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly hash: string;
  readonly refs: readonly GitGraphRef[];
  readonly host: string | null;
  readonly visible: boolean;
  readonly selectedTag: string | null;
  readonly onClose: () => void;
  readonly onOpenDiff: (filePath: string) => void;
  readonly onOpenFile: (relativePath: string) => void;
  readonly onCheckout: (ref: string) => void;
  readonly onCreateBranch: (startPoint: string, label: string) => void;
  readonly onCreateTag: (hash: string) => void;
  readonly onCompareToParent: (hash: string) => void;
  readonly onSelectTag: (name: string | null) => void;
  /** Walks the commit list, which is what Up and Down do in Git Graph's details view. */
  readonly onNavigate: (direction: "older" | "newer") => void;
  readonly canNavigateOlder: boolean;
  readonly canNavigateNewer: boolean;
}) {
  const { environmentId, cwd, hash, visible } = props;
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
  const [filesOpen, setFilesOpen] = useState(true);
  const [patchOpen, setPatchOpen] = useState(false);
  // The parent keys this panel on the hash, so a new commit starts from a fresh file list
  // rather than the previous commit's open file.
  const { copied, copy } = useCopy();

  const commit = useEnvironmentQuery(
    cwd === null || !visible
      ? null
      : gitGraphEnvironment.commit({ environmentId, input: { cwd, hash } }),
  );
  const tag = useEnvironmentQuery(
    cwd === null || !visible || props.selectedTag === null
      ? null
      : gitGraphEnvironment.tag({
          environmentId,
          input: { cwd, name: props.selectedTag },
        }),
  );
  const fileDiff = useEnvironmentQuery(
    cwd === null || !visible || selectedFile === null
      ? null
      : gitGraphEnvironment.diff({
          environmentId,
          input: {
            cwd,
            target: { _tag: "commit", hash },
            file: {
              path: selectedFile,
              oldPath:
                commit.data?.files.find((file) => file.path === selectedFile)?.oldPath ?? null,
            },
          } satisfies GitGraphDiffInput,
        }),
  );
  const wholeDiff = useEnvironmentQuery(
    cwd === null || !visible || !patchOpen || selectedFile !== null
      ? null
      : gitGraphEnvironment.diff({
          environmentId,
          input: { cwd, target: { _tag: "commit", hash } },
        }),
  );

  // A new commit starts from its file list, not the previous commit's open file. The panel is
  // keyed on the hash by its parent, so this state is already fresh per commit.
  const details: GitGraphCommitDetails | null = commit.data;
  const signature =
    details === null || details.signature === null ? null : SIGNATURE_LABEL[details.signature.code];

  return (
    <aside className="flex w-[min(34rem,46%)] min-w-80 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <GitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-2xs">{hash}</span>
        <IconAction
          label={copied === "hash" ? "Copied" : "Copy commit hash"}
          onClick={() => copy(hash, "hash")}
        >
          <Copy />
        </IconAction>
        <IconAction label="Close commit details" onClick={props.onClose}>
          <X />
        </IconAction>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {commit.error && !details ? (
          <div className="p-3 text-destructive">{commit.error}</div>
        ) : null}
        {details !== null ? (
          <div className="space-y-2 px-3 py-2">
            <GitCommitMessage
              message={details.subject}
              host={props.host}
              className="font-medium break-words"
            />
            {details.body.trim().length > 0 ? (
              <GitCommitMessage
                message={details.body}
                host={props.host}
                className="space-y-1 text-muted-foreground"
              />
            ) : null}
            <div className="space-y-1 border-t border-border/60 pt-2">
              <MetaRow label="Author">
                {details.author}
                <span className="text-muted-foreground"> &lt;{details.authorEmail}&gt;</span>
              </MetaRow>
              <MetaRow label="Authored">
                <RelativeDate unixSeconds={details.authorTime} />
              </MetaRow>
              {details.committer !== details.author ||
              details.committerEmail !== details.authorEmail ? (
                <MetaRow label="Committer">
                  {details.committer}
                  <span className="text-muted-foreground"> &lt;{details.committerEmail}&gt;</span>
                </MetaRow>
              ) : null}
              {details.commitTime !== details.authorTime ? (
                <MetaRow label="Committed">
                  <RelativeDate unixSeconds={details.commitTime} />
                </MetaRow>
              ) : null}
              <MetaRow label="Commit">
                <span className="font-mono">{shortHash(details.hash, 12)}</span>
              </MetaRow>
              {details.parents.length > 0 ? (
                <MetaRow label="Parents">
                  <span className="font-mono">
                    {details.parents.map((p) => shortHash(p)).join(", ")}
                  </span>
                </MetaRow>
              ) : (
                <MetaRow label="Parents">
                  <span className="text-muted-foreground">None (root commit)</span>
                </MetaRow>
              )}
              {details.signature !== null ? (
                <MetaRow label="Signature">
                  <span className={signature?.className ?? "text-muted-foreground"}>
                    {signature?.label ?? details.signature.code}
                  </span>
                  {details.signature.signer ? (
                    <span className="text-muted-foreground"> · {details.signature.signer}</span>
                  ) : null}
                </MetaRow>
              ) : null}
            </div>
            {props.refs.filter((ref) => ref.kind !== "tag").length > 0 ? (
              <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
                {props.refs
                  .filter((ref) => ref.kind !== "tag")
                  .map((ref) => (
                    <button
                      key={ref.fullName}
                      type="button"
                      className="inline-flex items-center gap-1 rounded-sm border border-border px-1 text-2xs leading-4 hover:bg-accent"
                      onClick={() => props.onCheckout(ref.fullName)}
                    >
                      <GitBranch className="size-3 text-muted-foreground" />
                      {ref.name}
                    </button>
                  ))}
              </div>
            ) : null}
            {props.refs.filter((ref) => ref.kind === "tag").length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                {props.refs
                  .filter((ref) => ref.kind === "tag")
                  .map((ref) => (
                    <button
                      key={ref.fullName}
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm border border-border px-1 text-2xs leading-4 hover:bg-accent",
                        props.selectedTag === ref.name && "bg-accent",
                      )}
                      onClick={() =>
                        props.onSelectTag(props.selectedTag === ref.name ? null : ref.name)
                      }
                    >
                      <Tag className="size-3 text-muted-foreground" />
                      {ref.name}
                    </button>
                  ))}
              </div>
            ) : null}
            {props.selectedTag !== null && tag.data !== null ? (
              <TagDetailsBlock tag={tag.data} />
            ) : null}
            <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => props.onCreateBranch(hash, `commit ${shortHash(hash)}`)}
              >
                <GitBranch />
                Branch here
              </Button>
              <Button size="xs" variant="outline" onClick={() => props.onCreateTag(hash)}>
                <Tag />
                Tag
              </Button>
              {details.parents.length > 0 ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => props.onCompareToParent(details.parents[0]!)}
                >
                  Compare with parent
                </Button>
              ) : null}
            </div>
          </div>
        ) : commit.isPending ? null : (
          <div className="p-3 text-muted-foreground">Select a commit to see its details.</div>
        )}
        {details !== null ? (
          <div className="border-t border-border">
            <div className="flex h-7 items-center gap-1 px-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-left text-muted-foreground hover:text-foreground"
                onClick={() => setFilesOpen((open) => !open)}
              >
                {filesOpen ? (
                  <ChevronDown className="size-3 shrink-0" />
                ) : (
                  <ChevronRight className="size-3 shrink-0" />
                )}
                <span className="truncate">
                  {details.files.length} {details.files.length === 1 ? "file" : "files"}
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-1 text-2xs tabular-nums">
                <span className="text-success">+{ADDITIONS(details.files)}</span>
                <span className="text-destructive">-{DELETIONS(details.files)}</span>
              </span>
            </div>
            {filesOpen && details.files.length === 0 ? (
              <div className="px-3 pb-2 text-muted-foreground">No file changes.</div>
            ) : null}
            {filesOpen
              ? details.files.map((file) => (
                  <CommitFileRow
                    key={`${file.oldPath ?? ""}\u0000${file.path}`}
                    file={file}
                    selected={selectedFile === file.path}
                    onToggle={() =>
                      setSelectedFile((current) => (current === file.path ? null : file.path))
                    }
                    onOpenDiff={() => props.onOpenDiff(file.path)}
                    onOpenFile={() => props.onOpenFile(file.path)}
                  />
                ))
              : null}
            {selectedFile !== null ? (
              <div className="border-t border-border">
                <div className="flex h-7 items-center gap-1 px-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-2xs">{selectedFile}</span>
                  <DiffStyleToggle value={diffStyle} onChange={setDiffStyle} />
                  <IconAction label="Close file diff" onClick={() => setSelectedFile(null)}>
                    <X />
                  </IconAction>
                </div>
                {fileDiff.error && !fileDiff.data ? (
                  <div className="p-3 text-destructive">{fileDiff.error}</div>
                ) : fileDiff.data === null ? (
                  <div className="px-3 pb-2 text-muted-foreground">Loading…</div>
                ) : (
                  <div className="border-t border-border/60">
                    <PatchView
                      patch={fileDiff.data.patch}
                      cacheScope={`git-graph:file:${hash}:${selectedFile}`}
                      diffStyle={diffStyle}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="border-t border-border">
                <div className="flex h-7 items-center gap-1 px-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1 text-left text-muted-foreground hover:text-foreground"
                    onClick={() => setPatchOpen((open) => !open)}
                  >
                    {patchOpen ? (
                      <ChevronDown className="size-3 shrink-0" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0" />
                    )}
                    <span className="truncate">Complete patch</span>
                  </button>
                  {patchOpen ? <DiffStyleToggle value={diffStyle} onChange={setDiffStyle} /> : null}
                </div>
                {patchOpen ? (
                  wholeDiff.error && !wholeDiff.data ? (
                    <div className="p-3 text-destructive">{wholeDiff.error}</div>
                  ) : wholeDiff.data === null ? (
                    <div className="px-3 pb-2 text-muted-foreground">Loading…</div>
                  ) : (
                    <div className="border-t border-border/60">
                      <PatchView
                        patch={wholeDiff.data.patch}
                        cacheScope={`git-graph:commit:${hash}`}
                        diffStyle={diffStyle}
                      />
                    </div>
                  )
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-1 border-t border-border px-2 py-1">
        <span className="text-2xs text-muted-foreground">
          {details !== null ? formatGitGraphDateTime(details.authorTime) : ""}
        </span>
        <div className="flex items-center gap-1">
          <IconAction
            label="Older commit"
            onClick={() => props.canNavigateOlder && props.onNavigate("older")}
          >
            <ArrowDown />
          </IconAction>
          <IconAction
            label="Newer commit"
            onClick={() => props.canNavigateNewer && props.onNavigate("newer")}
          >
            <ArrowUp />
          </IconAction>
        </div>
      </div>
    </aside>
  );
}
