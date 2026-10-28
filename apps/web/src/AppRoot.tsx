import { RouterProvider } from "@tanstack/react-router";

import { BrowserSessionRestorer } from "./browser/BrowserSessionRestorer";
import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { isPanelWindow } from "./panelWindow";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      <ElectronBrowserHost />
      {/* The main window restores browser sessions for both windows. */}
      {isPanelWindow ? null : <BrowserSessionRestorer />}
      <QuitHoldOverlay />
    </AppAtomRegistryProvider>
  );
}
