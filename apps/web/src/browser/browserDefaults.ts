import {
  DEFAULT_BROWSER_PERSISTENCE,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_PREVIEW_ZOOM_FACTOR,
  resolveBrowserProfileAccents,
  resolveBrowserProfiles,
  type BrowserPersistence,
  type BrowserProfile,
  type DesktopPreviewTabDefaults,
  type PreviewAppearancePreference,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
  type PreviewZoomFactor,
} from "@t3tools/contracts";

import {
  ensureClientSettingsHydrated,
  getClientSettings,
  useClientSettings,
} from "~/hooks/useSettings";

import { resolveResponsiveBrowserViewportSize } from "./browserViewportLayout";

export interface BrowserDefaults {
  readonly viewport: PreviewViewportSetting;
  readonly zoomFactor: PreviewZoomFactor;
  readonly appearance: PreviewAppearancePreference;
  readonly autoShowFloatingPreview: boolean;
  readonly profiles: ReadonlyArray<BrowserProfile>;
  readonly profileAccents: Readonly<Record<string, string>>;
  readonly profileId: string;
  readonly persistence: BrowserPersistence;
}

const toBrowserDefaults = (settings: {
  readonly browserDefaultViewport: PreviewViewportSetting;
  readonly browserDefaultZoomFactor: PreviewZoomFactor;
  readonly browserDefaultAppearance: PreviewAppearancePreference;
  readonly browserAutoShowFloatingPreview: boolean;
  readonly browserProfiles: ReadonlyArray<BrowserProfile>;
  readonly browserDefaultProfileId: string;
  readonly browserPersistence?: BrowserPersistence;
}): BrowserDefaults => {
  const profiles = resolveBrowserProfiles(settings.browserProfiles);
  return {
    viewport: settings.browserDefaultViewport,
    zoomFactor: settings.browserDefaultZoomFactor,
    appearance: settings.browserDefaultAppearance,
    autoShowFloatingPreview: settings.browserAutoShowFloatingPreview,
    profiles,
    profileAccents: resolveBrowserProfileAccents(profiles),
    persistence: settings.browserPersistence ?? DEFAULT_BROWSER_PERSISTENCE,
    profileId:
      profiles.find(
        (profile) =>
          profile.id === settings.browserDefaultProfileId && profile.kind !== "incognito",
      )?.id ?? DEFAULT_BROWSER_PROFILE_ID,
  };
};

export function getBrowserDefaults(): BrowserDefaults {
  return toBrowserDefaults(getClientSettings());
}

/** New tabs retain their initial defaults, so wait for settings hydration. Read failures reject. */
export async function resolveBrowserDefaults(): Promise<BrowserDefaults> {
  await ensureClientSettingsHydrated();
  return getBrowserDefaults();
}

export function useBrowserDefaults(): BrowserDefaults {
  return useClientSettings(toBrowserDefaults);
}

export function browserDefaultTabState(defaults: BrowserDefaults): DesktopPreviewTabDefaults {
  return { zoomFactor: defaults.zoomFactor, colorScheme: defaults.appearance };
}

/**
 * How a server tab this app renders natively is shown. The server records zoom and appearance
 * only once someone sets them, so until then the tab follows the defaults, including later
 * changes to them. A tab the server renders itself uses the server's own defaults.
 */
export function serverTabRendering(
  snapshot: Pick<PreviewSessionSnapshot, "zoomFactor" | "colorScheme">,
  rendersNatively: boolean,
  defaults: Pick<BrowserDefaults, "zoomFactor" | "appearance"> = getBrowserDefaults(),
): { readonly zoomFactor: PreviewZoomFactor; readonly colorScheme: PreviewAppearancePreference } {
  return {
    zoomFactor:
      snapshot.zoomFactor ?? (rendersNatively ? defaults.zoomFactor : DEFAULT_PREVIEW_ZOOM_FACTOR),
    colorScheme: snapshot.colorScheme ?? (rendersNatively ? defaults.appearance : "system"),
  };
}

const FALLBACK_RESPONSIVE_VIEWPORT_SIZE = { width: 1024, height: 768 } as const;

export function browserResponsiveViewportForToggle(input: {
  readonly defaults?: BrowserDefaults;
  readonly panelRect: { readonly width: number; readonly height: number } | null;
  readonly zoomFactor: number | undefined;
}): PreviewViewportSetting {
  const defaults = input.defaults ?? getBrowserDefaults();
  if (defaults.viewport._tag !== "fill") return defaults.viewport;
  const size = input.panelRect
    ? resolveResponsiveBrowserViewportSize(input.panelRect, input.zoomFactor)
    : FALLBACK_RESPONSIVE_VIEWPORT_SIZE;
  return { _tag: "freeform", ...size };
}
