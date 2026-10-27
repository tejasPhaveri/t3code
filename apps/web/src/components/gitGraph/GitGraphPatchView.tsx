import type { CodeViewDiffItem } from "@pierre/diffs";

import { useRenderedAppearance } from "~/hooks/useTheme";
import {
  buildFileDiffContentVersion,
  getRenderablePatch,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";

import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";

export type GitGraphDiffStyle = "unified" | "split";

/**
 * A patch drawn with the same viewer the Diff tab uses, so a commit's diff looks and scrolls
 * like every other diff in the app. `cacheScope` keeps two commits' patches apart in the cache.
 */
export function GitGraphPatchView(props: {
  readonly patch: string;
  readonly cacheScope: string;
  readonly diffStyle: GitGraphDiffStyle;
}) {
  const resolvedTheme = useRenderedAppearance();
  const renderable = getRenderablePatch(props.patch, props.cacheScope);
  const items: readonly CodeViewDiffItem[] | null =
    renderable === null || renderable.kind !== "files"
      ? null
      : renderable.files.map((fileDiff, index) => ({
          id: `${props.cacheScope}:${index}`,
          type: "diff" as const,
          fileDiff,
          version: buildFileDiffContentVersion(fileDiff),
        }));

  if (renderable === null) {
    return <div className="px-3 py-2 text-muted-foreground">Nothing to show.</div>;
  }
  if (items === null) {
    return (
      <pre className="overflow-auto p-2 font-mono text-2xs whitespace-pre">
        {renderable.kind === "raw" ? renderable.text : props.patch}
      </pre>
    );
  }
  return (
    <StyledDiffCodeView
      items={items}
      className="max-h-[28rem] overflow-auto"
      options={{
        diffStyle: props.diffStyle === "split" ? "split" : "unified",
        lineDiffType: "none",
        overflow: "scroll",
        diffIndicators: "bars",
        theme: resolveDiffThemeName(resolvedTheme),
        themeType: resolvedTheme,
        preferredHighlighter: PREFERRED_HIGHLIGHTER,
      }}
    />
  );
}
