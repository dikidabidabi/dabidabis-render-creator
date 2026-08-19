import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  buildHierarchy,
  fallbackName,
  fetchProfileMap,
  signAvatar,
  signPostFile,
  signRender,
  type CommentInfo,
  type FeedEntry,
  type GalleryItem,
  type Hierarchy,
  type PostRow,
  type ProfileInfo,
  type RepostRef,
} from "@/lib/social.server";

export type GalleryOwner = ProfileInfo & { name: string; avatar_signed: string | null };
export type { GalleryItem, CommentInfo, FeedEntry, Hierarchy };

export const getGallery = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ userId: z.string().uuid().optional() })
      .default({})
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const ownerId = data.userId ?? userId;

    const profiles = await fetchProfileMap(supabase, [ownerId]);
    const ownerProfile = profiles.get(ownerId) ?? null;
    const owner: GalleryOwner = {
      id: ownerId,
      display_name: ownerProfile?.display_name ?? null,
      bio: ownerProfile?.bio ?? null,
      qualifications: ownerProfile?.qualifications ?? null,
      avatar_url: ownerProfile?.avatar_url ?? null,
      account_type: ownerProfile?.account_type ?? null,
      professional_level: ownerProfile?.professional_level ?? null,
      corporate_code: ownerProfile?.corporate_code ?? null,
      corporate_parent_code: ownerProfile?.corporate_parent_code ?? null,
      name: fallbackName(ownerProfile, ownerId),
      avatar_signed: await signAvatar(supabase, ownerProfile?.avatar_url ?? null),
    };
    const hierarchy = await buildHierarchy(supabase, ownerProfile, ownerId);


    const { data: rows, error } = await supabase
      .from("renders")
      .select("id, prompt, render_type, accuracy, consistency, result_url, status, created_at, user_id")
      .eq("user_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error)
      return {
        owner,
        hierarchy,
        isOwner: ownerId === userId,
        items: [] as GalleryItem[],
        error: error.message,
      };


    const ids = (rows ?? []).map((r) => r.id as string);
    const [{ data: likes }, { data: comments }] = await Promise.all([
      ids.length
        ? supabase.from("render_likes").select("render_id, user_id").in("render_id", ids)
        : Promise.resolve({ data: [] as { render_id: string; user_id: string }[] }),
      ids.length
        ? supabase
            .from("render_comments")
            .select("id, render_id, user_id, body, created_at")
            .in("render_id", ids)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);

    const commenterMap = await fetchProfileMap(
      supabase,
      (comments ?? []).map((c) => c["user_id"] as string),
    );
    const commenterAvatars = new Map<string, string | null>();
    for (const [id, p] of commenterMap) {
      commenterAvatars.set(id, await signAvatar(supabase, p.avatar_url));
    }

    const items: GalleryItem[] = await Promise.all(
      (rows ?? []).map(async (r) => {
        const rid = r.id as string;
        const rowLikes = (likes ?? []).filter((l) => l.render_id === rid);
        return {
          id: rid,
          prompt: r.prompt as string,
          render_type: r.render_type as string,
          accuracy: r.accuracy as number,
          consistency: r.consistency as number,
          status: r.status as string,
          created_at: r.created_at as string,
          user_id: ownerId,
          result_url: r.result_url ? ((await signRender(supabase, ownerId, rid)) ?? (r.result_url as string)) : null,
          like_count: rowLikes.length,
          liked_by_me: rowLikes.some((l) => l.user_id === userId),
          comments: (comments ?? [])
            .filter((c) => c["render_id"] === rid)
            .map((c) => {
              const cu = c["user_id"] as string;
              const p = commenterMap.get(cu) ?? null;
              return {
                id: c["id"] as string,
                body: c["body"] as string,
                created_at: c["created_at"] as string,
                user_id: cu,
                author_name: fallbackName(p, cu),
                author_avatar: commenterAvatars.get(cu) ?? null,
              } satisfies CommentInfo;
            }),
        } satisfies GalleryItem;
      }),
    );

    return { owner, isOwner: ownerId === userId, items, error: null as string | null };
  });

export const listGalleries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase
      .from("renders")
      .select("user_id")
      .eq("status", "completed")
      .limit(2000);

    const counts = new Map<string, number>();
    for (const r of rows ?? []) {
      const uid = r.user_id as string;
      counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    const ids = Array.from(counts.keys());
    const profiles = await fetchProfileMap(supabase, ids);

    const galleries = await Promise.all(
      ids.map(async (id) => ({
        id,
        name: fallbackName(profiles.get(id) ?? null, id),
        qualifications: profiles.get(id)?.qualifications ?? null,
        avatar_signed: await signAvatar(supabase, profiles.get(id)?.avatar_url ?? null),
        render_count: counts.get(id) ?? 0,
        is_me: id === userId,
      })),
    );
    galleries.sort((a, b) => b.render_count - a.render_count);
    return { galleries };
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        display_name: z.string().max(80).nullable().optional(),
        bio: z.string().max(1200).nullable().optional(),
        qualifications: z.string().max(1200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        display_name: data.display_name ?? null,
        bio: data.bio ?? null,
        qualifications: data.qualifications ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    return { ok: !error, error: error?.message ?? null };
  });

export const uploadAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ dataUrl: z.string().min(20).max(6_000_000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const match = data.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return { ok: false as const, error: "Format gambar tidak valid.", url: null };
    const mime = match[1];
    const ext = mime.split("/")[1] ?? "png";
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    const path = `${userId}/avatar.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) return { ok: false as const, error: upErr.message, url: null };

    const { error: dbErr } = await supabase.from("profiles").upsert(
      { id: userId, avatar_url: path, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    if (dbErr) return { ok: false as const, error: dbErr.message, url: null };

    return { ok: true as const, error: null, url: await signAvatar(supabase, path) };
  });

export const toggleLike = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ renderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("render_likes")
      .select("render_id")
      .eq("render_id", data.renderId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("render_likes")
        .delete()
        .eq("render_id", data.renderId)
        .eq("user_id", userId);
      return { ok: !error, liked: false, error: error?.message ?? null };
    }
    const { error } = await supabase
      .from("render_likes")
      .insert({ render_id: data.renderId, user_id: userId });
    return { ok: !error, liked: true, error: error?.message ?? null };
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ renderId: z.string().uuid(), body: z.string().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("render_comments")
      .insert({ render_id: data.renderId, user_id: userId, body: data.body.trim() })
      .select("id, body, created_at, user_id")
      .single();
    if (error || !row) return { ok: false as const, error: error?.message ?? "Gagal", comment: null };

    const profiles = await fetchProfileMap(supabase, [userId]);
    const p = profiles.get(userId) ?? null;
    const comment: CommentInfo = {
      id: row.id as string,
      body: row.body as string,
      created_at: row.created_at as string,
      user_id: userId,
      author_name: fallbackName(p, userId),
      author_avatar: await signAvatar(supabase, p?.avatar_url ?? null),
    };
    return { ok: true as const, error: null, comment };
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("render_comments").delete().eq("id", data.id);
    return { ok: !error, error: error?.message ?? null };
  });

export type FeedItem = {
  id: string;
  prompt: string;
  created_at: string;
  result_url: string | null;
  user_id: string;
  author_name: string;
  author_avatar: string | null;
  author_qualifications: string | null;
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
};

export const getFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("renders")
      .select("id, prompt, result_url, created_at, user_id")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) return { items: [] as FeedItem[], error: error.message };

    const ids = (rows ?? []).map((r) => r.id as string);
    const [{ data: likes }, { data: comments }] = await Promise.all([
      ids.length
        ? supabase.from("render_likes").select("render_id, user_id").in("render_id", ids)
        : Promise.resolve({ data: [] as { render_id: string; user_id: string }[] }),
      ids.length
        ? supabase.from("render_comments").select("render_id").in("render_id", ids)
        : Promise.resolve({ data: [] as { render_id: string }[] }),
    ]);

    const profiles = await fetchProfileMap(supabase, (rows ?? []).map((r) => r.user_id as string));
    const avatars = new Map<string, string | null>();
    for (const [id, p] of profiles) avatars.set(id, await signAvatar(supabase, p.avatar_url));

    const items: FeedItem[] = await Promise.all(
      (rows ?? []).map(async (r) => {
        const rid = r.id as string;
        const owner = r.user_id as string;
        const p = profiles.get(owner) ?? null;
        const rowLikes = (likes ?? []).filter((l) => l.render_id === rid);
        return {
          id: rid,
          prompt: r.prompt as string,
          created_at: r.created_at as string,
          user_id: owner,
          author_name: fallbackName(p, owner),
          author_avatar: avatars.get(owner) ?? null,
          author_qualifications: p?.qualifications ?? null,
          result_url: r.result_url
            ? ((await signRender(supabase, owner, rid)) ?? (r.result_url as string))
            : null,
          like_count: rowLikes.length,
          liked_by_me: rowLikes.some((l) => l.user_id === userId),
          comment_count: (comments ?? []).filter((c) => c.render_id === rid).length,
        } satisfies FeedItem;
      }),
    );
    return { items, error: null as string | null };
  });
