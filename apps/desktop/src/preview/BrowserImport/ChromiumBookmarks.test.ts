import { describe, expect, it } from "vite-plus/test";

import { parseChromiumBookmarkBar } from "./ChromiumBookmarks.ts";

describe("parseChromiumBookmarkBar", () => {
  it("reads the bar's bookmarks and folders, with other bookmarks last", () => {
    const file = JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          children: [
            { type: "url", name: "Staging", url: "https://staging.example.com/" },
            {
              type: "folder",
              name: "Docs",
              children: [{ type: "url", name: "", url: "https://docs.example.com/" }],
            },
            { type: "url", name: "Bookmarklet", url: "javascript:alert(1)" },
          ],
        },
        other: {
          type: "folder",
          children: [{ type: "url", name: "Mail", url: "https://mail.example.com/" }],
        },
        synced: { type: "folder", children: [] },
      },
    });

    expect(parseChromiumBookmarkBar(file)).toEqual([
      { name: "Staging", url: "https://staging.example.com/" },
      {
        name: "Docs",
        children: [{ name: "https://docs.example.com/", url: "https://docs.example.com/" }],
      },
      { name: "Other bookmarks", children: [{ name: "Mail", url: "https://mail.example.com/" }] },
    ]);
  });

  it("refuses a file that is not a bookmarks file", () => {
    expect(parseChromiumBookmarkBar("not json")).toBeNull();
    expect(parseChromiumBookmarkBar(JSON.stringify({ version: 1 }))).toBeNull();
  });
});
