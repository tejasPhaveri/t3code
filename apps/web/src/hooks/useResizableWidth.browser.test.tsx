import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { setResizableWidth, useResizableWidth } from "./useResizableWidth";

function Panel(props: { readonly storageKey: string }) {
  const { width } = useResizableWidth({
    storageKey: props.storageKey,
    defaultWidth: 540,
    minWidth: 360,
    maxWidth: 900,
    edge: "left",
  });
  return <output aria-label="Panel width">{width}</output>;
}

describe("useResizableWidth", () => {
  it("follows a width set from outside the panel, clamped, and returns to its default", async () => {
    const storageKey = "test:resizable-width:preset";
    await using _screen = await render(<Panel storageKey={storageKey} />);
    const width = page.getByLabelText("Panel width");
    await expect.element(width).toHaveTextContent("540");

    setResizableWidth(storageKey, 700);
    await expect.element(width).toHaveTextContent("700");
    expect(localStorage.getItem(storageKey)).toBe("700");

    setResizableWidth(storageKey, 2000);
    await expect.element(width).toHaveTextContent("900");

    setResizableWidth(storageKey, null);
    await expect.element(width).toHaveTextContent("540");
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
