import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import { MarkdownCodeBlockFrame } from "./MarkdownCodeBlock";
import { pastedTextLineCount } from "./composerPastedText";

/**
 * A pasted block shows a few lines instead of the whole dump. The text stays in
 * the document, so the agent still receives all of it, and the fold never edits
 * the draft. It is clamped rather than hidden, so a caret that moves into it
 * stays reachable.
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
          className={
            expanded
              ? "max-w-full overflow-x-auto px-3 pt-1 pb-2"
              : "max-h-24 max-w-full overflow-auto px-3 pt-1 pb-2"
          }
        >
          <NodeViewContent<"code">
            as="code"
            className="block min-h-[1lh] font-mono whitespace-pre-wrap text-inherit [overflow-wrap:anywhere]"
          />
        </pre>
      </div>
    </MarkdownCodeBlockFrame>
  );
}
