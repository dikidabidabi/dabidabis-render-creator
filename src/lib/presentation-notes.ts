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

export type NoteRow = {
  id: string;
  share_id: string;
  slide_id: string;
  slide_title: string | null;
  author: string;
  strokes: NoteStroke[];
  texts: NoteText[];
  updated_at: string;
};

export type NoteLayer = NoteRow & { author_name: string };

function normalize(row: Record<string, unknown>): NoteRow {
  return {
    id: row.id as string,
    share_id: row.share_id as string,
    slide_id: row.slide_id as string,
    slide_title: (row.slide_title as string | null) ?? null,
    author: row.author as string,
    strokes: Array.isArray(row.strokes) ? (row.strokes as NoteStroke[]) : [],
    texts: Array.isArray(row.texts) ? (row.texts as NoteText[]) : [],
    updated_at: row.updated_at as string,
  };
}

/** Semua catatan pada satu kiriman (untuk penerima). */
export async function fetchShareNotes(shareId: string): Promise<NoteRow[]> {
  const { data, error } = await supabase
    .from("presentation_notes")
    .select("id, share_id, slide_id, slide_title, author, strokes, texts, updated_at")
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "share_id,slide_id,author" },
    );
  if (error) throw error;
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
    .select("id, share_id, slide_id, slide_title, author, strokes, texts, updated_at")
    .in("share_id", ids);
  const rows = (notes ?? []).map((r) => normalize(r as Record<string, unknown>));
  if (rows.length === 0) return [];

  const authors = Array.from(new Set(rows.map((r) => r.author)));
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", authors);
  const nameOf = new Map<string, string>();
  for (const p of profs ?? []) {
    const id = p.id as string;
    nameOf.set(
      id,
      ((p as { display_name: string | null }).display_name || "").trim() || `Arsitek ${id.slice(0, 6)}`,
    );
  }

  return rows.map((r) => ({ ...r, author_name: nameOf.get(r.author) ?? "Akun" }));
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
