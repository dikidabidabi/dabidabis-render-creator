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

export type Person = { id: string; name: string; avatar: string | null };

/** Semua akun yang boleh mengisi diskusi (pemilik presentasi + semua penerima). */
export async function fetchParticipants(shareId: string): Promise<Person[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("share_participants", { _share_id: shareId });
  if (error || !data) return [];
  const ids = Array.from(
    new Set((data as Array<string | { uid?: string; share_participants?: string }>).map((r) =>
      typeof r === "string" ? r : (r.uid ?? r.share_participants ?? ""),
    )),
  ).filter(Boolean);
  if (ids.length === 0) return [];
  try {
    const { getNoteAuthors } = await import("@/lib/presentation-notes.functions");
    const infos = await getNoteAuthors({ data: { ids } });
    return infos.map((i) => ({ id: i.id, name: i.name, avatar: i.avatar }));
  } catch {
    const { data: profs } = await supabase.from("profiles").select("id, display_name").in("id", ids);
    return ids.map((id) => {
      const p = (profs ?? []).find((x) => (x.id as string) === id);
      const name = ((p?.display_name as string | null) || "").trim() || `Arsitek ${id.slice(0, 6)}`;
      return { id, name, avatar: null };
    });
  }
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

/* ── Task dari pesan diskusi ───────────────────────────────────────────── */

export type DiscussionTask = {
  id: string;
  share_id: string;
  message_id: string | null;
  body: string;
  creator: string;
  owner: string;
  created_at: string;
  owner_done_at: string | null;
  creator_done_at: string | null;
};

/** Semua task pada satu utas diskusi, terurut waktu pembuatan. */
export async function fetchTasks(shareId: string): Promise<DiscussionTask[]> {
  const { data, error } = await supabase
    .from("presentation_tasks")
    .select("id, share_id, message_id, body, creator, owner, created_at, owner_done_at, creator_done_at")
    .eq("share_id", shareId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DiscussionTask[];
}

/** Tandai satu pesan sebagai task dengan pemilik task tertentu. */
export async function createTask(args: {
  shareId: string;
  messageId: string;
  body: string;
  creator: string;
  owner: string;
}): Promise<DiscussionTask> {
  const { data, error } = await supabase
    .from("presentation_tasks")
    .insert({
      share_id: args.shareId,
      message_id: args.messageId,
      body: args.body.trim(),
      creator: args.creator,
      owner: args.owner,
    })
    .select("id, share_id, message_id, body, creator, owner, created_at, owner_done_at, creator_done_at")
    .single();
  if (error) throw error;
  return data as DiscussionTask;
}

/** Ceklis / batalkan ceklis sebagai pemilik task atau pembuat task. */
export async function toggleTaskCheck(
  task: DiscussionTask,
  role: "owner" | "creator",
  done: boolean,
): Promise<DiscussionTask> {
  const patch =
    role === "owner"
      ? { owner_done_at: done ? new Date().toISOString() : null }
      : { creator_done_at: done ? new Date().toISOString() : null };
  const { data, error } = await supabase
    .from("presentation_tasks")
    .update(patch)
    .eq("id", task.id)
    .select("id, share_id, message_id, body, creator, owner, created_at, owner_done_at, creator_done_at")
    .single();
  if (error) throw error;
  return data as DiscussionTask;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from("presentation_tasks").delete().eq("id", id);
  if (error) throw error;
}

/** Task dianggap "closed" bila pemilik task dan pembuat task sudah menceklis. */
export function isTaskClosed(t: DiscussionTask): boolean {
  return Boolean(t.owner_done_at && t.creator_done_at);
}

/** Durasi penyelesaian: sejak task dibuat sampai ceklis pembuat task. */
export function taskDuration(t: DiscussionTask): string | null {
  if (!isTaskClosed(t) || !t.creator_done_at) return null;
  const ms = new Date(t.creator_done_at).getTime() - new Date(t.created_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam ${m % 60} menit`;
  const d = Math.floor(h / 24);
  return `${d} hari ${h % 24} jam`;
}

export function formatTaskDate(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

