// Universal IndexedDB-backed bridge for the entire Dabidabi's project state.
//
// All existing page components keep reading/writing `localStorage` with the
// `dabidabis_*` prefix. This module makes IndexedDB the durable source of
// truth so we are immune to localStorage's ~5MB quota and to component
// unmounting.
//
// IMPORTANT — PRIVACY / OWNERSHIP:
// Project data is scoped per account. Each signed-in user gets its own
// IndexedDB object store (`project_<userId>`), and switching accounts wipes
// the shared localStorage cache before hydrating the new owner's data. That
// guarantees karya (sketsa, masterplan, tabulasi, narasi, presentasi, model
// 3D, rumus) never leak between accounts on the same browser, and that all
// pages inside one account stay consistently linked to each other.
//
// IndexedDB layout: one entry per `dabidabis_*` key per owner store. This
// keeps individual values small and avoids rewriting one giant blob on every
// keystroke.

import localforage from "localforage";

const PREFIX = "dabidabis_";
const HYDRATE_FLAG = "__dabidabis_hydrated__";
const LEGACY_STORE = "project_v1";
const LEGACY_CLAIM_KEY = "__dabidabis_legacy_owner__";

export const GUEST_OWNER = "guest";

const stores = new Map<string, LocalForage>();
let currentOwner: string | null = null;
const hydratePromises = new Map<string, Promise<void>>();
let patched = false;
const debounceTimers = new Map<string, number>();
const memoryCache = new Map<string, string>();

function isQuotaError(error: unknown): boolean {
  const maybe = error as { name?: string; code?: number } | null;
  return (
    maybe?.name === "QuotaExceededError" ||
    maybe?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    maybe?.code === 22 ||
    maybe?.code === 1014
  );
}

function storeNameFor(owner: string): string {
  return owner === GUEST_OWNER ? "project_guest" : `project_${owner}`;
}

function instanceFor(storeName: string): LocalForage {
  const existing = stores.get(storeName);
  if (existing) return existing;
  const inst = localforage.createInstance({
    name: "dabidabis",
    storeName,
    description: "Dabidabi's project state",
  });
  stores.set(storeName, inst);
  return inst;
}

function getStore(): LocalForage {
  return instanceFor(storeNameFor(currentOwner ?? GUEST_OWNER));
}

export function getStorageOwner(): string | null {
  return currentOwner;
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

async function writeNow(key: string, value: string | null): Promise<void> {
  const prev = debounceTimers.get(key);
  if (prev) window.clearTimeout(prev);
  debounceTimers.delete(key);
  const db = getStore();
  if (value == null) await db.removeItem(key);
  else await db.setItem(key, value);
}

function flushPending(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const [key, t] of debounceTimers) {
    window.clearTimeout(t);
    const db = getStore();
    const v = memoryCache.has(key) ? memoryCache.get(key)! : localStorage.getItem(key);
    tasks.push(v == null ? db.removeItem(key) : db.setItem(key, v));
  }
  debounceTimers.clear();
  return Promise.all(tasks).then(() => void 0);
}

function rawStorage(): Storage {
  return Object.getPrototypeOf(localStorage) as Storage;
}

function rawSet(key: string, value: string) {
  const proto = rawStorage();
  try {
    proto.setItem.call(localStorage, key, value);
  } catch (e) {
    if (!isQuotaError(e)) throw e;
    try {
      proto.removeItem.call(localStorage, key);
    } catch {
      /* ignore cache cleanup */
    }
  }
}

function projectKeysInLocalStorage(): string[] {
  const proto = rawStorage();
  const lengthGetter = Object.getOwnPropertyDescriptor(proto, "length")?.get;
  const len = lengthGetter?.call(localStorage) ?? 0;
  const keys: string[] = [];
  for (let i = 0; i < len; i++) {
    const k = proto.key.call(localStorage, i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

// Drops the in-memory + localStorage caches without touching IndexedDB, so a
// different account never sees the previous account's karya.
function dropCaches() {
  for (const t of debounceTimers.values()) window.clearTimeout(t);
  debounceTimers.clear();
  memoryCache.clear();
  const proto = rawStorage();
  for (const k of projectKeysInLocalStorage()) {
    try {
      proto.removeItem.call(localStorage, k);
    } catch {
      /* ignore */
    }
  }
}

function patchLocalStorage() {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(localStorage) as Storage;
  const origSet = proto.setItem.bind(localStorage);
  const origRemove = proto.removeItem.bind(localStorage);
  const origClear = proto.clear.bind(localStorage);
  const origGet = proto.getItem.bind(localStorage);
  const origKey = proto.key.bind(localStorage);
  const origLengthGetter = Object.getOwnPropertyDescriptor(proto, "length")?.get;
  const origLength = () => origLengthGetter?.call(localStorage) ?? 0;
  const visibleKeys = () => {
    const keys = [...memoryCache.keys()];
    const seen = new Set(keys);
    for (let i = 0; i < origLength(); i++) {
      const k = origKey(i);
      if (k && !seen.has(k)) keys.push(k);
    }
    return keys;
  };

  localStorage.setItem = (k: string, v: string) => {
    if (!k.startsWith(PREFIX)) {
      origSet(k, v);
      return;
    }
    memoryCache.set(k, v);
    scheduleWrite(k, v);
    try {
      origSet(k, v);
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      try {
        origRemove(k);
      } catch {
        /* ignore cache cleanup */
      }
    }
  };
  localStorage.removeItem = (k: string) => {
    if (k.startsWith(PREFIX)) memoryCache.delete(k);
    origRemove(k);
    if (k.startsWith(PREFIX)) scheduleWrite(k, null);
  };
  localStorage.getItem = (k: string) => {
    if (k.startsWith(PREFIX) && memoryCache.has(k)) return memoryCache.get(k)!;
    return origGet(k);
  };
  localStorage.key = (i: number) => {
    return visibleKeys()[i] ?? null;
  };
  try {
    Object.defineProperty(localStorage, "length", {
      configurable: true,
      get() {
        return visibleKeys().length;
      },
    });
  } catch {
    /* length is read-only in some browsers; getItem remains quota-safe */
  }
  localStorage.clear = () => {
    const keys = visibleKeys().filter((k) => k.startsWith(PREFIX));
    memoryCache.clear();
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

// ---------------------------------------------------------------------------
// One-time repair: karya milik akun dikidabidabi@gmail.com sempat teradopsi ke
// akun azizahsinyo02@gmail.com saat migrasi multi-akun (klaim data legacy jatuh
// ke akun yang login lebih dulu). Pindahkan kembali ke pemilik aslinya.
const RECLAIM_OWNER = "68a21707-5f16-4f39-95f0-820481de3946"; // dikidabidabi@gmail.com
const RECLAIM_FROM = ["9965c9d5-d79c-4018-8e94-0ca4b0d5a9b6"]; // azizahsinyo02@gmail.com
const RECLAIM_FLAG = "__dabidabis_reclaim_v1__";

async function reclaimMisattributed(owner: string, db: LocalForage) {
  if (owner !== RECLAIM_OWNER) return;
  try {
    if (localStorage.getItem(RECLAIM_FLAG) === "1") return;
  } catch {
    /* ignore */
  }

  for (const wrongOwner of RECLAIM_FROM) {
    const wrong = instanceFor(storeNameFor(wrongOwner));
    const entries: Record<string, string> = {};
    try {
      await wrong.iterate<string, void>((value, key) => {
        if (typeof key === "string" && key.startsWith(PREFIX) && typeof value === "string") {
          entries[key] = value;
        }
      });
    } catch {
      continue;
    }
    if (Object.keys(entries).length === 0) continue;

    for (const [k, v] of Object.entries(entries)) {
      try {
        await db.setItem(k, v);
      } catch {
        /* ignore individual key errors */
      }
    }
    try {
      await wrong.clear();
    } catch {
      /* ignore */
    }
  }

  try {
    localStorage.setItem(RECLAIM_FLAG, "1");
    localStorage.setItem(LEGACY_CLAIM_KEY, owner);
  } catch {
    /* ignore */
  }
}

// One-time adoption of pre-multi-account data: the very first signed-in
// account on this browser inherits the legacy store; nobody else does.
async function adoptLegacyIfEligible(owner: string, db: LocalForage) {

  if (owner === GUEST_OWNER) return;
  let claimed: string | null = null;
  try {
    claimed = localStorage.getItem(LEGACY_CLAIM_KEY);
  } catch {
    /* ignore */
  }
  if (claimed && claimed !== owner) return;

  const legacy = instanceFor(LEGACY_STORE);
  const entries: Record<string, string> = {};
  try {
    await legacy.iterate<string, void>((value, key) => {
      if (typeof key === "string" && key.startsWith(PREFIX) && typeof value === "string") {
        entries[key] = value;
      }
    });
  } catch {
    return;
  }
  if (Object.keys(entries).length === 0) {
    // Nothing in the legacy IDB store, but the browser may still hold the
    // pre-migration localStorage copy.
    for (const k of projectKeysInLocalStorage()) {
      const v = rawStorage().getItem.call(localStorage, k);
      if (v != null) entries[k] = v;
    }
  }
  if (Object.keys(entries).length === 0) return;

  for (const [k, v] of Object.entries(entries)) await db.setItem(k, v);
  try {
    localStorage.setItem(LEGACY_CLAIM_KEY, owner);
  } catch {
    /* ignore */
  }
}

export function hydrateFromIndexedDB(owner: string = GUEST_OWNER): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const existing = hydratePromises.get(owner);
  if (existing && currentOwner === owner) return existing;

  const promise = (async () => {
    // Switching account: persist whatever is pending for the previous owner,
    // then wipe caches so no karya crosses over.
    if (currentOwner !== null && currentOwner !== owner) {
      try {
        await flushPending();
      } catch {
        /* ignore */
      }
    }
    dropCaches();
    currentOwner = owner;

    const db = getStore();
    await reclaimMisattributed(owner, db);
    const idbKeys: string[] = [];
    await db.iterate<string, void>((_value, key) => {
      if (typeof key === "string" && key.startsWith(PREFIX)) idbKeys.push(key);
    });


    if (idbKeys.length === 0) {
      await adoptLegacyIfEligible(owner, db);
      await db.iterate<string, void>((_value, key) => {
        if (typeof key === "string" && key.startsWith(PREFIX)) idbKeys.push(key);
      });
    }

    for (const k of idbKeys) {
      try {
        const v = await db.getItem<string>(k);
        if (typeof v === "string") {
          memoryCache.set(k, v);
          rawSet(k, v);
        }
      } catch {
        /* ignore individual key errors */
      }
    }

    patchLocalStorage();
    try {
      sessionStorage.setItem(HYDRATE_FLAG, "1");
    } catch {
      /* ignore */
    }
  })();

  hydratePromises.set(owner, promise);
  return promise;
}

export async function flushIndexedDB(): Promise<void> {
  await flushPending();
}

export async function setProjectItem(key: string, value: string): Promise<void> {
  if (!key.startsWith(PREFIX)) {
    localStorage.setItem(key, value);
    return;
  }
  memoryCache.set(key, value);
  await writeNow(key, value);
  rawSet(key, value);
}

export async function clearProjectStorage(): Promise<void> {
  await flushPending();
  const db = getStore();
  await db.clear();
  dropCaches();
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
    memoryCache.set(k, v);
    rawSet(k, v);
  }
}
