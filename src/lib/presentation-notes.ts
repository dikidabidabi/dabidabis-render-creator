// Komentar coretan & teks per halaman untuk presentasi kiriman.
// Catatan disimpan per (share, slide, penulis) lalu ditarik kembali oleh
// pemilik presentasi sumber sebagai layer yang bisa di-on/off.
import { supabase } from "@/integrations/supabase/client";

export const MAX_SHARE_RECIPIENTS = 5;

/** Ruang koordinat catatan = ukuran slide A3 internal (1414 × 1000). */
export const NOTE_W = 1414;
export const NOTE_H = 1000;

export type NoteStroke = {
  id: string;
  points: number[]; // [x0,y0,x1,y1,...] dalam ruang A3
  color: string;
  width: number;
};

export type NoteText = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
};

/** Snapshot zoom/pan gambar slide saat komentar dibuat. */
export type NoteView = { scale: number; tx: number; ty: number };

export type NoteRow = {
  id: string;
  share_id: string;
  slide_id: string;
  slide_title: string | null;
  author: string;
  strokes: NoteStroke[];
  texts: NoteText[];
  view: NoteView | null;
  updated_at: string;
};

export type NoteLayer = NoteRow & { author_name: string; author_avatar: string | null };

const NOTE_COLS = "id, share_id, slide_id, slide_title, author, strokes, texts, view, updated_at";

function normalizeView(v: unknown): NoteView | null {
  const o = v as { scale?: unknown; tx?: unknown; ty?: unknown } | null;
  if (!o || typeof o.scale !== "number" || typeof o.tx !== "number" || typeof o.ty !== "number") return null;
  return { scale: o.scale, tx: o.tx, ty: o.ty };
}

/**
 * Transform SVG agar layer komentar tetap menempel pada gambar slide ketika
 * pemilik presentasi mengubah zoom/pan gambar tersebut.
 */
export function noteTransform(
  stored: NoteView | null,
  current: NoteView | null,
  anchor: { cx: number; cy: number } | null,
): string | undefined {
  if (!stored || !current || !anchor || !stored.scale || !current.scale) return undefined;
  const k = current.scale / stored.scale;
  const tx = anchor.cx + current.tx - k * (anchor.cx + stored.tx);
  const ty = anchor.cy + current.ty - k * (anchor.cy + stored.ty);
  if (Math.abs(k - 1) < 1e-4 && Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01) return undefined;
  return `translate(${tx} ${ty}) scale(${k})`;
}

function normalize(row: Record<string, unknown>): NoteRow {
  return {
    id: row.id as string,
    share_id: row.share_id as string,
    slide_id: row.slide_id as string,
    slide_title: (row.slide_title as string | null) ?? null,
    author: row.author as string,
    strokes: Array.isArray(row.strokes) ? (row.strokes as NoteStroke[]) : [],
    texts: Array.isArray(row.texts) ? (row.texts as NoteText[]) : [],
    view: normalizeView(row.view),
    updated_at: row.updated_at as string,
  };
}


/** Semua catatan pada satu kiriman (untuk penerima). */
export async function fetchShareNotes(shareId: string): Promise<NoteRow[]> {
  const { data, error } = await supabase
    .from("presentation_notes")
    .select(NOTE_COLS)
    .eq("share_id", shareId);
  if (error) throw error;
  return (data ?? []).map((r) => normalize(r as Record<string, unknown>));
}

/** Simpan (upsert) catatan penulis pada satu slide. */
export async function saveNote(args: {
  shareId: string;
  slideId: string;
  slideTitle: string;
  author: string;
  strokes: NoteStroke[];
  texts: NoteText[];
  view?: NoteView | null;
}): Promise<void> {
  const { error } = await supabase
    .from("presentation_notes")
    .upsert(
      {
        share_id: args.shareId,
        slide_id: args.slideId,
        slide_title: args.slideTitle,
        author: args.author,
        strokes: args.strokes as never,
        texts: args.texts as never,
        view: (args.view ?? null) as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "share_id,slide_id,author" },
    );
  if (error) throw error;
}

/**
 * Perbarui payload semua kiriman untuk satu judul presentasi milik saya,
 * sehingga presentasi kiriman di akun penerima otomatis ikut berubah.
 */
export async function syncSharedPayload(
  fromUser: string,
  title: string,
  payload: unknown,
): Promise<number> {
  const { data, error } = await supabase
    .from("shared_presentations")
    .update({ payload: payload as never })
    .eq("from_user", fromUser)
    .eq("title", title)
    .select("id");
  if (error) return 0;
  return (data ?? []).length;
}

/** Jumlah akun berbeda yang sudah menerima judul presentasi ini dari saya. */
export async function countShareRecipients(fromUser: string, title: string): Promise<number> {
  const { data, error } = await supabase
    .from("shared_presentations")
    .select("to_user")
    .eq("from_user", fromUser)
    .eq("title", title);
  if (error) return 0;
  return new Set((data ?? []).map((r) => r.to_user as string)).size;
}

/**
 * Catatan yang masuk untuk judul presentasi milik saya (sisi pengirim).
 * Digabung dengan nama akun penulis untuk ditampilkan sebagai daftar layer.
 */
export async function fetchIncomingNotes(fromUser: string, title: string): Promise<NoteLayer[]> {
  const { data: shares } = await supabase
    .from("shared_presentations")
    .select("id")
    .eq("from_user", fromUser)
    .eq("title", title);
  const ids = (shares ?? []).map((s) => s.id as string);
  if (ids.length === 0) return [];

  const { data: notes } = await supabase
    .from("presentation_notes")
    .select(NOTE_COLS)
    .in("share_id", ids);
  const rows = (notes ?? []).map((r) => normalize(r as Record<string, unknown>));
  if (rows.length === 0) return [];

  const authors = Array.from(new Set(rows.map((r) => r.author)));
  const nameOf = new Map<string, string>();
  const avatarOf = new Map<string, string | null>();
  try {
    const { getNoteAuthors } = await import("@/lib/presentation-notes.functions");
    const infos = await getNoteAuthors({ data: { ids: authors } });
    for (const i of infos) {
      nameOf.set(i.id, i.name);
      avatarOf.set(i.id, i.avatar);
    }
  } catch {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", authors);
    for (const p of profs ?? []) {
      const id = p.id as string;
      nameOf.set(
        id,
        ((p as { display_name: string | null }).display_name || "").trim() || `Arsitek ${id.slice(0, 6)}`,
      );
    }
  }

  return rows.map((r) => ({
    ...r,
    author_name: nameOf.get(r.author) ?? "Akun",
    author_avatar: avatarOf.get(r.author) ?? null,
  }));
}


export function strokePath(s: NoteStroke): string {
  const p = s.points;
  if (p.length < 4) return "";
  let d = `M ${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length; i += 2) d += ` L ${p[i]} ${p[i + 1]}`;
  return d;
}

export function formatNoteTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
