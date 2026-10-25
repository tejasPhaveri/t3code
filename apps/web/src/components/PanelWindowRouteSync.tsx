import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { flushComposerDraftStorage, useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { isElectron } from "../env";
import { isPanelWindow, useRightPanelDetached } from "../panelWindow";

const PANEL_WINDOW_ROUTE_CHANNEL = "t3code:panel-window-route";

type PanelWindowRouteMessage =
  | { readonly type: "hello" }
  | { readonly type: "route"; readonly href: string; readonly draft: boolean };

function isPanelWindowRouteMessage(value: unknown): value is PanelWindowRouteMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "hello") return true;
  return (
    value.type === "route" &&
    "href" in value &&
    typeof value.href === "string" &&
    "draft" in value &&
    typeof value.draft === "boolean"
  );
}

/**
 * Keeps the main window and the panel window on the same chat. Either may switch chats; the other
 * follows. Only chat routes cross, so the panel window never shows Settings or the home page.
 */
export function PanelWindowRouteSync() {
  const detached = useRightPanelDetached();
  const active = isElectron && (isPanelWindow || detached);
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const routeTarget = useThreadRouteTarget();
  const chatHref = routeTarget === null ? null : href;
  const chatIsDraft = routeTarget?.kind === "draft";
  const channelRef = useRef<BroadcastChannel | null>(null);
  // The last chat either window announced, so a followed navigation is not echoed back.
  const syncedHrefRef = useRef<string | null>(null);

  const postChat = (target: string, draft: boolean) => {
    // A new chat's draft lives in this window's storage until the debounced write lands.
    if (draft) flushComposerDraftStorage();
    channelRef.current?.postMessage({ type: "route", href: target, draft });
  };
  const announceChat = useEffectEvent(() => {
    if (chatHref === null || chatHref === syncedHrefRef.current) return;
    syncedHrefRef.current = chatHref;
    postChat(chatHref, chatIsDraft);
  });

  const onMessage = useEffectEvent((message: unknown) => {
    if (!isPanelWindowRouteMessage(message)) return;
    if (message.type === "hello") {
      if (chatHref !== null) postChat(chatHref, chatIsDraft);
      return;
    }
    syncedHrefRef.current = message.href;
    if (message.href === href) return;
    const follow = () => void router.navigate({ href: message.href, replace: isPanelWindow });
    // The draft arrived through storage after this window loaded its own copy.
    if (message.draft) void Promise.resolve(useComposerDraftStore.persist.rehydrate()).then(follow);
    else follow();
  });

  useEffect(() => {
    if (!active || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(PANEL_WINDOW_ROUTE_CHANNEL);
    channelRef.current = channel;
    channel.addEventListener("message", (event) => onMessage(event.data));
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A BroadcastChannel takes no target origin.
    if (isPanelWindow) channel.postMessage({ type: "hello" });
    return () => {
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (active) announceChat();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each chat this window switches to is announced once.
  }, [active, chatHref]);

  return null;
}
