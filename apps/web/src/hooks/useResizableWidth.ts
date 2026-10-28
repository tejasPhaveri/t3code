import * as Schema from "effect/Schema";
import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "./useLocalStorage";
import { useResizeDrag } from "./useResizeDrag";

const WidthSchema = Schema.Finite;

/** The host must size itself from this custom property. */
export const RESIZABLE_WIDTH_PROPERTY = "--resizable-width";

export interface UseResizableWidthOptions {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly edge: "left" | "right";
}

export interface ResizableWidthHandlers {
  readonly ref: (node: HTMLElement | null) => (() => void) | undefined;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
}

// Null until dragged, so the default keeps following bounds measured after mount.
const savedWidths = new Map<string, number | null>();
const widthListeners = new Map<string, Set<() => void>>();

function readSavedWidth(storageKey: string): number | null {
  const cached = savedWidths.get(storageKey);
  if (cached !== undefined) return cached;
  let width: number | null = null;
  try {
    width = getLocalStorageItem(storageKey, WidthSchema) ?? null;
  } catch (error) {
    console.error("Could not read persisted panel width.", error);
  }
  savedWidths.set(storageKey, width);
  return width;
}

function subscribeSavedWidth(storageKey: string, listener: () => void): () => void {
  const listeners = widthListeners.get(storageKey) ?? new Set();
  widthListeners.set(storageKey, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) widthListeners.delete(storageKey);
  };
}

/** Saves a panel's width, or null for its default, and resizes every panel using that key. */
export function setResizableWidth(storageKey: string, width: number | null): void {
  savedWidths.set(storageKey, width);
  try {
    if (width === null) removeLocalStorageItem(storageKey);
    else setLocalStorageItem(storageKey, width, WidthSchema);
  } catch (error) {
    console.error("Could not persist panel width.", error);
  }
  for (const listener of widthListeners.get(storageKey) ?? []) listener();
}

/** The width saved under a key, or null while the panel keeps its default. */
export function useSavedResizableWidth(storageKey: string): number | null {
  return useSyncExternalStore(
    (listener) => subscribeSavedWidth(storageKey, listener),
    () => readSavedWidth(storageKey),
    () => null,
  );
}

/** Persist on drag end to avoid a storage write on every animation frame. */
export function useResizableWidth(options: UseResizableWidthOptions): {
  readonly width: number;
  readonly handlers: ResizableWidthHandlers;
} {
  const { storageKey, defaultWidth, minWidth, maxWidth, edge } = options;

  const clamp = (value: number): number => {
    if (!Number.isFinite(value)) return defaultWidth;
    return Math.max(minWidth, Math.min(maxWidth, value));
  };

  const savedWidth = useSavedResizableWidth(storageKey);
  const clampedWidth = clamp(savedWidth ?? defaultWidth);

  const drag = useResizeDrag<HTMLElement>((event) => {
    const host = event.currentTarget.parentElement;
    // Disable drag transitions through transition-property; the host renders transition-duration.
    host?.style.setProperty("transition-property", "none");
    // The drag commits to the key and width it started from, even if the panel
    // switches keys before the pointer is released.
    const startStorageKey = storageKey;
    const startWidth = clampedWidth;
    return {
      width: startWidth,
      edge,
      bounds: { min: minWidth, max: maxWidth },
      resize(nextWidth) {
        host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${nextWidth}px`);
        return nextWidth;
      },
      finish(finalWidth) {
        setResizableWidth(startStorageKey, finalWidth);
      },
      cleanup(committed) {
        host?.style.removeProperty("transition-property");
        if (!committed) host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${startWidth}px`);
      },
    };
  });

  // Bounds can change mid-drag (sidebar opens, window narrows), and the render
  // that carries them rewrites the committed width, so re-apply the live pointer position.
  const { refresh } = drag;
  useLayoutEffect(() => refresh({ min: minWidth, max: maxWidth }), [refresh, minWidth, maxWidth]);

  return {
    width: clampedWidth,
    handlers: {
      ref: drag.ref,
      onPointerDown: drag.onPointerDown,
      onPointerMove: drag.onPointerMove,
      onPointerUp: drag.onPointerUp,
      onPointerCancel: drag.onPointerCancel,
      onLostPointerCapture: drag.onLostPointerCapture,
    },
  };
}
