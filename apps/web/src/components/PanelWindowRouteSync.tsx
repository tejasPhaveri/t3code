import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { flushComposerDraftStorage, useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { isElectron } from "../env";
import { isPanelWindow, useRightPanelDetached } from "../panelWindow";

const PANEL_WINDOW_ROUTE_CHANNEL = "t3code:panel-window-route";

type PanelWindowRouteMessage =
  | { readonly type: "hello" }
  | { readonly type: "route"; readonly href: string };

function isPanelWindowRouteMessage(value: unknown): value is PanelWindowRouteMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "hello") return true;
  return value.type === "route" && "href" in value && typeof value.href === "string";
}

/**
 * Keeps the main window and the panel window on the same chat. The main window owns the route
 * and the drafts. The panel window announces only a chat the user opened in it, never one it
 * loaded on, followed, or was redirected to, so its stale copy cannot pull the main window away.
 * Only chat routes cross, so the panel window never shows Settings or the home page.
 */
export function PanelWindowRouteSync() {
  const detached = useRightPanelDetached();
  const active = isElectron && (isPanelWindow || detached);
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const routeTarget = useThreadRouteTarget();
  const chatHref = routeTarget === null ? null : href;
  const channelRef = useRef<BroadcastChannel | null>(null);
  // The last chat either window announced, so a followed navigation is not echoed back.
  const syncedHrefRef = useRef<string | null>(null);
  // Follows and redirects replace; only the panel window user's own navigation pushes.
  const panelUserNavigatedRef = useRef(false);

  const postChat = (target: string) => {
    // A new chat's draft lives in the main window's storage until the debounced write lands.
    if (!isPanelWindow) flushComposerDraftStorage();
    channelRef.current?.postMessage({ type: "route", href: target });
  };
  const announceChat = useEffectEvent(() => {
    if (chatHref === null || chatHref === syncedHrefRef.current) return;
    syncedHrefRef.current = chatHref;
    if (isPanelWindow && !panelUserNavigatedRef.current) return;
    postChat(chatHref);
  });

  const onMessage = useEffectEvent((message: unknown) => {
    if (!isPanelWindowRouteMessage(message)) return;
    if (message.type === "hello") {
      if (!isPanelWindow && chatHref !== null) postChat(chatHref);
      return;
    }
    syncedHrefRef.current = message.href;
    if (message.href === href) return;
    if (!isPanelWindow) {
      void router.navigate({ href: message.href });
      return;
    }
    // The main window's drafts arrive through storage after this window loaded its own copy.
    void Promise.resolve(useComposerDraftStore.persist.rehydrate()).then(() => {
      if (syncedHrefRef.current !== message.href) return;
      void router.navigate({ href: message.href, replace: true });
    });
  });

  useEffect(() => {
    if (!active || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(PANEL_WINDOW_ROUTE_CHANNEL);
    channelRef.current = channel;
    channel.addEventListener("message", (event) => onMessage(event.data));
    const stopWatchingHistory = isPanelWindow
      ? router.history.subscribe(({ action }) => {
          panelUserNavigatedRef.current = action.type === "PUSH";
        })
      : undefined;
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A BroadcastChannel takes no target origin.
    if (isPanelWindow) channel.postMessage({ type: "hello" });
    return () => {
      stopWatchingHistory?.();
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [active, router]);

  useEffect(() => {
    if (active) announceChat();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each chat this window switches to is announced once.
  }, [active, chatHref]);

  return null;
}
