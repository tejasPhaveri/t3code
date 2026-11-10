import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";

const DevinSelf = Schema.Struct({
  org_id: Schema.optional(Schema.NullOr(Schema.String)),
  primary_billing_org_id: Schema.optional(Schema.NullOr(Schema.String)),
});

// Undocumented endpoint the Devin web app's Usage page reads; it may change without notice.
const DevinQuotaUsage = Schema.Struct({
  is_quota_plan: Schema.optional(Schema.NullOr(Schema.Boolean)),
  has_quota_allocation: Schema.optional(Schema.NullOr(Schema.Boolean)),
  daily_percentage: Schema.optional(Schema.NullOr(Schema.Number)),
  weekly_percentage: Schema.optional(Schema.NullOr(Schema.Number)),
  daily_reset_at: Schema.optional(Schema.NullOr(Schema.String)),
  weekly_reset_at: Schema.optional(Schema.NullOr(Schema.String)),
  hide_daily_quota: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

const DAY_MINS = 24 * 60;
const WEEK_MINS = 7 * DAY_MINS;

function tomlString(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match?.[1]?.trim() || undefined;
}

function isoOrUndefined(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = DateTime.make(value);
  return parsed._tag === "Some" ? DateTime.formatIso(parsed.value) : undefined;
}

export function devinQuotaToLimits(
  quota: typeof DevinQuotaUsage.Type,
  checkedAt: string,
  orgId: string,
): ServerProviderUsageLimits {
  const windows: ServerProviderUsageWindow[] = [];
  const push = (
    id: string,
    kind: ServerProviderUsageWindow["kind"],
    label: string,
    windowDurationMins: number,
    usedPercent: number | null | undefined,
    resetAt: string | null | undefined,
  ) => {
    if (usedPercent === null || usedPercent === undefined || !Number.isFinite(usedPercent)) return;
    const resetsAt = isoOrUndefined(resetAt);
    windows.push({
      id,
      kind,
      label,
      windowDurationMins,
      usedPercent: clampPercent(usedPercent),
      ...(resetsAt ? { resetsAt } : {}),
    });
  };
  if (quota.is_quota_plan !== false && quota.has_quota_allocation !== false) {
    if (!quota.hide_daily_quota) {
      push("daily", "session", "Daily", DAY_MINS, quota.daily_percentage, quota.daily_reset_at);
    }
    push("weekly", "weekly", "Weekly", WEEK_MINS, quota.weekly_percentage, quota.weekly_reset_at);
  }
  return windows.length > 0
    ? {
        ...makeUsageLimits({ checkedAt, windows }),
        // Org ids are not secret; they merge the same Devin account across environments.
        credentialFingerprint: `devin:${orgId}`,
        externalUsage: { label: "Devin usage", url: "https://app.devin.ai/settings/usage" },
      }
    : makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
}

/** Reads the Devin CLI login (`devin auth login`) and asks the web app for quota usage. */
export const readDevinUsageLimits = Effect.fn("readDevinUsageLimits")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const platform = yield* HostProcess.Platform;
    const home =
      (platform === "win32" ? environment.USERPROFILE : environment.HOME) ||
      (yield* HostProcess.HomeDirectory);
    const credentials = yield* fs
      .readFileString(path.join(home, ".local", "share", "devin", "credentials.toml"))
      .pipe(
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error),
        }),
      );
    const token = tomlString(credentials, "windsurf_api_key");
    if (!token) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "unsupported",
        message: "Devin usage requires a Devin CLI login.",
      });
    }
    const apiUrl = (tomlString(credentials, "devin_api_url") ?? "https://api.devin.ai").replace(
      /\/$/,
      "",
    );
    const webappHost = tomlString(credentials, "devin_webapp_host") ?? "app.devin.ai";
    const client = yield* HttpClient.HttpClient;
    const getJson = <S extends Schema.Top>(url: string, schema: S) =>
      client
        .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.bearerToken(token)))
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
        );
    const self = yield* getJson(`${apiUrl}/v3/self`, DevinSelf);
    const orgId = self.primary_billing_org_id || self.org_id;
    if (!orgId) return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
    const quota = yield* getJson(
      `https://${webappHost}/api/${encodeURIComponent(orgId)}/billing/quota/usage`,
      DevinQuotaUsage,
    );
    return devinQuotaToLimits(quota, checkedAt, orgId);
  }).pipe(
    Effect.timeout("10 seconds"),
    Effect.orElseSucceed(() =>
      makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Devin could not read usage limits.",
      }),
    ),
  );
});
