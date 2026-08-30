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
  /** Judul presentasi pada kiriman ini. */
  title: string;
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

type ShareRow = { id: string; from_user: string; to_user: string; title: string };

async function decorate(rows: ShareRow[], me: string): Promise<ShareThread[]> {
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
      title: r.title,
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
    .select("id, from_user, to_user, title")
    .eq("from_user", fromUser)
    .eq("title", title)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return decorate(data as ShareRow[], fromUser);
}

/** Satu utas diskusi untuk kiriman yang saya terima (sisi penerima). */
export async function fetchRecipientThread(shareId: string, me: string): Promise<ShareThread | null> {
  const { data, error } = await supabase
    .from("shared_presentations")
    .select("id, from_user, to_user, title")
    .eq("id", shareId)
    .maybeSingle();
  if (error || !data) return null;
  const [t] = await decorate([data as ShareRow], me);
  return t ?? null;
}

const SEEN_KEY = "dabidabi:discussion-seen";

function seenMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function getSeenAt(shareId: string): string | null {
  return seenMap()[shareId] ?? null;
}

export function setSeenAt(shareId: string, iso = new Date().toISOString()): void {
  if (typeof window === "undefined") return;
  const m = seenMap();
  m[shareId] = iso;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/** Jumlah pesan baru dari akun lain pada satu utas. */
export function countUnread(msgs: DiscussionMsg[], me: string, shareId: string): number {
  const seen = getSeenAt(shareId);
  return msgs.filter((m) => m.user_id !== me && (!seen || m.created_at > seen)).length;
}

export function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}
