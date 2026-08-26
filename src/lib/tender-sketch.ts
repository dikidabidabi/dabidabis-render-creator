// Lampiran sketsa pada postingan tender ("attach sketsa").
//
// Saat memposting tender, pengguna dapat melampirkan salah satu sketsa dari
// halaman Sketsa atau halaman Master Plan. Lampiran disimpan sebagai file
// `.dabidabi.json` (format yang sama dengan fitur unduh sketsa), sehingga saat
// akun lain mengeksekusi tender, seluruh data sketsa (geometri, level, tabulasi,
// narasi, presentasi, screenshot 3D) terduplikasi ke akun eksekutor TANPA
// mengubah sketsa sumber (file lampiran bersifat read-only snapshot).

import { buildSketchFile, type AnySketch } from "@/lib/sketch-file";

export type SketchSource = "sketch" | "masterplan";

export type AttachableSketch = {
  id: string;
  title: string;
  source: SketchSource;
  lat: number | null;
  lon: number | null;
  label: string | null;
};

const STORE_KEYS: Record<SketchSource, string[]> = {
  sketch: ["dabidabis_sketch_v2", "dabidabis_sketch_v1"],
  masterplan: ["dabidabis_masterplan_canvas_v1", "dabidabis_masterplan_canvas_v0"],
};

function readSketches(source: SketchSource): AnySketch[] {
  if (typeof localStorage === "undefined") return [];
  for (const key of STORE_KEYS[source]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const store = JSON.parse(raw);
      const list = Array.isArray(store?.sketches) ? store.sketches : null;
      if (list && list.length) return list as AnySketch[];
    } catch {
      /* abaikan store rusak */
    }
  }
  return [];
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Semua sketsa yang bisa dilampirkan ke postingan tender. */
export function listAttachableSketches(): AttachableSketch[] {
  const out: AttachableSketch[] = [];
  for (const source of ["sketch", "masterplan"] as SketchSource[]) {
    for (const s of readSketches(source)) {
      if (!s?.id) continue;
      out.push({
        id: s.id,
        title: (s.title as string) || "Sketsa",
        source,
        lat: numOrNull((s as any)?.geo?.lat),
        lon: numOrNull((s as any)?.geo?.lon),
        label: ((s as any)?.geo?.label as string) || null,
      });
    }
  }
  return out;
}

/** Ambil satu sketsa lengkap + data pendampingnya sebagai teks file lampiran. */
export function buildAttachmentText(id: string, source: SketchSource): string | null {
  const found = readSketches(source).find((s) => s.id === id);
  if (!found) return null;
  return JSON.stringify(buildSketchFile(found));
}

export function attachmentDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:application/json;base64,${btoa(bin)}`;
}
