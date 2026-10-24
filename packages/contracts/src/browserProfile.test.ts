import { describe, expect, it } from "@effect/vitest";

import {
  BROWSER_PROFILE_COLOR_PALETTE,
  BUILT_IN_BROWSER_PROFILES,
  DEFAULT_BROWSER_PROFILE_ID,
  INCOGNITO_BROWSER_PROFILE_ID,
  BROWSER_PROFILE_MAX_COUNT,
  resolveBrowserProfileAccents,
  resolveBrowserProfiles,
  type BrowserProfile,
} from "./browserProfile.ts";

const work: BrowserProfile = { id: "profile-work", name: "Work", kind: "persistent" };

describe("resolveBrowserProfiles", () => {
  it("drops stored entries that collide with a built-in id", () => {
    const resolved = resolveBrowserProfiles([
      { id: DEFAULT_BROWSER_PROFILE_ID, name: "Hijacked", kind: "persistent" },
      { id: INCOGNITO_BROWSER_PROFILE_ID, name: "Not incognito", kind: "persistent" },
      work,
    ]);

    expect(resolved).toEqual([...BUILT_IN_BROWSER_PROFILES, work]);
  });
});

describe("resolveBrowserProfiles normalization", () => {
  it("reports a custom incognito profile as persistent", () => {
    const resolved = resolveBrowserProfiles([
      { id: "throwaway", name: "Throwaway", kind: "incognito" },
    ]);

    expect(resolved.find((profile) => profile.id === "throwaway")).toEqual({
      id: "throwaway",
      name: "Throwaway",
      kind: "persistent",
    });
  });

  it("keeps a profile color", () => {
    const color = BROWSER_PROFILE_COLOR_PALETTE[2];
    const resolved = resolveBrowserProfiles([{ ...work, color }]);

    expect(resolved.find((profile) => profile.id === work.id)?.color).toBe(color);
    expect(resolveBrowserProfileAccents(resolved)[work.id]).toBe(color);
  });

  it("gives every profile a distinct accent, even past the palette", () => {
    const resolved = resolveBrowserProfiles(
      Array.from({ length: BROWSER_PROFILE_MAX_COUNT }, (_, index) => ({
        id: `profile-${index}`,
        name: `Profile ${index}`,
        kind: "persistent" as const,
      })),
    );
    const accents = resolveBrowserProfileAccents(resolved);
    const colors = resolved.map((profile) => accents[profile.id]);

    expect(colors.every((color) => /^#[0-9a-f]{6}$/.test(color ?? ""))).toBe(true);
    expect(new Set(colors).size).toBe(resolved.length);
  });

  it("reassigns a later profile that stores an already-taken color", () => {
    const color = BROWSER_PROFILE_COLOR_PALETTE[0];
    const accents = resolveBrowserProfileAccents([
      { id: "first", color },
      { id: "second", color: color.toUpperCase() },
    ]);

    expect(accents.first).toBe(color);
    expect(accents.second).not.toBe(color);
  });
});
