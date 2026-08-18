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
};

export type CommentInfo = {
  id: string;
  body: string;
  created_at: string;
  user_id: string;
  author_name: string;
  author_avatar: string | null;
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
    .select("id, display_name, bio, qualifications, avatar_url")
    .in("id", unique);
  for (const p of data ?? []) map.set(p.id as string, p as ProfileInfo);
  return map;
}
