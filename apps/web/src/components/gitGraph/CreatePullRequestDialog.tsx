import { useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { defaultPullRequestBase } from "./gitGraphBranches";

export function CreatePullRequestDialog(props: {
  readonly branches: readonly string[];
  readonly initialHead: string;
  readonly initialBase: string;
  readonly onClose: () => void;
  readonly onConfirm: (head: string, base: string) => void;
}) {
  const [head, setHead] = useState(props.initialHead);
  const [base, setBase] = useState(props.initialBase);
  const bases = props.branches.filter((name) => name !== head);
  const canConfirm = bases.includes(base);

  const changeHead = (next: string | null) => {
    if (next === null || !props.branches.includes(next)) return;
    setHead(next);
    if (next === base) {
      setBase(defaultPullRequestBase(next, props.branches, null));
    }
  };

  const confirm = () => {
    if (!canConfirm) return;
    props.onClose();
    props.onConfirm(head, base);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create pull request</DialogTitle>
          <DialogDescription>
            {bases.length === 0
              ? "Create another local branch first. A pull request needs two different branches."
              : `Pushes ${head} first if it is not on the remote.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">From</span>
              <Select value={head} onValueChange={changeHead}>
                <SelectTrigger size="sm" aria-label="Branch to open">
                  <SelectValue>{head}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {props.branches.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Into</span>
              <Select
                value={base}
                onValueChange={(next) => {
                  if (next !== null && bases.includes(next)) setBase(next);
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Branch it opens into"
                  disabled={bases.length === 0}
                >
                  <SelectValue>{bases.includes(base) ? base : "Choose a branch"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {bases.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={!canConfirm} onClick={confirm}>
            Create pull request
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
