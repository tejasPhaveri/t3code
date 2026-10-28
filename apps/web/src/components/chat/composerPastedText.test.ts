import { describe, expect, it } from "vite-plus/test";

import {
  PASTED_CONTENT_FENCE_LANGUAGE,
  collapsePastedTextAsBlock,
  shouldCollapsePastedText,
} from "./composerPastedText";

const PAGE_CONTEXT_PASTE = [
  "Page Context:",
  "Path: /app",
  "Query: view=payroll-hub&tab=pending&month=[redacted]",
  "Title: OA Test · Officers Assist",
  "",
  "Selected Element Context:",
  "Element 1:",
  "Component: xn",
  "Source: unknown:?:?",
  "Selector: .flex > .flex > .justify-end",
  "Computed Styles:",
  "display: flex;",
  "width: 640.062px;",
].join("\n");

describe("shouldCollapsePastedText", () => {
  it("folds a long multi-line dump", () => {
    expect(shouldCollapsePastedText(PAGE_CONTEXT_PASTE)).toBe(true);
  });

  it("keeps a short paste inline so it stays readable while writing", () => {
    expect(shouldCollapsePastedText("hi")).toBe(false);
    expect(shouldCollapsePastedText("a\nb")).toBe(false);
    expect(shouldCollapsePastedText("one\ntwo\nthree")).toBe(false);
  });

  it("keeps one long line inline because it is a sentence, not a dump", () => {
    expect(shouldCollapsePastedText("x".repeat(900))).toBe(false);
  });

  it("folds a wide paste even when it has few lines", () => {
    expect(shouldCollapsePastedText(`${"x".repeat(400)}\n${"y".repeat(400)}`)).toBe(true);
  });

  it("treats empty text as nothing to fold", () => {
    expect(shouldCollapsePastedText("")).toBe(false);
  });
});

describe("collapsePastedTextAsBlock", () => {
  it("keeps the pasted text byte for byte, so the agent reads all of it", () => {
    const block = collapsePastedTextAsBlock(PAGE_CONTEXT_PASTE);
    expect(block).not.toBeNull();
    expect(block!.split("\n").slice(1, -1).join("\n")).toBe(PAGE_CONTEXT_PASTE);
  });

  it("marks the fence so the composer can tell a paste from code", () => {
    const block = collapsePastedTextAsBlock(PAGE_CONTEXT_PASTE)!;
    expect(block.startsWith("```" + PASTED_CONTENT_FENCE_LANGUAGE)).toBe(true);
  });

  it("uses a longer fence than any backticks inside the paste", () => {
    const pasted = ["```", "code inside", "````", ...Array.from({ length: 12 }, () => "line")];
    const block = collapsePastedTextAsBlock(pasted.join("\n"))!;
    const [open, ...rest] = block.split("\n");
    const close = rest.at(-1)!;
    expect(open!.startsWith("`````")).toBe(true);
    expect(close).toBe("`````");
  });

  it("returns null for a paste that belongs inline", () => {
    expect(collapsePastedTextAsBlock("hi")).toBeNull();
  });
});
