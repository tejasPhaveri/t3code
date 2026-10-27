import { describe, expect, it } from "vite-plus/test";

import { createMemoryStorage, resolveSharedWindowStorage } from "./storage";

describe("resolveSharedWindowStorage", () => {
  it("lets a window that changed nothing leave the other window's save alone", () => {
    // Two app windows over one localStorage, each with its own wrapper.
    const shared = createMemoryStorage();
    shared.setItem("tabs", "old order");
    const main = resolveSharedWindowStorage(shared);
    const panel = resolveSharedWindowStorage(shared);
    main.getItem("tabs");
    panel.getItem("tabs");

    main.setItem("tabs", "dragged order");
    // The panel window has not reloaded yet and saves its unchanged copy.
    panel.setItem("tabs", "old order");
    expect(shared.getItem("tabs")).toBe("dragged order");

    // Once it reloads, a real change of its own is saved.
    expect(panel.getItem("tabs")).toBe("dragged order");
    panel.setItem("tabs", "panel order");
    expect(shared.getItem("tabs")).toBe("panel order");
  });
});
