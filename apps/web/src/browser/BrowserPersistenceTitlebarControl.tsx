import { type BrowserPersistence, isBrowserPersistence } from "@t3tools/contracts";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import { useClientSettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { isMacPlatform } from "~/lib/utils";

const BROWSER_PERSISTENCE_TITLEBAR_LABELS = {
  thread: "Per chat",
  project: "Per project",
  environment: "Per environment",
} as const satisfies Record<BrowserPersistence, string>;

/**
 * Lives in the macOS hidden-inset title bar, beside the panel toggles.
 * Other platforms keep the same setting in Integrations.
 */
export function BrowserPersistenceTitlebarControl() {
  const persistence = useClientSettings((settings) => settings.browserPersistence);
  const updateSettings = useUpdatePrimarySettings();
  if (!isElectron || !isMacPlatform(navigator.platform)) return null;

  return (
    <span className="mr-1 flex items-center [-webkit-app-region:no-drag]">
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Button
                    variant="ghost-muted"
                    size="xs"
                    type="button"
                    aria-label="Browser persistence"
                  />
                }
              />
            }
          >
            {BROWSER_PERSISTENCE_TITLEBAR_LABELS[persistence]}
          </TooltipTrigger>
          <TooltipPopup side="bottom">{persistenceTooltip(persistence)}</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" side="bottom" sideOffset={6}>
          <MenuGroup>
            <MenuGroupLabel>Browser persistence</MenuGroupLabel>
            <MenuRadioGroup
              value={persistence}
              onValueChange={(value) => {
                if (value !== null && isBrowserPersistence(value)) {
                  updateSettings({ browserPersistence: value });
                }
              }}
            >
              <MenuRadioItem value="project">
                {BROWSER_PERSISTENCE_TITLEBAR_LABELS.project}
              </MenuRadioItem>
              <MenuRadioItem value="environment">
                {BROWSER_PERSISTENCE_TITLEBAR_LABELS.environment}
              </MenuRadioItem>
              <MenuRadioItem value="thread">
                {BROWSER_PERSISTENCE_TITLEBAR_LABELS.thread}
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </span>
  );
}

function persistenceTooltip(persistence: BrowserPersistence): string {
  switch (persistence) {
    case "project":
      return "Browser tabs and logins stay available across chats in this project";
    case "environment":
      return "Browser tabs and logins stay available across projects on this Mac";
    case "thread":
      return "Each chat keeps its own browser tabs and logins";
    default: {
      const exhaustive: never = persistence;
      return exhaustive;
    }
  }
}
