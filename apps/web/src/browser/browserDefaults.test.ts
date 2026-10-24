import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_BROWSER_PROFILE_ID, INCOGNITO_BROWSER_PROFILE_ID } from "@t3tools/contracts";

const settings = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("~/hooks/useSettings", () => ({
  getClientSettings: () => settings.current,
  useClientSettings: () => undefined,
  ensureClientSettingsHydrated: vi.fn(async () => undefined),
}));

const { getBrowserDefaults, serverTabRendering } = await import("./browserDefaults");

const withDefaultProfile = (browserDefaultProfileId: string) => {
  settings.current = {
    browserDefaultViewport: { _tag: "fill" },
    browserDefaultZoomFactor: 1,
    browserDefaultAppearance: "system",
    browserAutoShowFloatingPreview: true,
    browserProfiles: [{ id: "work", name: "Work", kind: "persistent" }],
    browserDefaultProfileId,
  };
  return getBrowserDefaults();
};

describe("getBrowserDefaults profile resolution", () => {
  it("refuses incognito as the default", () => {
    expect(withDefaultProfile(INCOGNITO_BROWSER_PROFILE_ID).profileId).toBe(
      DEFAULT_BROWSER_PROFILE_ID,
    );
  });
});

describe("serverTabRendering", () => {
  const defaults = { zoomFactor: 1.25, appearance: "dark" } as const;

  it("follows the defaults until the tab is zoomed or themed", () => {
    expect(serverTabRendering({}, true, defaults)).toEqual({
      zoomFactor: 1.25,
      colorScheme: "dark",
    });
    expect(serverTabRendering({ zoomFactor: 0.9, colorScheme: "light" }, true, defaults)).toEqual({
      zoomFactor: 0.9,
      colorScheme: "light",
    });
  });

  it("leaves a tab the server renders itself on the server's defaults", () => {
    expect(serverTabRendering({}, false, defaults)).toEqual({
      zoomFactor: 1,
      colorScheme: "system",
    });
  });
});
