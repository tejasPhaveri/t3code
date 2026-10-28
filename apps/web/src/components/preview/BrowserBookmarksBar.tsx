import type { BrowserBookmark } from "@t3tools/contracts";
import { FolderIcon, Globe2 } from "lucide-react";

import { useBrowserBookmarks, useProfileBookmarkSource } from "~/browser/browserBookmarks";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { faviconUrlForOrigin } from "@t3tools/shared/favicon";

import { FaviconImage } from "./PreviewFaviconIcon";

function BookmarkIcon({ bookmark }: { bookmark: BrowserBookmark }) {
  if (bookmark.children) return <FolderIcon className="size-3.5 shrink-0" />;
  return (
    <FaviconImage
      sources={[faviconUrlForOrigin(bookmark.url ?? null, 32)]}
      fallback={<Globe2 className="size-3.5 shrink-0" />}
      className="size-3.5 shrink-0 rounded-sm object-contain"
    />
  );
}

function BookmarkMenuItems({
  bookmarks,
  onOpen,
}: {
  bookmarks: readonly BrowserBookmark[];
  onOpen: (url: string) => void;
}) {
  if (bookmarks.length === 0) return <MenuItem disabled>Empty folder</MenuItem>;
  return bookmarks.map((bookmark, index) =>
    bookmark.children ? (
      // oxlint-disable-next-line react/no-array-index-key -- Bookmarks have no ids; the list is replaced whole when the file changes.
      <MenuSub key={index}>
        <MenuSubTrigger>
          <BookmarkIcon bookmark={bookmark} />
          <span className="truncate">{bookmark.name}</span>
        </MenuSubTrigger>
        <MenuSubPopup className="max-h-96 max-w-72">
          <BookmarkMenuItems bookmarks={bookmark.children} onOpen={onOpen} />
        </MenuSubPopup>
      </MenuSub>
    ) : (
      // oxlint-disable-next-line react/no-array-index-key -- Bookmarks have no ids; the list is replaced whole when the file changes.
      <MenuItem key={index} onClick={() => bookmark.url && onOpen(bookmark.url)}>
        <BookmarkIcon bookmark={bookmark} />
        <span className="truncate">{bookmark.name}</span>
      </MenuItem>
    ),
  );
}

/** The bookmarks bar of the browser profile this tab is in, when the profile shows one. */
export function BrowserBookmarksBar({
  profileId,
  onOpen,
}: {
  profileId: string;
  onOpen: (url: string) => void;
}) {
  const source = useProfileBookmarkSource(profileId);
  const bookmarks = useBrowserBookmarks(source);
  if (!source || bookmarks.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-1.5 py-0.5 [scrollbar-width:none]">
      {bookmarks.map((bookmark, index) =>
        bookmark.children ? (
          // oxlint-disable-next-line react/no-array-index-key -- Bookmarks have no ids; the list is replaced whole when the file changes.
          <Menu key={index}>
            <MenuTrigger
              render={<Button size="xs" variant="ghost-muted" className="max-w-40 shrink-0" />}
            >
              <BookmarkIcon bookmark={bookmark} />
              <span className="truncate">{bookmark.name}</span>
            </MenuTrigger>
            <MenuPopup align="start" className="max-h-96 max-w-72">
              <BookmarkMenuItems bookmarks={bookmark.children} onOpen={onOpen} />
            </MenuPopup>
          </Menu>
        ) : (
          <Button
            // oxlint-disable-next-line react/no-array-index-key -- Bookmarks have no ids; the list is replaced whole when the file changes.
            key={index}
            size="xs"
            variant="ghost-muted"
            className="max-w-40 shrink-0"
            title={bookmark.url}
            onClick={() => bookmark.url && onOpen(bookmark.url)}
          >
            <BookmarkIcon bookmark={bookmark} />
            <span className="truncate">{bookmark.name}</span>
          </Button>
        ),
      )}
    </div>
  );
}
