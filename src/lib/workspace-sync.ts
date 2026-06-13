// Mengumpulkan & memulihkan seluruh data proyek lokal agar dapat di-backup
// ke Lovable Cloud Storage per akun. Sumber kebenaran adalah IndexedDB
// (lihat src/lib/storage/idb-bridge.ts); localStorage hanya cache sinkron.

import { bulkWriteIndexedDB, clearProjectStorage, flushIndexedDB, snapshotIndexedDB } from "@/lib/storage/idb-bridge";

const PREFIX = "dabidabis_";
const EXCLUDE = new Set<string>(["dabidabis_google_api_key"]);

export type WorkspaceSnapshot = {
  version: 1;
  createdAt: string;
  app: "dabidabis";
  entries: Record<string, string>;
};

export function collectWorkspace(): WorkspaceSnapshot {
  const entries: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX) || EXCLUDE.has(k)) continue;
    const v = localStorage.getItem(k);
    if (v != null) entries[k] = v;
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    app: "dabidabis",
    entries,
  };
}

export function restoreWorkspace(snap: WorkspaceSnapshot, opts?: { wipe?: boolean }): number {
  if (!snap || snap.app !== "dabidabis" || !snap.entries) {
    throw new Error("Snapshot tidak valid");
  }
  if (opts?.wipe) {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && !EXCLUDE.has(k)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    // Fire-and-forget clear of IndexedDB; subsequent writes below will repopulate.
    void clearProjectStorage();
  }
  let n = 0;
  const toIdb: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.entries)) {
    if (!k.startsWith(PREFIX) || EXCLUDE.has(k)) continue;
    localStorage.setItem(k, v);
    toIdb[k] = v;
    n++;
    // Notify same-tab listeners
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: k, newValue: v }));
    } catch {
      /* ignore */
    }
  }
  // Push synchronously to IndexedDB so backups survive immediate refresh.
  void bulkWriteIndexedDB(toIdb);
  return n;
}

// Optional helper for callers that want to ensure all debounced writes have
// landed in IndexedDB before continuing (e.g. before uploading a backup).
export async function flushProjectStorage(): Promise<void> {
  await flushIndexedDB();
}

export function countSketches(snap: WorkspaceSnapshot): number {
  try {
    const raw = snap.entries["dabidabis_sketch_v2"];
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.sketches) ? parsed.sketches.length : 0;
  } catch {
    return 0;
  }
}

export function snapshotByteSize(snap: WorkspaceSnapshot): number {
  return new Blob([JSON.stringify(snap)]).size;
}

export function downloadSnapshotFile(snap: WorkspaceSnapshot, filename = "dabidabis-backup.json") {
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
