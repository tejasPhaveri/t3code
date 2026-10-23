import { describe, expect, it } from "@effect/vitest";

import { previewSessionVisibleTo } from "./browserPersistence.ts";

const shared = {
  threadId: "thread-a",
  projectId: "project-1",
  persistence: "project" as const,
};

describe("previewSessionVisibleTo", () => {
  it("keeps per-chat tabs on the chat that opened them", () => {
    expect(
      previewSessionVisibleTo(shared, {
        threadId: "thread-b",
        persistence: "thread",
        projectId: "project-1",
      }),
    ).toBe(false);
    expect(previewSessionVisibleTo(shared, { threadId: "thread-a", persistence: "thread" })).toBe(
      true,
    );
  });

  it("lets another chat in the project reference the same tab", () => {
    expect(
      previewSessionVisibleTo(shared, {
        threadId: "thread-b",
        persistence: "project",
        projectId: "project-1",
      }),
    ).toBe(true);
    expect(
      previewSessionVisibleTo(shared, {
        threadId: "thread-b",
        persistence: "project",
        projectId: "project-2",
      }),
    ).toBe(false);
  });

  it("shares non-isolated tabs across projects in an environment", () => {
    expect(
      previewSessionVisibleTo(shared, {
        threadId: "thread-b",
        persistence: "environment",
        projectId: "project-2",
      }),
    ).toBe(true);
  });

  it("keeps an isolated tab on its chat in every mode", () => {
    const isolated = { ...shared, isolated: true };
    expect(
      previewSessionVisibleTo(isolated, {
        threadId: "thread-b",
        persistence: "environment",
        projectId: "project-1",
      }),
    ).toBe(false);
    expect(
      previewSessionVisibleTo(isolated, { threadId: "thread-a", persistence: "project" }),
    ).toBe(true);
  });
});
