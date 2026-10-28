import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A Cursor cloud agent observed on the account, not a thread T3 Code is running.
 * T3 has no local checkout, run, or checkpoint for it, so it reports only what
 * Cursor knows: its phase, and which provider instance it belongs to.
 */
export const CloudAgent = Schema.Struct({
  /** The provider's own identifier; stable across polls and restarts. */
  id: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  providerLabel: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  phase: Schema.Literals(["running", "finished", "error", "unknown"]),
  /** The provider's own last-activity stamp, used to order the shelf. */
  lastActivityAt: Schema.DateTimeUtc,
  /** Where to open the agent in the provider's own client. */
  webUrl: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type CloudAgent = typeof CloudAgent.Type;

export const CloudAgentListInput = Schema.Struct({
  /** Skip the provider round trip when the client already holds a snapshot. */
  refresh: Schema.optional(Schema.Boolean),
});
export type CloudAgentListInput = typeof CloudAgentListInput.Type;

export const CloudAgentListResult = Schema.Struct({
  agents: Schema.Array(CloudAgent),
  checkedAt: IsoDateTime,
  /** A provider instance that could not be read, with the reason to show the user. */
  failures: Schema.Array(
    Schema.Struct({
      providerInstanceId: ProviderInstanceId,
      providerLabel: TrimmedNonEmptyString,
      message: TrimmedNonEmptyString,
    }),
  ),
});
export type CloudAgentListResult = typeof CloudAgentListResult.Type;
