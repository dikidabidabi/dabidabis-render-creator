// Universal IndexedDB-backed bridge for the entire Dabidabi's project state.
//
// All existing page components keep reading/writing `localStorage` with the
// `dabidabis_*` prefix. This module makes IndexedDB the durable source of
// truth so we are immune to localStorage's ~5MB quota and to component
// unmounting:
//
//   1. On boot we copy every `dabidabis_*` entry from IndexedDB into
//      localStorage synchronously after an async load, then resolve the
//      hydration promise. The UI is gated behind this promise so pages only
//      mount once the full project is available in memory.
//   2. We monkey-patch `localStorage.setItem` / `removeItem` so every write
//      to a `dabidabis_*` key is mirrored to IndexedDB with a 1s debounce.
//      No page-level refactor is required: drawing a line, typing in
//      narasi, or editing tabulasi all auto-save universally.
//   3. Reads stay synchronous because the in-memory localStorage cache is
//      already pre-populated.
//
// IndexedDB layout: one entry per `dabidabis_*` key in a single object store
// managed by localforage. This keeps individual values small and avoids
// rewriting one giant blob on every keystroke.

import localforage from "localforage";

const PREFIX = "dabidabis_";
const HYDRATE_FLAG = "__dabidabis_hydrated__";

let store: LocalForage | null = null;
let hydratePromise: Promise<void> | null = null;
let patched = false;
const debounceTimers = new Map<string, number>();

function getStore(): LocalForage {
  if (store) return store;
  store = localforage.createInstance({
    name: "dabidabis",
    storeName: "project_v1",
    description: "Dabidabi's universal project state",
  });
  return store;
}

function scheduleWrite(key: string, value: string | null) {
  const prev = debounceTimers.get(key);
  if (prev) window.clearTimeout(prev);
  const t = window.setTimeout(() => {
    debounceTimers.delete(key);
    const db = getStore();
    if (value == null) {
      void db.removeItem(key);
    } else {
      void db.setItem(key, value);
    }
  }, 1000);
  debounceTimers.set(key, t);
}

function flushPending(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const [key, t] of debounceTimers) {
    window.clearTimeout(t);
    const db = getStore();
    const v = localStorage.getItem(key);
    tasks.push(v == null ? db.removeItem(key) : db.setItem(key, v));
  }
  debounceTimers.clear();
  return Promise.all(tasks).then(() => void 0);
}

function patchLocalStorage() {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(localStorage) as Storage;
  const origSet = proto.setItem.bind(localStorage);
  const origRemove = proto.removeItem.bind(localStorage);
  const origClear = proto.clear.bind(localStorage);

  localStorage.setItem = (k: string, v: string) => {
    origSet(k, v);
    if (k.startsWith(PREFIX)) scheduleWrite(k, v);
  };
  localStorage.removeItem = (k: string) => {
    origRemove(k);
    if (k.startsWith(PREFIX)) scheduleWrite(k, null);
  };
  localStorage.clear = () => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    origClear();
    for (const k of keys) scheduleWrite(k, null);
  };

  // Best-effort flush before unload so pending edits land in IDB.
  window.addEventListener("pagehide", () => {
    void flushPending();
  });
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPending();
  });
}

export function hydrateFromIndexedDB(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const db = getStore();
    const idbKeys: string[] = [];
    await db.iterate<string, void>((_value, key) => {
      if (typeof key === "string" && key.startsWith(PREFIX)) idbKeys.push(key);
    });

    // First-run migration: if IndexedDB is empty but localStorage already
    // holds project data, seed IndexedDB from it.
    if (idbKeys.length === 0) {
      const lsKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) lsKeys.push(k);
      }
      for (const k of lsKeys) {
        const v = localStorage.getItem(k);
        if (v != null) await db.setItem(k, v);
      }
    } else {
      // Re-hydrate localStorage cache from IndexedDB (source of truth).
      for (const k of idbKeys) {
        try {
          const v = await db.getItem<string>(k);
          if (typeof v === "string") {
            // bypass patched setItem to avoid scheduling a redundant write
            const proto = Object.getPrototypeOf(localStorage) as Storage;
            proto.setItem.call(localStorage, k, v);
          }
        } catch {
          /* ignore individual key errors */
        }
      }
    }

    patchLocalStorage();
    try {
      sessionStorage.setItem(HYDRATE_FLAG, "1");
    } catch {
      /* ignore */
    }
  })();

  return hydratePromise;
}

export async function flushIndexedDB(): Promise<void> {
  await flushPending();
}

export async function clearProjectStorage(): Promise<void> {
  await flushPending();
  const db = getStore();
  await db.clear();
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  for (const k of keys) {
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    proto.removeItem.call(localStorage, k);
  }
}

export async function snapshotIndexedDB(): Promise<Record<string, string>> {
  const db = getStore();
  await flushPending();
  const out: Record<string, string> = {};
  await db.iterate<string, void>((value, key) => {
    if (typeof key === "string" && key.startsWith(PREFIX) && typeof value === "string") {
      out[key] = value;
    }
  });
  return out;
}

export async function bulkWriteIndexedDB(entries: Record<string, string>): Promise<void> {
  const db = getStore();
  await flushPending();
  for (const [k, v] of Object.entries(entries)) {
    if (!k.startsWith(PREFIX)) continue;
    await db.setItem(k, v);
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    proto.setItem.call(localStorage, k, v);
  }
}
