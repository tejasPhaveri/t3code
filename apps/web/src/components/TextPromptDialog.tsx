import { useState } from "react";

import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

export interface TextPrompt {
  readonly title: string;
  readonly description?: string;
  readonly placeholder: string;
  readonly initialValue: string;
  /** An empty value is allowed (e.g. a stash message). */
  readonly optional?: boolean;
  readonly confirmLabel: string;
  readonly checkbox?: { readonly label: string; readonly initial: boolean };
  readonly onConfirm: (value: string, checked: boolean) => void;
}

/** Asks for one line of text, optionally with a checkbox (a branch name, a stash message). */
export function TextPromptDialog(props: {
  readonly prompt: TextPrompt;
  readonly onClose: () => void;
}) {
  const { prompt } = props;
  const [value, setValue] = useState(prompt.initialValue);
  const [checked, setChecked] = useState(prompt.checkbox?.initial ?? false);
  const canConfirm = prompt.optional === true || value.trim().length > 0;
  const confirm = () => {
    if (!canConfirm) return;
    props.onClose();
    prompt.onConfirm(value.trim(), checked);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{prompt.title}</DialogTitle>
          {prompt.description ? <DialogDescription>{prompt.description}</DialogDescription> : null}
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            <Input
              nativeInput
              autoFocus
              aria-label={prompt.title}
              placeholder={prompt.placeholder}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirm();
                }
              }}
            />
            {prompt.checkbox ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={checked} onCheckedChange={(next) => setChecked(next === true)} />
                {prompt.checkbox.label}
              </label>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={!canConfirm} onClick={confirm}>
            {prompt.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
