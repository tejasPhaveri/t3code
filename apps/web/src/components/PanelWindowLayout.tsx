import type { CSSProperties, ReactNode } from "react";

import { isElectron } from "../env";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { isMacPlatform } from "../lib/utils";
import { setRightPanelDetached } from "../panelWindow";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

const MACOS_WINDOW_CONTROLS_STYLE = {
  "--workspace-controls-left": "var(--desktop-window-controls-inset, 90px)",
} as CSSProperties;

/**
 * The right panel's own window. It has no sidebar: the main window picks the chat, and ChatView
 * renders only the panel here.
 */
export function PanelWindowLayout({ children }: { children: ReactNode }) {
  const routeTarget = useThreadRouteTarget();
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  return (
    <SidebarProvider
      className="h-dvh! min-h-0!"
      open={false}
      onOpenChange={() => {}}
      style={isMacosDesktop ? MACOS_WINDOW_CONTROLS_STYLE : undefined}
    >
      {routeTarget ? children : <PanelWindowNoChat />}
    </SidebarProvider>
  );
}

function PanelWindowNoChat() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <span className="text-xs text-muted-foreground/50">Panel</span>
        </WorkspacePageHeader>
        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle>Open a chat in the main window</EmptyTitle>
              <EmptyDescription>
                This window shows the panel of the chat you have open.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={() => setRightPanelDetached(false)}>
                Move panel back
              </Button>
            </EmptyContent>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
