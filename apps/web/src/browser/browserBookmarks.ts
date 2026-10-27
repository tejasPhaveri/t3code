import type {
  BrowserBookmark,
  BrowserBookmarkSource,
  BrowserImportSource,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { previewBridge } from "~/components/preview/previewBridge";
import { useClientSettings } from "~/hooks/useSettings";

const NO_BOOKMARKS: readonly BrowserBookmark[] = [];

export function useProfileBookmarkSource(profileId: string): BrowserBookmarkSource | undefined {
  return useClientSettings((settings) => settings.browserBookmarkSources[profileId]);
}

export function bookmarkSourceKey(source: BrowserBookmarkSource): string {
  return `${source.sourceId}\0${source.profileDirectory}`;
}

/**
 * The source's bookmarks bar. It is reread whenever the app regains focus, so a bookmark added
 * in Chrome shows up on coming back.
 */
export function useBrowserBookmarks(
  source: BrowserBookmarkSource | undefined,
): readonly BrowserBookmark[] {
  const key = source ? bookmarkSourceKey(source) : null;
  const [loaded, setLoaded] = useState<{
    key: string;
    bookmarks: readonly BrowserBookmark[];
  } | null>(null);
  useEffect(() => {
    const read = previewBridge?.readBrowserBookmarks;
    if (!source || !read) return;
    const sourceKey = bookmarkSourceKey(source);
    let cancelled = false;
    const load = () => {
      void read(source)
        .then((bookmarks) => {
          if (!cancelled) setLoaded({ key: sourceKey, bookmarks: bookmarks ?? NO_BOOKMARKS });
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [source]);
  return loaded !== null && loaded.key === key ? loaded.bookmarks : NO_BOOKMARKS;
}

/** Browsers on this computer whose bookmarks a profile can show; loaded when asked for. */
export function useBrowserBookmarkSources(enabled: boolean): readonly BrowserImportSource[] | null {
  const [sources, setSources] = useState<readonly BrowserImportSource[] | null>(null);
  useEffect(() => {
    const list = previewBridge?.listBrowserBookmarkSources;
    if (!enabled || !list) return;
    let cancelled = false;
    void list()
      .then((listed) => {
        if (!cancelled) setSources(listed);
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return sources;
}
