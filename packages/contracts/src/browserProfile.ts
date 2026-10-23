import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const BROWSER_PROFILE_NAME_MAX_LENGTH = 48;
export const BROWSER_PROFILE_MAX_COUNT = 24;

/**
 * Control characters are rejected because ids are folded into delimiter-joined
 * cache keys on the client; one carrying the delimiter would resolve to a
 * different profile's partition.
 */
export const BrowserProfileId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[^\p{Cc}]+$/u),
);
export type BrowserProfileId = typeof BrowserProfileId.Type;

export const BrowserProfileName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(BROWSER_PROFILE_NAME_MAX_LENGTH),
);

export const BrowserProfileKind = Schema.Literals(["persistent", "incognito"]);
export type BrowserProfileKind = typeof BrowserProfileKind.Type;

/** A tab stripe color. Stored so a profile keeps its color across restarts. */
export const BrowserProfileColor = TrimmedNonEmptyString.check(
  Schema.isPattern(/^#[0-9a-fA-F]{6}$/),
);
export type BrowserProfileColor = typeof BrowserProfileColor.Type;

export const BROWSER_PROFILE_COLOR_PALETTE = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#ef4444",
  "#84cc16",
  "#a16207",
  "#64748b",
  "#d946ef",
] as const;

export const BrowserProfile = Schema.Struct({
  id: BrowserProfileId,
  name: BrowserProfileName,
  kind: BrowserProfileKind,
  color: Schema.optional(BrowserProfileColor),
});
export type BrowserProfile = typeof BrowserProfile.Type;

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * One distinct tab color per profile. Stored colors win in list order; the rest
 * start at a hash of their id (so adding a profile rarely recolors others) and
 * take the next free palette color. BROWSER_PROFILE_MAX_COUNT exceeds the palette,
 * so overflow profiles get golden-angle hues at alternating lightness, which stay
 * visibly apart from each other and from the palette.
 */
export function resolveBrowserProfileAccents(
  profiles: ReadonlyArray<Pick<BrowserProfile, "id" | "color">>,
): Readonly<Record<string, string>> {
  const accents: Record<string, string> = {};
  const used = new Set<string>();
  let generatedCount = 0;
  for (const profile of profiles) {
    const color = profile.color?.toLowerCase();
    if (color === undefined || used.has(color)) continue;
    accents[profile.id] = color;
    used.add(color);
  }
  for (const profile of profiles) {
    if (accents[profile.id] !== undefined) continue;
    let hash = 0;
    for (const char of profile.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const palette = BROWSER_PROFILE_COLOR_PALETTE;
    let color: string | undefined = Array.from(
      { length: palette.length },
      (_, offset) => palette[(hash + offset) % palette.length]!,
    ).find((entry) => !used.has(entry));
    while (color === undefined) {
      const generated = hslToHex(
        (generatedCount * 137.508) % 360,
        0.7,
        generatedCount % 2 === 0 ? 0.36 : 0.68,
      );
      generatedCount += 1;
      if (!used.has(generated)) color = generated;
    }
    accents[profile.id] = color;
    used.add(color);
  }
  return accents;
}

export const DEFAULT_BROWSER_PROFILE_ID: BrowserProfileId = "default";
export const INCOGNITO_BROWSER_PROFILE_ID: BrowserProfileId = "incognito";

export const BUILT_IN_BROWSER_PROFILES: ReadonlyArray<BrowserProfile> = [
  { id: DEFAULT_BROWSER_PROFILE_ID, name: "Default", kind: "persistent" },
  { id: INCOGNITO_BROWSER_PROFILE_ID, name: "Incognito", kind: "incognito" },
];

export function isBuiltInBrowserProfileId(id: string): boolean {
  return BUILT_IN_BROWSER_PROFILES.some((profile) => profile.id === id);
}

/**
 * - Repeated ids, which map to one partition and would otherwise appear as
 *   two isolated identities sharing every cookie.
 * - `kind: "incognito"` on anything but the built-in, since persistence is
 *   keyed off that one id; such a profile is labelled ephemeral while its
 *   cookies survive restarts.
 */
export function resolveBrowserProfiles(
  userProfiles: ReadonlyArray<BrowserProfile>,
): ReadonlyArray<BrowserProfile> {
  const seen = new Set(BUILT_IN_BROWSER_PROFILES.map((profile) => profile.id));
  const resolved = [...BUILT_IN_BROWSER_PROFILES];
  for (const profile of userProfiles) {
    if (seen.has(profile.id)) continue;
    seen.add(profile.id);
    resolved.push(profile.kind === "persistent" ? profile : { ...profile, kind: "persistent" });
  }
  return resolved;
}

export function findBrowserProfile(
  profiles: ReadonlyArray<BrowserProfile>,
  id: string | undefined,
): BrowserProfile | undefined {
  return id === undefined ? undefined : profiles.find((profile) => profile.id === id);
}
