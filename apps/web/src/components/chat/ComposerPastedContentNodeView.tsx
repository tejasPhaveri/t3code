import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import { cn } from "~/lib/utils";
import { MarkdownCodeBlockFrame } from "./MarkdownCodeBlock";
import { pastedTextLineCount } from "./composerPastedText";

/**
 * A pasted block opens as a single truncated line, since the dump itself is read
 * by the agent rather than by the person writing the message. The text stays in
 * the document, so the agent still receives all of it, and folding never edits
 * the draft.
 */
export function ComposerPastedContentNodeView({ node, editor }: NodeViewProps) {
  const resolvedTheme = useRenderedAppearance();
  const [expanded, setExpanded] = useState(false);
  const text = node.textContent;
  const lines = pastedTextLineCount(text);
  const summary = `${lines} ${lines === 1 ? "line" : "lines"} · ${text.length.toLocaleString()} characters`;

  return (
    <MarkdownCodeBlockFrame
      as={NodeViewWrapper}
      language="text"
      fenceTitle={null}
      theme={resolvedTheme}
      // The frame's wrap rule sets `pre-wrap` on the code, which would defeat the single line.
      wrapped={expanded}
      headerProps={{ contentEditable: false }}
      title={
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1.5 font-mono text-2xs"
          aria-expanded={expanded}
          aria-label={`Pasted content, ${summary}. ${expanded ? "Collapse" : "Expand"}`}
          disabled={!editor.isEditable}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 opacity-70" />
          )}
          <span className="shrink-0">Pasted content</span>
          <span className="truncate opacity-60">{summary}</span>
        </button>
      }
    >
      <div className="chat-markdown-shiki">
        <pre
          className={cn(
            "max-w-full px-3 pt-1 pb-2",
            expanded ? "overflow-x-auto" : "overflow-hidden",
          )}
        >
          {/* Tiptap writes `white-space: pre-wrap` inline on the code element, so the collapsed
              state has to override it there; a class cannot win against that style. */}
          <NodeViewContent<"code">
            as="code"
            className={cn(
              "block min-h-[1lh] font-mono text-inherit [overflow-wrap:anywhere]",
              expanded ? "whitespace-pre-wrap" : "truncate",
            )}
            style={expanded ? undefined : { whiteSpace: "nowrap" }}
          />
        </pre>
      </div>
    </MarkdownCodeBlockFrame>
  );
}
