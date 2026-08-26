// Helper murni untuk fitur sosial galeri (dipakai oleh social.functions.ts).
import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type DB = SupabaseClient<any, any, any>;

export type ProfileInfo = {
  id: string;
  display_name: string | null;
  bio: string | null;
  qualifications: string | null;
  avatar_url: string | null;
  account_type?: string | null;
  professional_level?: string | null;
  corporate_code?: string | null;
  corporate_parent_code?: string | null;
};

export const PROFILE_COLS =
  "id, display_name, bio, qualifications, avatar_url, account_type, professional_level, corporate_code, corporate_parent_code";

export type PostRow = {
  id: string;
  user_id: string;
  kind: string;
  body: string | null;
  image_url: string | null;
  tender_title: string | null;
  tender_deadline: string | null;
  tor_url: string | null;
  data_link: string | null;
  project_address: string | null;
  project_lat: number | null;
  project_lon: number | null;
  sketch_url: string | null;
  sketch_title: string | null;
  sketch_source: string | null;
  repost_of_post: string | null;
  repost_of_render: string | null;
  created_at: string;
};

export type RepostRef = {
  kind: "post" | "render";
  author_name: string;
  author_id: string;
  body: string | null;
  image_url: string | null;
} | null;

export type FeedEntry = {
  kind: "render" | "post" | "tender";
  id: string;
  created_at: string;
  user_id: string;
  author_name: string;
  author_avatar: string | null;
  author_qualifications: string | null;
  body: string;
  image_url: string | null;
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
  tender_title: string | null;
  tender_deadline: string | null;
  tor_url: string | null;
  data_link: string | null;
  project_address: string | null;
  project_lat: number | null;
  project_lon: number | null;
  sketch_url: string | null;
  sketch_title: string | null;
  sketch_source: string | null;
  repost: RepostRef;
};

export type HierarchyNode = {
  id: string;
  name: string;
  avatar_signed: string | null;
  level: string | null;
  account_type: string | null;
  is_owner: boolean;
};

export type Hierarchy = {
  code: string;
  corporation: HierarchyNode | null;
  members: HierarchyNode[];
} | null;


export type ReactionInfo = { emoji: string; count: number; mine: boolean };

export const REACTION_EMOJIS = ["👍", "❤️", "🔥", "👏", "💡", "😮"] as const;

export type CommentInfo = {
  id: string;
  body: string;
  created_at: string;
  updated_at?: string | null;
  parent_id?: string | null;
  user_id: string;
  author_name: string;
  author_avatar: string | null;
  reactions?: ReactionInfo[];
};

export type GalleryItem = {
  id: string;
  prompt: string;
  render_type: string;
  accuracy: number;
  consistency: number;
  result_url: string | null;
  status: string;
  created_at: string;
  user_id: string;
  like_count: number;
  liked_by_me: boolean;
  new_comment_count: number;
  comments: CommentInfo[];
};


const AVATAR_TTL = 60 * 60 * 24 * 7;
const RENDER_TTL = 60 * 60 * 24;

export async function signAvatar(supabase: DB, path: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const { data } = await supabase.storage.from("avatars").createSignedUrl(path, AVATAR_TTL);
  return data?.signedUrl ?? null;
}

export async function signRender(supabase: DB, ownerId: string, renderId: string) {
  const { data } = await supabase.storage
    .from("renders")
    .createSignedUrl(`${ownerId}/${renderId}.png`, RENDER_TTL);
  return data?.signedUrl ?? null;
}

export function fallbackName(profile: ProfileInfo | null, userId: string) {
  return profile?.display_name?.trim() || `Arsitek ${userId.slice(0, 6)}`;
}

export async function fetchProfileMap(supabase: DB, ids: string[]) {
  const map = new Map<string, ProfileInfo>();
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (unique.length === 0) return map;
  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_COLS)
    .in("id", unique);
  for (const p of data ?? []) map.set(p.id as string, p as ProfileInfo);
  return map;
}

const POST_TTL = 60 * 60 * 24 * 3;

export async function signPostFile(supabase: DB, path: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const { data } = await supabase.storage.from("posts").createSignedUrl(path, POST_TTL);
  return data?.signedUrl ?? null;
}

export async function buildHierarchy(
  supabase: DB,
  ownerProfile: ProfileInfo | null,
  ownerId: string,
): Promise<Hierarchy> {
  const code = (ownerProfile?.corporate_code || ownerProfile?.corporate_parent_code || "").trim();
  if (!code) return null;

  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_COLS)
    .or(`corporate_code.ilike.${code},corporate_parent_code.ilike.${code}`)
    .limit(200);

  const rows = (data ?? []) as ProfileInfo[];
  const toNode = async (p: ProfileInfo): Promise<HierarchyNode> => ({
    id: p.id,
    name: fallbackName(p, p.id),
    avatar_signed: await signAvatar(supabase, p.avatar_url),
    level: p.professional_level ?? null,
    account_type: p.account_type ?? null,
    is_owner: p.id === ownerId,
  });

  const corpRow =
    rows.find((p) => (p.corporate_code ?? "").toLowerCase() === code.toLowerCase()) ?? null;
  const memberRows = rows.filter((p) => p.id !== corpRow?.id);

  return {
    code,
    corporation: corpRow ? await toNode(corpRow) : null,
    members: await Promise.all(memberRows.map(toNode)),
  };
}

