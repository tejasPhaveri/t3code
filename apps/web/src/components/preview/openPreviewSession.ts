import type {
  BrowserPersistence,
  EnvironmentId,
  PreviewOpenInput,
  PreviewRuntime,
  PreviewSessionSnapshot,
  PreviewViewportSetting,
  PreviewZoomFactor,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { resolveBrowserDefaults } from "~/browser/browserDefaults";
import { BrowserSettingsReadError } from "~/browser/openFileInPreview";
import { previewOpenScope } from "~/browser/browserScope";
import { previewRuntimeFor } from "~/browser/previewRuntime";
import { applyPreviewServerSnapshot, rememberPreviewUrl } from "~/previewStateStore";

interface OpenPreviewSessionInput<E> {
  openPreview: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: PreviewOpenInput;
  }) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;
  threadRef: ScopedThreadRef;
  url?: string;
  viewport?: PreviewViewportSetting;
  profileId?: string;
  projectId?: string;
  isolated?: boolean;
  persistence?: BrowserPersistence;
  runtime?: PreviewRuntime;
  title?: string;
  lazy?: boolean;
  zoomFactor?: PreviewZoomFactor;
}

export async function openPreviewSession<E>(
  input: OpenPreviewSessionInput<E>,
): Promise<AtomCommandResult<PreviewSessionSnapshot, E | BrowserSettingsReadError>> {
  // Wait for settings hydration so new tabs cannot retain uncorrected schema defaults.
  const defaults = await resolveBrowserDefaults().catch(
    (cause: unknown) => new BrowserSettingsReadError({ cause }),
  );
  if (defaults instanceof BrowserSettingsReadError) {
    return AsyncResult.failure(Cause.fail(defaults));
  }
  const runtime = input.runtime ?? previewRuntimeFor(input.threadRef.environmentId);
  const result = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.lazy ? { lazy: true } : {}),
      ...(input.zoomFactor === undefined ? {} : { zoomFactor: input.zoomFactor }),
      viewport: input.viewport ?? defaults.viewport,
      profileId: input.profileId ?? defaults.profileId,
      ...previewOpenScope({
        persistence: input.persistence ?? defaults.persistence,
        threadRef: input.threadRef,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.isolated ? { isolated: true } : {}),
      }),
      ...(runtime === undefined || runtime === "desktop" ? {} : { runtime }),
    },
  });
  if (result._tag === "Failure") {
    return result;
  }
  const snapshot = result.value;
  applyPreviewServerSnapshot(input.threadRef, snapshot);
  if (input.url !== undefined) {
    rememberPreviewUrl(
      input.threadRef,
      snapshot.navStatus._tag === "Idle" ? input.url : snapshot.navStatus.url,
    );
  }
  return result;
}
