import { assert, it } from "@effect/vitest";

import { cursorCloudAgentsFromSdk } from "./cloudAgents.ts";

it("maps SDK cloud agents to provider agents, defaulting a missing modification time", () => {
  assert.deepEqual(
    cursorCloudAgentsFromSdk(
      [
        {
          agentId: "agent-1",
          name: "  Review payroll  ",
          summary: "  Fixes the landing page  ",
          lastModified: 1_700_000_000_000,
          status: "running",
        },
        { agentId: "agent-2", status: "finished" },
        { agentId: "agent-3", status: "error", name: "   " },
        { agentId: "agent-4" },
      ],
      42,
    ),
    [
      {
        id: "agent-1",
        name: "Review payroll",
        summary: "Fixes the landing page",
        phase: "running",
        lastActivityAtMs: 1_700_000_000_000,
        webUrl: "https://cursor.com/agents/agent-1",
      },
      {
        id: "agent-2",
        name: "agent-2",
        summary: null,
        phase: "finished",
        lastActivityAtMs: 42,
        webUrl: "https://cursor.com/agents/agent-2",
      },
      {
        id: "agent-3",
        name: "agent-3",
        summary: null,
        phase: "error",
        lastActivityAtMs: 42,
        webUrl: "https://cursor.com/agents/agent-3",
      },
      {
        id: "agent-4",
        name: "agent-4",
        summary: null,
        phase: "unknown",
        lastActivityAtMs: 42,
        webUrl: "https://cursor.com/agents/agent-4",
      },
    ],
  );
});

it("escapes an agent id in its web URL", () => {
  assert.equal(
    cursorCloudAgentsFromSdk([{ agentId: "a/b" }], 0)[0]?.webUrl,
    "https://cursor.com/agents/a%2Fb",
  );
});
