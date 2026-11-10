import { describe, expect, it } from "@effect/vitest";

import { devinQuotaToLimits } from "./devinUsageLimits.ts";

describe("Devin usage limits", () => {
  const checkedAt = "2026-10-31T16:00:00.000Z";
  const quota = {
    is_quota_plan: true,
    has_quota_allocation: true,
    daily_percentage: 0.0,
    weekly_percentage: 12.0,
    daily_reset_at: "2026-11-01T00:00:00-08:00",
    weekly_reset_at: "2026-11-01T00:00:00-08:00",
    hide_daily_quota: false,
  };

  it("maps daily and weekly quota with offset reset times normalized to UTC", () => {
    const limits = devinQuotaToLimits(quota, checkedAt, "org-1");
    expect(limits.windows).toEqual([
      {
        id: "daily",
        kind: "session",
        label: "Daily",
        windowDurationMins: 1440,
        usedPercent: 0,
        resetsAt: "2026-11-01T08:00:00.000Z",
      },
      {
        id: "weekly",
        kind: "weekly",
        label: "Weekly",
        windowDurationMins: 10080,
        usedPercent: 12,
        resetsAt: "2026-11-01T08:00:00.000Z",
      },
    ]);
    expect(limits.credentialFingerprint).toBe("devin:org-1");
  });

  it("omits the daily window when Devin hides it, and reports no quota plan as unsupported", () => {
    expect(
      devinQuotaToLimits({ ...quota, hide_daily_quota: true }, checkedAt, "org-1").windows.map(
        (window) => window.id,
      ),
    ).toEqual(["weekly"]);
    expect(
      devinQuotaToLimits({ ...quota, is_quota_plan: false }, checkedAt, "org-1").unavailable
        ?.reason,
    ).toBe("unsupported");
  });
});
