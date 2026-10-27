import type { EnvironmentId, GitGraphDiffFile, GitGraphDiffInput } from "@t3tools/contracts";
import { ChevronDown, ChevronRight, FileText, GitCompareArrows, X } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { gitGraphEnvironment } from "~/state/gitGraph";
import { useEnvironmentQuery } from "~/state/query";

import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { GitGraphPatchView } from "./GitGraphPatchView";
import { shortHash } from "./gitGraphFormat";

type DiffStyle = "unified" | "split";

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

/** A patch drawn with the app's diff viewer, so a comparison looks like every other diff. */
function ComparisonPatch(props: {
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

/**
 * The comparison Git Graph opens when a second commit is Ctrl/Cmd-clicked: what changed between
 * two commits, file by file, with each file's own patch read on demand.
 */
export function GitComparePanel(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly baseHash: string;
  readonly headHash: string;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onOpenDiff: (filePath: string) => void;
  readonly onOpenFile: (relativePath: string) => void;
}) {
  const { environmentId, cwd, visible, baseHash, headHash } = props;
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
  const [filesOpen, setFilesOpen] = useState(true);
  const [wholeOpen, setWholeOpen] = useState(true);

  const target: GitGraphDiffInput["target"] = {
    _tag: "range",
    baseRef: baseHash,
    headRef: headHash,
  };
  const comparison = useEnvironmentQuery(
    cwd === null || !visible
      ? null
      : gitGraphEnvironment.diff({ environmentId, input: { cwd, target } }),
  );
  const fileDiff = useEnvironmentQuery(
    cwd === null || !visible || selectedFile === null
      ? null
      : gitGraphEnvironment.diff({
          environmentId,
          input: {
            cwd,
            target,
            file: {
              path: selectedFile,
              oldPath:
                comparison.data?.files.find((file) => file.path === selectedFile)?.oldPath ?? null,
            },
          } satisfies GitGraphDiffInput,
        }),
  );

  // The parent keys this panel on both hashes, so a new comparison starts with no file open.

  const files: readonly GitGraphDiffFile[] = comparison.data?.files ?? [];
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  return (
    <aside className="flex w-[min(34rem,46%)] min-w-80 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <GitCompareArrows className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-2xs">
          {shortHash(baseHash)} → {shortHash(headHash)}
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Close comparison"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {comparison.error && !comparison.data ? (
          <div className="p-3 text-destructive">{comparison.error}</div>
        ) : comparison.data === null ? (
          <div className="p-3 text-muted-foreground">Comparing…</div>
        ) : (
          <>
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
                  {files.length} {files.length === 1 ? "file" : "files"}
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-1 text-2xs tabular-nums">
                <span className="text-success">+{additions}</span>
                <span className="text-destructive">-{deletions}</span>
              </span>
            </div>
            {filesOpen && files.length === 0 ? (
              <div className="px-3 pb-2 text-muted-foreground">
                These commits have identical trees.
              </div>
            ) : null}
            {filesOpen
              ? files.map((file) => (
                  <div
                    key={`${file.oldPath ?? ""}\u0000${file.path}`}
                    className={cn(
                      "group flex h-6 items-center gap-1 pr-1 pl-2 hover:bg-accent/60",
                      selectedFile === file.path && "bg-accent",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1 text-left"
                      onClick={() =>
                        setSelectedFile((current) => (current === file.path ? null : file.path))
                      }
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
                        className={cn(
                          "min-w-0 truncate",
                          file.status === "deleted" && "line-through opacity-70",
                        )}
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
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-micro"
                              variant="ghost-muted"
                              aria-label={`Diff ${file.path} in the Diff tab`}
                              onClick={(event) => {
                                event.stopPropagation();
                                props.onOpenDiff(file.path);
                              }}
                            />
                          }
                        >
                          <GitCompareArrows />
                        </TooltipTrigger>
                        <TooltipPopup side="left">Diff in the Diff tab</TooltipPopup>
                      </Tooltip>
                      {file.status !== "deleted" ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-micro"
                                variant="ghost-muted"
                                aria-label={`Open ${file.path}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  props.onOpenFile(file.path);
                                }}
                              />
                            }
                          >
                            <FileText />
                          </TooltipTrigger>
                          <TooltipPopup side="left">Open file</TooltipPopup>
                        </Tooltip>
                      ) : null}
                    </span>
                  </div>
                ))
              : null}
            {selectedFile !== null ? (
              <div className="border-t border-border">
                <div className="flex h-7 items-center gap-1 px-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-2xs">{selectedFile}</span>
                  <DiffStyleToggle value={diffStyle} onChange={setDiffStyle} />
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    aria-label="Close file diff"
                    onClick={() => setSelectedFile(null)}
                  >
                    <X />
                  </Button>
                </div>
                {fileDiff.error && !fileDiff.data ? (
                  <div className="p-3 text-destructive">{fileDiff.error}</div>
                ) : fileDiff.data === null ? (
                  <div className="px-3 pb-2 text-muted-foreground">Loading…</div>
                ) : (
                  <div className="border-t border-border/60">
                    <ComparisonPatch
                      patch={fileDiff.data.patch}
                      cacheScope={`git-graph:compare:${baseHash}:${headHash}:${selectedFile}`}
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
                    onClick={() => setWholeOpen((open) => !open)}
                  >
                    {wholeOpen ? (
                      <ChevronDown className="size-3 shrink-0" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0" />
                    )}
                    <span className="truncate">Complete patch</span>
                  </button>
                  {wholeOpen ? <DiffStyleToggle value={diffStyle} onChange={setDiffStyle} /> : null}
                </div>
                {wholeOpen ? (
                  <div className="border-t border-border/60">
                    <ComparisonPatch
                      patch={comparison.data.patch}
                      cacheScope={`git-graph:compare:${baseHash}:${headHash}`}
                      diffStyle={diffStyle}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
