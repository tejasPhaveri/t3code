import type { ConfirmDialogVariant, EnvironmentId, GitGraphAction } from "@t3tools/contracts";
import * as Cause from "effect/Cause";

import { useStableCallback } from "~/hooks/useStableCallback";
import { readLocalApi } from "~/localApi";
import { gitGraphEnvironment } from "~/state/gitGraph";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { toastManager } from "../ui/toast";

const FAILURE_TITLES: Record<GitGraphAction["_tag"], string> = {
  Stage: "Could not stage",
  Unstage: "Could not unstage",
  Discard: "Could not discard changes",
  Commit: "Commit failed",
  Fetch: "Fetch failed",
  Checkout: "Checkout failed",
  CreateBranch: "Could not create the branch",
  Merge: "Merge stopped",
  MergeAbort: "Could not abort the merge",
  Stash: "Could not stash",
  StashApply: "Could not apply the stash",
  StashPop: "Could not pop the stash",
  StashDrop: "Could not drop the stash",
  DeleteBranch: "Could not delete the branch",
  RenameBranch: "Could not rename the branch",
  Push: "Push failed",
  Pull: "Pull stopped",
  Rebase: "Rebase stopped",
  Reset: "Could not reset",
  CherryPick: "Cherry-pick stopped",
  Revert: "Revert stopped",
  DropCommit: "Could not drop the commit",
  CreateTag: "Could not create the tag",
  DeleteTag: "Could not delete the tag",
  PushTag: "Could not push the tag",
  CleanUntracked: "Could not clean untracked files",
  AddRemote: "Could not add the remote",
  EditRemote: "Could not change the remote",
  RemoveRemote: "Could not remove the remote",
};

/** Git's own explanation (a hook's output, a conflict), not the generic RPC wrapper. */
function failureDetail(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (typeof error === "object" && error !== null && "detail" in error) {
    const detail = (error as { readonly detail: unknown }).detail;
    if (typeof detail === "string" && detail.trim().length > 0) return detail;
  }
  return formatEnvironmentQueryError(cause);
}

export async function confirmGitGraphAction(
  message: string,
  variant: ConfirmDialogVariant = "destructive",
): Promise<boolean> {
  const api = readLocalApi();
  if (!api) return window.confirm(message);
  try {
    return await api.dialogs.confirm(message, { variant });
  } catch {
    return false;
  }
}

/** Runs one Git action in the project's checkout (or one of its worktrees), then refreshes. */
export function useGitGraphAction(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly onSettled: () => void;
}) {
  const runCommand = useAtomCommand(gitGraphEnvironment.action, { reportFailure: false });
  return useStableCallback(
    async (
      action: GitGraphAction,
      options?: { readonly worktreePath?: string; readonly success?: string },
    ): Promise<boolean> => {
      if (input.cwd === null) return false;
      const result = await runCommand({
        environmentId: input.environmentId,
        input: {
          cwd: input.cwd,
          ...(options?.worktreePath === undefined ? {} : { worktreePath: options.worktreePath }),
          action,
        },
      });
      input.onSettled();
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: FAILURE_TITLES[action._tag],
          description: failureDetail(result.cause),
        });
        return false;
      }
      if (options?.success) toastManager.add({ type: "success", title: options.success });
      return true;
    },
  );
}
