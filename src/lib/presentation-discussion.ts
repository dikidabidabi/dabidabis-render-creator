// Kotak diskusi presentasi: percakapan antara pemilik presentasi (pengirim)
// dan akun penerima kiriman presentasi. Satu utas per kiriman (share).
import { supabase } from "@/integrations/supabase/client";

export type DiscussionMsg = {
  id: string;
  share_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type ShareThread = {
  id: string;
  fromUser: string;
  toUser: string;
  /** Akun lawan bicara pada utas ini (dilihat dari sisi saya). */
  peer: string;
  peerName: string;
  peerAvatar: string | null;
};

/** Semua pesan diskusi pada satu kiriman, terurut waktu. */
export async function fetchDiscussion(shareId: string): Promise<DiscussionMsg[]> {
  const { data, error } = await supabase
    .from("presentation_discussions")
    .select("id, share_id, user_id, body, created_at")
    .eq("share_id", shareId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DiscussionMsg[];
}

export async function sendDiscussion(shareId: string, userId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { error } = await supabase
    .from("presentation_discussions")
    .insert({ share_id: shareId, user_id: userId, body: text });
  if (error) throw error;
}

async function decorate(
  rows: Array<{ id: string; from_user: string; to_user: string }>,
  me: string,
): Promise<ShareThread[]> {
  const peers = Array.from(new Set(rows.map((r) => (r.from_user === me ? r.to_user : r.from_user))));
  const nameOf = new Map<string, string>();
  const avatarOf = new Map<string, string | null>();
  if (peers.length > 0) {
    try {
      const { getNoteAuthors } = await import("@/lib/presentation-notes.functions");
      const infos = await getNoteAuthors({ data: { ids: peers } });
      for (const i of infos) {
        nameOf.set(i.id, i.name);
        avatarOf.set(i.id, i.avatar);
      }
    } catch {
      const { data: profs } = await supabase.from("profiles").select("id, display_name").in("id", peers);
      for (const p of profs ?? []) {
        const id = p.id as string;
        nameOf.set(id, ((p.display_name as string | null) || "").trim() || `Arsitek ${id.slice(0, 6)}`);
      }
    }
  }
  return rows.map((r) => {
    const peer = r.from_user === me ? r.to_user : r.from_user;
    return {
      id: r.id,
      fromUser: r.from_user,
      toUser: r.to_user,
      peer,
      peerName: nameOf.get(peer) ?? "Akun",
      peerAvatar: avatarOf.get(peer) ?? null,
    };
  });
}

/** Utas diskusi untuk satu judul presentasi milik saya (sisi pengirim). */
export async function fetchOwnerThreads(fromUser: string, title: string): Promise<ShareThread[]> {
  const { data, error } = await supabase
    .from("shared_presentations")
    .select("id, from_user, to_user")
    .eq("from_user", fromUser)
    .eq("title", title)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return decorate(data as Array<{ id: string; from_user: string; to_user: string }>, fromUser);
}

/** Satu utas diskusi untuk kiriman yang saya terima (sisi penerima). */
export async function fetchRecipientThread(shareId: string, me: string): Promise<ShareThread | null> {
  const { data, error } = await supabase
    .from("shared_presentations")
    .select("id, from_user, to_user")
    .eq("id", shareId)
    .maybeSingle();
  if (error || !data) return null;
  const [t] = await decorate([data as { id: string; from_user: string; to_user: string }], me);
  return t ?? null;
}

export function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}
