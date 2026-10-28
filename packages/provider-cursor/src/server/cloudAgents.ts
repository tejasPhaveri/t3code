import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProviderCloudAgent } from "@t3tools/provider-core/server/driver";
import { Agent } from "./sdk.ts";

/** Cursor serves each cloud agent at this path under its app host. */
const cursorAgentWebUrl = (agentId: string) =>
  `https://cursor.com/agents/${encodeURIComponent(agentId)}`;

function toPhase(status: string | undefined): ProviderCloudAgent["phase"] {
  switch (status) {
    case "running":
      return "running";
    case "finished":
      return "finished";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

export interface CursorCloudAgentSummary {
  readonly agentId: string;
  readonly name?: string | undefined;
  readonly summary?: string | undefined;
  readonly lastModified?: number | undefined;
  readonly status?: "running" | "finished" | "error" | undefined;
}

export function cursorCloudAgentsFromSdk(
  items: ReadonlyArray<CursorCloudAgentSummary>,
  nowMs: number,
): ReadonlyArray<ProviderCloudAgent> {
  return items.map((item): ProviderCloudAgent => ({
    id: item.agentId,
    name: item.name?.trim() || item.agentId,
    summary: item.summary?.trim() || null,
    phase: toPhase(item.status),
    lastActivityAtMs: item.lastModified ?? nowMs,
    webUrl: cursorAgentWebUrl(item.agentId),
  }));
}

class CursorCloudAgentsError extends Schema.TaggedError<CursorCloudAgentsError>()(
  "CursorCloudAgentsError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Cursor could not list cloud agents.";
  }
}

/**
 * Lists the account's cloud agents. Observation only: T3 never creates, steers,
 * or cancels them here, so a provider-side change can only change what is shown.
 */
export const listCursorCloudAgents = Effect.fn("listCursorCloudAgents")(function* (
  apiKey: string | undefined,
  nowMs: number,
) {
  const listed = yield* Effect.tryPromise({
    try: () =>
      Agent.list({
        runtime: "cloud",
        ...(apiKey === undefined ? {} : { apiKey }),
        limit: 100,
      }),
    catch: (cause) => new CursorCloudAgentsError({ cause }),
  });
  return cursorCloudAgentsFromSdk(listed.items, nowMs);
});
