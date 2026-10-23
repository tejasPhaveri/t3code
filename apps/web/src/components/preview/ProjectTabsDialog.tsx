import {
  BROWSER_PROJECT_TABS_MAX,
  type BrowserProfile,
  type BrowserProjectSetup,
  type BrowserProjectTab,
} from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

interface DraftTab {
  readonly key: number;
  readonly profileId: string;
  readonly url: string;
}

function normalizedUrl(url: string): string | null {
  try {
    return normalizePreviewUrl(url);
  } catch {
    return null;
  }
}

/** Sets which profile opens which pages for one project. */
export function ProjectTabsDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projectTitle: string;
  readonly profiles: readonly BrowserProfile[];
  readonly profileAccents: Readonly<Record<string, string>>;
  readonly defaultProfileId: string;
  readonly setup: BrowserProjectSetup | undefined;
  /** The project's open tabs, in strip order, offered as a starting point. */
  readonly openTabs: readonly BrowserProjectTab[];
  readonly onSave: (setup: BrowserProjectSetup, openNow: boolean) => void;
}) {
  const [nextKey, setNextKey] = useState(0);
  const [tabs, setTabs] = useState<readonly DraftTab[]>([]);
  const [openAutomatically, setOpenAutomatically] = useState(true);
  const [loadedFor, setLoadedFor] = useState<boolean>(false);

  // Each opening starts from the saved setup, not from an abandoned edit.
  if (props.open && !loadedFor) {
    const initial = props.setup?.tabs ?? [];
    setTabs(initial.map((tab, index) => ({ key: index, ...tab })));
    setNextKey(initial.length);
    setOpenAutomatically(props.setup?.openAutomatically ?? true);
    setLoadedFor(true);
  } else if (!props.open && loadedFor) {
    setLoadedFor(false);
  }

  const replaceWith = (source: readonly BrowserProjectTab[]) => {
    setTabs(source.map((tab, index) => ({ key: nextKey + index, ...tab })));
    setNextKey(nextKey + source.length);
  };
  const update = (key: number, patch: Partial<Omit<DraftTab, "key">>) =>
    setTabs(tabs.map((tab) => (tab.key === key ? { ...tab, ...patch } : tab)));
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= tabs.length) return;
    const next = [...tabs];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setTabs(next);
  };
  const invalidKeys = new Set(
    tabs.filter((tab) => normalizedUrl(tab.url) === null).map((tab) => tab.key),
  );
  const save = (openNow: boolean) => {
    if (invalidKeys.size > 0) return;
    props.onSave(
      {
        tabs: tabs.map((tab) => ({ profileId: tab.profileId, url: normalizedUrl(tab.url)! })),
        openAutomatically,
      },
      openNow,
    );
    props.onOpenChange(false);
  };
  const profileName = (profileId: string) =>
    props.profiles.find((profile) => profile.id === profileId)?.name ?? profileId;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-h-[80dvh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project tabs for {props.projectTitle}</DialogTitle>
          <DialogDescription>
            The pages each browser profile opens in this project. Every chat in the project shares
            them, and a page loads the first time you show its tab.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            {tabs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tabs yet.</p>
            ) : null}
            {tabs.map((tab, index) => (
              <div key={tab.key} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: props.profileAccents[tab.profileId] }}
                />
                <Select
                  value={tab.profileId}
                  onValueChange={(value) => {
                    if (typeof value === "string") update(tab.key, { profileId: value });
                  }}
                >
                  <SelectTrigger size="sm" className="w-44 shrink-0" aria-label="Browser profile">
                    <SelectValue>{profileName(tab.profileId)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {props.profiles.map((profile) => (
                      <SelectItem hideIndicator key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Input
                  nativeInput
                  size="sm"
                  aria-label="Page URL"
                  aria-invalid={invalidKeys.has(tab.key) && tab.url.length > 0}
                  placeholder="https://staging.example.com"
                  value={tab.url}
                  onChange={(event) => update(tab.key, { url: event.target.value })}
                />
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="Move down"
                  disabled={index === tabs.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="Remove tab"
                  onClick={() => setTabs(tabs.filter((entry) => entry.key !== tab.key))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="xs"
                variant="outline"
                disabled={tabs.length >= BROWSER_PROJECT_TABS_MAX}
                onClick={() => {
                  setTabs([...tabs, { key: nextKey, profileId: props.defaultProfileId, url: "" }]);
                  setNextKey(nextKey + 1);
                }}
              >
                <Plus />
                Add tab
              </Button>
              <Button
                size="xs"
                variant="ghost-muted"
                disabled={props.openTabs.length === 0}
                onClick={() => replaceWith(props.openTabs.slice(0, BROWSER_PROJECT_TABS_MAX))}
              >
                Use the {props.openTabs.length} open tabs
              </Button>
            </div>
            <label className="flex items-center gap-2 pt-2 text-sm">
              <Checkbox
                checked={openAutomatically}
                onCheckedChange={(checked) => setOpenAutomatically(checked === true)}
              />
              Open these when the project has no tabs from last time
            </label>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" disabled={invalidKeys.size > 0} onClick={() => save(false)}>
            Save
          </Button>
          <Button disabled={invalidKeys.size > 0 || tabs.length === 0} onClick={() => save(true)}>
            Save and open tabs
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
