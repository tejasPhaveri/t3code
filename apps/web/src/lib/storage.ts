import { Debouncer } from "@tanstack/react-pacer";

export interface StateStorage<R = unknown> {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => R;
  removeItem: (name: string) => R;
}

export interface DeferredStorage<TValue> {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: TValue) => void;
  removeItem: (name: string) => void;
  flush: () => void;
}

export function createMemoryStorage(): StateStorage {
  const store = new Map<string, string>();
  return {
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => {
      store.set(name, value);
    },
    removeItem: (name) => {
      store.delete(name);
    },
  };
}

function isStateStorage(
  storage: Partial<StateStorage> | null | undefined,
): storage is StateStorage {
  return (
    storage !== null &&
    storage !== undefined &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  );
}

export function resolveStorage(storage: Partial<StateStorage> | null | undefined): StateStorage {
  return isStateStorage(storage) ? storage : createMemoryStorage();
}

/**
 * Storage for a store the main window and the panel window share. Zustand saves on every update,
 * even one that changed nothing, and a window learns of the other's saves a moment late; a stale
 * window saving its unchanged copy would undo the other window's change. So a save of exactly
 * what this window last saved or loaded is skipped.
 */
export function resolveSharedWindowStorage(
  storage: Partial<StateStorage> | null | undefined,
): StateStorage {
  const base = resolveStorage(storage);
  const lastSeen = new Map<string, string | null>();
  const remember = (name: string, value: string | null) => {
    lastSeen.set(name, value);
    return value;
  };
  return {
    getItem: (name) => {
      const value = base.getItem(name);
      return typeof value === "string" || value === null
        ? remember(name, value)
        : value.then((resolved) => remember(name, resolved));
    },
    setItem: (name, value) => {
      if (lastSeen.get(name) === value) return;
      lastSeen.set(name, value);
      return base.setItem(name, value);
    },
    removeItem: (name) => {
      lastSeen.delete(name);
      return base.removeItem(name);
    },
  };
}

export function createDeferredStorage<TValue>(
  baseStorage: Partial<StateStorage> | null | undefined,
  serialize: (value: TValue) => string,
  debounceMs: number = 300,
): DeferredStorage<TValue> {
  const resolvedStorage = resolveStorage(baseStorage);
  const debouncedSetItem = new Debouncer(
    (name: string, value: TValue) => {
      resolvedStorage.setItem(name, serialize(value));
    },
    { wait: debounceMs },
  );

  return {
    getItem: (name) => resolvedStorage.getItem(name),
    setItem: (name, value) => {
      debouncedSetItem.maybeExecute(name, value);
    },
    removeItem: (name) => {
      debouncedSetItem.cancel();
      // cancel() leaves the captured value in Pacer's lastArgs.
      debouncedSetItem.reset();
      resolvedStorage.removeItem(name);
    },
    flush: () => {
      debouncedSetItem.flush();
    },
  };
}
