import { describe, expect, it } from "vite-plus/test";

import { rememberTerminals } from "./rememberedTerminalsStore";

describe("rememberTerminals", () => {
  it("adds each new terminal once and keeps the list when nothing is new", () => {
    const remembered = rememberTerminals(
      [{ threadId: "A", terminalId: "t1" }],
      [
        { threadId: "A", terminalId: "t1" },
        { threadId: "B", terminalId: "t1" },
        { threadId: "B", terminalId: "t1" },
      ],
    );
    expect(remembered).toEqual([
      { threadId: "A", terminalId: "t1" },
      { threadId: "B", terminalId: "t1" },
    ]);
    expect(rememberTerminals(remembered, [{ threadId: "B", terminalId: "t1" }])).toBe(remembered);
  });

  it("drops the oldest terminals past the cap", () => {
    const many = Array.from({ length: 205 }, (_, index) => ({
      threadId: "A",
      terminalId: `t${index}`,
    }));
    const remembered = rememberTerminals([], many);
    expect(remembered).toHaveLength(200);
    expect(remembered[0]).toEqual({ threadId: "A", terminalId: "t5" });
  });
});
