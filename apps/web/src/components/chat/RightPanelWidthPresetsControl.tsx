import { CheckIcon, Columns2Icon, XIcon } from "lucide-react";
import { type FormEvent, memo, useState } from "react";

import {
  RESIZABLE_WIDTH_PROPERTY,
  setResizableWidth,
  useSavedResizableWidth,
} from "~/hooks/useResizableWidth";
import { useRightPanelWidthPresetsStore } from "~/rightPanelWidthPresets";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The split as shown: the panel's clamped width (its default before any drag) and the chat's. */
function readRenderedSplit(
  container: HTMLElement | null,
): { readonly panel: number; readonly chat: number } | null {
  const host = container?.querySelector<HTMLElement>('[data-preview-panel-mode="inline"]');
  const panel = Number.parseFloat(host?.style.getPropertyValue(RESIZABLE_WIDTH_PROPERTY) ?? "");
  if (!container || !Number.isFinite(panel)) return null;
  return { panel: Math.round(panel), chat: Math.round(container.clientWidth - panel) };
}

/** Saved chat and right panel splits for the chat header: Default plus the user's own. */
export const RightPanelWidthPresetsControl = memo(function RightPanelWidthPresetsControl(props: {
  readonly widthStorageKey: string;
  readonly container: HTMLElement | null;
  readonly onApply: () => void;
}) {
  const presets = useRightPanelWidthPresetsStore((state) => state.presets);
  const savedWidth = useSavedResizableWidth(props.widthStorageKey);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Measured when the menu opens; the split cannot change while it is open.
  const [split, setSplit] = useState<ReturnType<typeof readRenderedSplit>>(null);
  const changeOpen = (next: boolean) => {
    if (next) setSplit(readRenderedSplit(props.container));
    setOpen(next);
  };

  const apply = (width: number | null) => {
    setResizableWidth(props.widthStorageKey, width);
    props.onApply();
    changeOpen(false);
  };
  const saveCurrent = (event: FormEvent) => {
    event.preventDefault();
    const width = split?.panel ?? savedWidth;
    const trimmed = name.trim();
    if (width === null || trimmed.length === 0) return;
    useRightPanelWidthPresetsStore.getState().save(trimmed, width);
    setName("");
  };
  const row = (label: string, active: boolean, onClick: () => void) => (
    <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" onClick={onClick}>
      <CheckIcon className={active ? "size-3.5" : "size-3.5 opacity-0"} />
      <span className="truncate">{label}</span>
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  className="shrink-0 [-webkit-app-region:no-drag]"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Panel width presets"
                />
              }
            />
          }
        >
          <Columns2Icon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Panel width presets</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" side="bottom" sideOffset={6}>
        <div className="flex w-60 flex-col gap-0.5">
          <div className="flex">{row("Default", savedWidth === null, () => apply(null))}</div>
          {presets.map((preset) => (
            <div key={preset.name} className="flex items-center gap-0.5">
              {row(`${preset.name} · ${preset.width}px`, savedWidth === preset.width, () =>
                apply(preset.width),
              )}
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label={`Delete ${preset.name}`}
                onClick={() => useRightPanelWidthPresetsStore.getState().remove(preset.name)}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          ))}
          <p className="mt-1.5 px-2 text-muted-foreground text-xs">
            {split
              ? `Current: chat ${split.chat}px · panel ${split.panel}px`
              : "Drag the panel edge, then save the size."}
          </p>
          <form className="flex gap-1.5" onSubmit={saveCurrent}>
            <Input
              size="sm"
              className="min-w-0 flex-1"
              placeholder="Name this size"
              aria-label="Preset name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button size="sm" type="submit" disabled={name.trim().length === 0}>
              Save
            </Button>
          </form>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
