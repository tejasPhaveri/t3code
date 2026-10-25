import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PreviewAnnotationPayload, ScopedThreadRef } from "@t3tools/contracts";

import { type ComposerImageAttachment, useComposerDraftStore } from "./composerDraftStore";
import { isElectron } from "./env";
import { isPanelWindow } from "./panelWindow";

const PANEL_WINDOW_ANNOTATION_CHANNEL = "t3code:panel-window-annotation";

interface ForwardedAnnotation {
  readonly threadRef: ScopedThreadRef;
  readonly annotation: PreviewAnnotationPayload;
  readonly image: ComposerImageAttachment | null;
  readonly send: boolean;
}

type AnnotationSender = (
  annotation: PreviewAnnotationPayload,
  image: ComposerImageAttachment | null,
) => void;

const senders = new Map<string, AnnotationSender>();

/**
 * The panel window has no composer, and composer drafts are not shared between windows, so what
 * is picked there goes to the main window's composer.
 */
export function forwardAnnotationToMainWindow(message: ForwardedAnnotation): void {
  const channel = new BroadcastChannel(PANEL_WINDOW_ANNOTATION_CHANNEL);
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no target origin.
  channel.postMessage(message);
  channel.close();
}

/** The main window's chat sends an annotation the panel window asked to send right away. */
export function registerAnnotationSender(threadKey: string, send: AnnotationSender): () => void {
  senders.set(threadKey, send);
  return () => {
    if (senders.get(threadKey) === send) senders.delete(threadKey);
  };
}

export function installPanelWindowAnnotationForwarding(): () => void {
  if (!isElectron || isPanelWindow) return () => {};
  const channel = new BroadcastChannel(PANEL_WINDOW_ANNOTATION_CHANNEL);
  channel.addEventListener("message", (event: MessageEvent<ForwardedAnnotation>) => {
    const { threadRef, annotation, image, send } = event.data;
    const composer = useComposerDraftStore.getState();
    composer.addPreviewAnnotation(threadRef, annotation);
    if (image) composer.addImage(threadRef, image);
    if (send) senders.get(scopedThreadKey(threadRef))?.(annotation, image);
  });
  return () => channel.close();
}
