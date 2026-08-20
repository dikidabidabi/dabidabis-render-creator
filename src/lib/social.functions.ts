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

    return { owner, hierarchy, isOwner: ownerId === userId, items, error: null as string | null };
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

/* ============================ Akun: jenis & hierarki ============================ */

export const saveAccountSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        account_type: z.enum(["perorangan", "korporasi"]),
        professional_level: z.string().max(40).nullable().optional(),
        corporate_code: z.string().max(60).nullable().optional(),
        corporate_parent_code: z.string().max(60).nullable().optional(),
        display_name: z.string().max(80).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = {
      id: userId,
      account_type: data.account_type,
      professional_level: data.professional_level?.trim() || null,
      corporate_code: data.corporate_code?.trim() || null,
      corporate_parent_code: data.corporate_parent_code?.trim() || null,
      updated_at: new Date().toISOString(),
      ...(data.display_name?.trim() ? { display_name: data.display_name.trim() } : {}),
    };
    const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });

    return { ok: !error, error: error?.message ?? null };
  });

/* ============================ Postingan & Tender ============================ */

export type PostItem = FeedEntry & { is_mine: boolean; comments: CommentInfo[] };

async function mapPosts(
  supabase: Parameters<typeof signPostFile>[0],
  rows: PostRow[],
  userId: string,
): Promise<Omit<PostItem, "comments">[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: likes }, { data: comments }] = await Promise.all([
    supabase.from("post_likes").select("post_id, user_id").in("post_id", ids),
    supabase.from("post_comments").select("post_id").in("post_id", ids),
  ]);

  const refPostIds = rows.map((r) => r.repost_of_post).filter(Boolean) as string[];
  const refRenderIds = rows.map((r) => r.repost_of_render).filter(Boolean) as string[];
  const [{ data: refPosts }, { data: refRenders }] = await Promise.all([
    refPostIds.length
      ? supabase.from("posts").select("id, user_id, body, image_url, kind").in("id", refPostIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    refRenderIds.length
      ? supabase.from("renders").select("id, user_id, prompt").in("id", refRenderIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  const profiles = await fetchProfileMap(supabase, [
    ...rows.map((r) => r.user_id),
    ...(refPosts ?? []).map((r) => r["user_id"] as string),
    ...(refRenders ?? []).map((r) => r["user_id"] as string),
  ]);
  const avatars = new Map<string, string | null>();
  for (const [id, p] of profiles) avatars.set(id, await signAvatar(supabase, p.avatar_url));

  return Promise.all(
    rows.map(async (r) => {
      const p = profiles.get(r.user_id) ?? null;
      const rowLikes = (likes ?? []).filter((l) => l["post_id"] === r.id);

      let repost: RepostRef = null;
      if (r.repost_of_post) {
        const src = (refPosts ?? []).find((x) => x["id"] === r.repost_of_post);
        if (src) {
          const su = src["user_id"] as string;
          repost = {
            kind: "post",
            author_id: su,
            author_name: fallbackName(profiles.get(su) ?? null, su),
            body: (src["body"] as string | null) ?? null,
            image_url: await signPostFile(supabase, (src["image_url"] as string | null) ?? null),
          };
        }
      } else if (r.repost_of_render) {
        const src = (refRenders ?? []).find((x) => x["id"] === r.repost_of_render);
        if (src) {
          const su = src["user_id"] as string;
          repost = {
            kind: "render",
            author_id: su,
            author_name: fallbackName(profiles.get(su) ?? null, su),
            body: (src["prompt"] as string | null) ?? null,
            image_url: await signRender(supabase, su, r.repost_of_render),
          };
        }
      }

      return {
        kind: (r.kind === "tender" ? "tender" : "post") as "post" | "tender",
        id: r.id,
        created_at: r.created_at,
        user_id: r.user_id,
        author_name: fallbackName(p, r.user_id),
        author_avatar: avatars.get(r.user_id) ?? null,
        author_qualifications: p?.qualifications ?? null,
        body: r.body ?? "",
        image_url: await signPostFile(supabase, r.image_url),
        like_count: rowLikes.length,
        liked_by_me: rowLikes.some((l) => l["user_id"] === userId),
        comment_count: (comments ?? []).filter((c) => c["post_id"] === r.id).length,
        tender_title: r.tender_title ?? null,
        tender_deadline: r.tender_deadline,
        tor_url: await signPostFile(supabase, r.tor_url),
        data_link: r.data_link,
        project_address: r.project_address,
        project_lat: r.project_lat ?? null,
        project_lon: r.project_lon ?? null,
        repost,
        is_mine: r.user_id === userId,
      };
    }),
  );
}

export const getPosts = createServerFn({ method: "GET" })
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
    const { data: rows, error } = await supabase
      .from("posts")
      .select("*")
      .eq("user_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) return { posts: [] as PostItem[], error: error.message };

    const base = await mapPosts(supabase, (rows ?? []) as PostRow[], userId);
    const ids = base.map((b) => b.id);
    const { data: comments } = ids.length
      ? await supabase
          .from("post_comments")
          .select("id, post_id, user_id, body, created_at")
          .in("post_id", ids)
          .order("created_at", { ascending: true })
      : { data: [] as Array<Record<string, unknown>> };

    const commenterMap = await fetchProfileMap(
      supabase,
      (comments ?? []).map((c) => c["user_id"] as string),
    );
    const commenterAvatars = new Map<string, string | null>();
    for (const [id, p] of commenterMap)
      commenterAvatars.set(id, await signAvatar(supabase, p.avatar_url));

    const posts: PostItem[] = base.map((b) => ({
      ...b,
      comments: (comments ?? [])
        .filter((c) => c["post_id"] === b.id)
        .map((c) => {
          const cu = c["user_id"] as string;
          return {
            id: c["id"] as string,
            body: c["body"] as string,
            created_at: c["created_at"] as string,
            user_id: cu,
            author_name: fallbackName(commenterMap.get(cu) ?? null, cu),
            author_avatar: commenterAvatars.get(cu) ?? null,
          } satisfies CommentInfo;
        }),
    }));
    return { posts, error: null as string | null };
  });

export const uploadPostFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        dataUrl: z.string().min(20).max(12_000_000),
        kind: z.enum(["image", "pdf"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const match = data.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return { ok: false as const, error: "Format file tidak valid.", path: null, url: null };
    const mime = match[1];
    if (data.kind === "image" && !mime.startsWith("image/"))
      return { ok: false as const, error: "File harus berupa gambar.", path: null, url: null };
    if (data.kind === "pdf" && mime !== "application/pdf")
      return { ok: false as const, error: "TOR/KAK harus berformat PDF.", path: null, url: null };

    const ext = data.kind === "pdf" ? "pdf" : (mime.split("/")[1] ?? "png");
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("posts")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (error) return { ok: false as const, error: error.message, path: null, url: null };
    return { ok: true as const, error: null, path, url: await signPostFile(supabase, path) };
  });

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["post", "tender"]).default("post"),
        body: z.string().max(4000).nullable().optional(),
        image_url: z.string().max(400).nullable().optional(),
        tender_title: z.string().max(200).nullable().optional(),
        tender_deadline: z.string().max(20).nullable().optional(),
        tor_url: z.string().max(400).nullable().optional(),
        data_link: z.string().max(600).nullable().optional(),
        project_address: z.string().max(400).nullable().optional(),
        project_lat: z.number().min(-90).max(90).nullable().optional(),
        project_lon: z.number().min(-180).max(180).nullable().optional(),
        repost_of_post: z.string().uuid().nullable().optional(),
        repost_of_render: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const hasContent =
      (data.body ?? "").trim().length > 0 ||
      (data.tender_title ?? "").trim().length > 0 ||
      data.image_url ||
      data.repost_of_post ||
      data.repost_of_render;
    if (!hasContent) return { ok: false as const, error: "Postingan masih kosong.", id: null };

    const { data: row, error } = await supabase
      .from("posts")
      .insert({
        user_id: userId,
        kind: data.kind,
        body: data.body?.trim() || null,
        image_url: data.image_url ?? null,
        tender_deadline: data.tender_deadline || null,
        tor_url: data.tor_url ?? null,
        data_link: data.data_link?.trim() || null,
        project_address: data.project_address?.trim() || null,
        repost_of_post: data.repost_of_post ?? null,
        repost_of_render: data.repost_of_render ?? null,
      })
      .select("id")
      .single();
    if (error || !row) return { ok: false as const, error: error?.message ?? "Gagal", id: null };
    return { ok: true as const, error: null, id: row.id as string };
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("posts").delete().eq("id", data.id);
    return { ok: !error, error: error?.message ?? null };
  });

export const togglePostLike = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ postId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("post_likes")
      .select("post_id")
      .eq("post_id", data.postId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("post_likes")
        .delete()
        .eq("post_id", data.postId)
        .eq("user_id", userId);
      return { ok: !error, liked: false, error: error?.message ?? null };
    }
    const { error } = await supabase
      .from("post_likes")
      .insert({ post_id: data.postId, user_id: userId });
    return { ok: !error, liked: true, error: error?.message ?? null };
  });

export const addPostComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ postId: z.string().uuid(), body: z.string().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("post_comments")
      .insert({ post_id: data.postId, user_id: userId, body: data.body.trim() })
      .select("id, body, created_at")
      .single();
    if (error || !row) return { ok: false as const, error: error?.message ?? "Gagal", comment: null };
    const p = (await fetchProfileMap(supabase, [userId])).get(userId) ?? null;
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

export const deletePostComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("post_comments").delete().eq("id", data.id);
    return { ok: !error, error: error?.message ?? null };
  });

/* ============================ Forum Feed ============================ */

export type FeedItem = FeedEntry;

export const getFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [{ data: renderRows, error }, { data: postRows }] = await Promise.all([
      supabase
        .from("renders")
        .select("id, prompt, result_url, created_at, user_id")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(60),
    ]);
    if (error) return { items: [] as FeedEntry[], error: error.message };

    const ids = (renderRows ?? []).map((r) => r.id as string);
    const [{ data: likes }, { data: comments }] = await Promise.all([
      ids.length
        ? supabase.from("render_likes").select("render_id, user_id").in("render_id", ids)
        : Promise.resolve({ data: [] as { render_id: string; user_id: string }[] }),
      ids.length
        ? supabase.from("render_comments").select("render_id").in("render_id", ids)
        : Promise.resolve({ data: [] as { render_id: string }[] }),
    ]);

    const profiles = await fetchProfileMap(
      supabase,
      (renderRows ?? []).map((r) => r.user_id as string),
    );
    const avatars = new Map<string, string | null>();
    for (const [id, p] of profiles) avatars.set(id, await signAvatar(supabase, p.avatar_url));

    const renderItems: FeedEntry[] = await Promise.all(
      (renderRows ?? []).map(async (r) => {
        const rid = r.id as string;
        const owner = r.user_id as string;
        const p = profiles.get(owner) ?? null;
        const rowLikes = (likes ?? []).filter((l) => l.render_id === rid);
        return {
          kind: "render" as const,
          id: rid,
          created_at: r.created_at as string,
          user_id: owner,
          author_name: fallbackName(p, owner),
          author_avatar: avatars.get(owner) ?? null,
          author_qualifications: p?.qualifications ?? null,
          body: r.prompt as string,
          image_url: r.result_url
            ? ((await signRender(supabase, owner, rid)) ?? (r.result_url as string))
            : null,
          like_count: rowLikes.length,
          liked_by_me: rowLikes.some((l) => l.user_id === userId),
          comment_count: (comments ?? []).filter((c) => c.render_id === rid).length,
          tender_title: null,
          tender_deadline: null,
          tor_url: null,
          data_link: null,
          project_address: null,
          project_lat: null,
          project_lon: null,
          repost: null as RepostRef,
        };
      }),
    );

    const postItems = await mapPosts(supabase, (postRows ?? []) as PostRow[], userId);
    const items = [...renderItems, ...postItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return { items, error: null as string | null };
  });

