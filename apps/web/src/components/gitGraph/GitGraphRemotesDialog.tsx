import type { EnvironmentId, GitGraphAction, GitGraphRemote } from "@t3tools/contracts";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { gitGraphEnvironment } from "~/state/gitGraph";
import { useEnvironmentQuery } from "~/state/query";

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
import { Input } from "../ui/input";

type RunAction = (
  action: GitGraphAction,
  options?: { readonly success?: string },
) => Promise<boolean>;

/**
 * Git Graph's Repository Settings widget, reduced to what this surface needs: the remotes a
 * repository fetches from and pushes to. Editing one is an explicit save, not a live mutation,
 * so a half-typed URL never reaches git.
 */
export function GitGraphRemotesDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly open: boolean;
  readonly runAction: RunAction;
  readonly onClose: () => void;
}) {
  const remotes = useEnvironmentQuery(
    props.open
      ? gitGraphEnvironment.remotes({
          environmentId: props.environmentId,
          input: { cwd: props.cwd },
        })
      : null,
  );
  const [addedName, setAddedName] = useState("");
  const [addedUrl, setAddedUrl] = useState("");
  const [editing, setEditing] = useState<{ readonly name: string; readonly url: string } | null>(
    null,
  );

  const canAdd = addedName.trim().length > 0 && addedUrl.trim().length > 0;

  const close = () => {
    setAddedName("");
    setAddedUrl("");
    setEditing(null);
    props.onClose();
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Repository settings</DialogTitle>
          <DialogDescription>Remotes this repository fetches from and pushes to.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            {remotes.error && remotes.data === null ? (
              <div className="text-destructive">{remotes.error}</div>
            ) : null}
            {remotes.data?.remotes.length === 0 ? (
              <p className="text-muted-foreground">This repository has no remotes yet.</p>
            ) : null}
            {remotes.data?.remotes.map((remote) => (
              <RemoteRow
                key={remote.name}
                remote={remote}
                editing={editing?.name === remote.name ? editing : null}
                onEdit={() =>
                  setEditing(
                    editing?.name === remote.name
                      ? null
                      : { name: remote.name, url: remote.fetchUrl ?? "" },
                  )
                }
                onChangeUrl={(url) =>
                  setEditing((current) => (current === null ? null : { ...current, url }))
                }
                onSave={async () => {
                  if (editing === null) return;
                  const saved = await props.runAction(
                    { _tag: "EditRemote", name: editing.name, url: editing.url.trim() },
                    { success: `Updated ${editing.name}` },
                  );
                  if (saved) setEditing(null);
                }}
                onRemove={async () => {
                  const removed = await props.runAction(
                    { _tag: "RemoveRemote", name: remote.name },
                    { success: `Removed ${remote.name}` },
                  );
                  if (removed) remotes.refresh();
                }}
              />
            ))}
            <div className="space-y-1.5 border-t border-border pt-2">
              <span className="font-medium">Add a remote</span>
              <div className="flex gap-1.5">
                <Input
                  size="sm"
                  aria-label="Remote name"
                  placeholder="upstream"
                  value={addedName}
                  onChange={(event) => setAddedName(event.target.value)}
                />
                <Input
                  size="sm"
                  aria-label="Remote URL"
                  placeholder="git@github.com:owner/repo.git"
                  value={addedUrl}
                  onChange={(event) => setAddedUrl(event.target.value)}
                />
              </div>
              <Button
                size="xs"
                disabled={!canAdd}
                onClick={async () => {
                  const added = await props.runAction(
                    { _tag: "AddRemote", name: addedName.trim(), url: addedUrl.trim() },
                    { success: `Added ${addedName.trim()}` },
                  );
                  if (added) {
                    setAddedName("");
                    setAddedUrl("");
                    remotes.refresh();
                  }
                }}
              >
                <Plus />
                Add remote
              </Button>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RemoteRow(props: {
  readonly remote: GitGraphRemote;
  readonly editing: { readonly name: string; readonly url: string } | null;
  readonly onEdit: () => void;
  readonly onChangeUrl: (url: string) => void;
  readonly onSave: () => void;
  readonly onRemove: () => void;
}) {
  const { remote } = props;
  return (
    <div className="rounded-md border border-border/60 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-mono font-medium">{remote.name}</span>
        <Button size="xs" variant="ghost-muted" onClick={props.onEdit}>
          {props.editing === null ? "Edit" : "Cancel"}
        </Button>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={`Remove ${remote.name}`}
          onClick={props.onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      {props.editing === null ? (
        <p className="min-w-0 truncate text-muted-foreground">{remote.fetchUrl ?? "No URL"}</p>
      ) : (
        <div className="mt-1 flex gap-1.5">
          <Input
            size="sm"
            aria-label={`URL for ${remote.name}`}
            value={props.editing.url}
            onChange={(event) => props.onChangeUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onSave();
            }}
          />
          <Button size="xs" disabled={props.editing.url.trim().length === 0} onClick={props.onSave}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
