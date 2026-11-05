import type { GitGraphWorktreeFile } from "@t3tools/contracts";

export const GIT_STATUS_LETTER: Record<GitGraphWorktreeFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  untracked: "U",
  conflicted: "!",
};

// VS Code light+ / dark+ gitDecoration colors.
export const GIT_STATUS_CLASS: Record<GitGraphWorktreeFile["status"], string> = {
  added: "text-[#587c0c] dark:text-[#81b88b]",
  modified: "text-[#895503] dark:text-[#e2c08d]",
  deleted: "text-[#ad0707] dark:text-[#c74e39]",
  renamed: "text-[#007100] dark:text-[#73c991]",
  copied: "text-[#007100] dark:text-[#73c991]",
  "type-changed": "text-[#895503] dark:text-[#e2c08d]",
  untracked: "text-[#007100] dark:text-[#73c991]",
  conflicted: "text-[#ad0707] dark:text-[#e4676b]",
};

export const GIT_STATUS_DOT: Record<GitGraphWorktreeFile["status"], string> = {
  added: "bg-[#587c0c] dark:bg-[#81b88b]",
  modified: "bg-[#895503] dark:bg-[#e2c08d]",
  deleted: "bg-[#ad0707] dark:bg-[#c74e39]",
  renamed: "bg-[#007100] dark:bg-[#73c991]",
  copied: "bg-[#007100] dark:bg-[#73c991]",
  "type-changed": "bg-[#895503] dark:bg-[#e2c08d]",
  untracked: "bg-[#007100] dark:bg-[#73c991]",
  conflicted: "bg-[#ad0707] dark:bg-[#e4676b]",
};
