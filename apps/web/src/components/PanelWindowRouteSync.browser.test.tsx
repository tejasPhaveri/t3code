import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { PanelWindowRouteSync } from "./PanelWindowRouteSync";

vi.mock("../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../env")>()),
  isElectron: true,
}));
vi.mock("../panelWindow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../panelWindow")>()),
  isPanelWindow: true,
}));

function createPanelWindowRouter(path: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <PanelWindowRouteSync />
        <Outlet />
      </>
    ),
  });
  const draftRoute = createRoute({ getParentRoute: () => rootRoute, path: "/draft/$draftId" });
  return createRouter({
    routeTree: rootRoute.addChildren([draftRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
    disableGlobalCatchBoundary: true,
  });
}

describe("PanelWindowRouteSync in the panel window", () => {
  it("announces only a chat the user opens there, not one it loaded on or followed", async () => {
    const received: unknown[] = [];
    const mainWindow = new BroadcastChannel("t3code:panel-window-route");
    using _mainWindow = { [Symbol.dispose]: () => mainWindow.close() };
    mainWindow.addEventListener("message", (event) => received.push(event.data));
    const router = createPanelWindowRouter("/draft/stale");
    // The sync needs a chat route, which the shared test router does not have.
    await using _screen = await render(<RouterProvider router={router} />, { router: false });

    await vi.waitFor(() => expect(received).toEqual([{ type: "hello" }]));
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A BroadcastChannel takes no target origin.
    mainWindow.postMessage({ type: "route", href: "/draft/current" });
    await vi.waitFor(() => expect(router.state.location.href).toBe("/draft/current"));
    await router.navigate({ to: "/draft/$draftId", params: { draftId: "reopened" } });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received).toEqual([{ type: "hello" }, { type: "route", href: "/draft/reopened" }]);
  });
});
