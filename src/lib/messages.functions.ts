import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  fallbackName,
  fetchProfileMap,
  signAvatar,
  signPostFile,
  signRender,
} from "@/lib/social.server";

export type MessageAccount = {
  id: string;
  name: string;
  avatar_signed: string | null;
  qualifications: string | null;
};

export type SharedPreview = {
  kind: "post" | "render";
  id: string;
  author_name: string;
  body: string | null;
  image_url: string | null;
} | null;

export type DirectMessage = {
  id: string;
  from_user: string;
  to_user: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
  mine: boolean;
  shared: SharedPreview;
};

export type Conversation = {
  user: MessageAccount;
  last_body: string | null;
  last_at: string;
  unread: number;
};

export const searchAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ q: z.string().max(80).default("") })
      .default({ q: "" })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let query = supabase
      .from("profiles")
      .select("id, display_name, qualifications, avatar_url")
      .neq("id", userId)
      .limit(20);
    const q = data.q.trim();
    if (q) query = query.ilike("display_name", `%${q}%`);
    const { data: rows } = await query;
    const accounts: MessageAccount[] = await Promise.all(
      (rows ?? []).map(async (r) => ({
        id: r.id as string,
        name:
          (r.display_name as string | null)?.trim() || `Arsitek ${(r.id as string).slice(0, 6)}`,
        qualifications: (r.qualifications as string | null) ?? null,
        avatar_signed: await signAvatar(supabase, (r.avatar_url as string | null) ?? null),
      })),
    );
    return { accounts };
  });

async function buildSharedMap(
  supabase: Parameters<typeof signPostFile>[0],
  postIds: string[],
  renderIds: string[],
) {
  const map = new Map<string, SharedPreview>();
  const [{ data: posts }, { data: renders }] = await Promise.all([
    postIds.length
      ? supabase.from("posts").select("id, user_id, body, image_url").in("id", postIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    renderIds.length
      ? supabase.from("renders").select("id, user_id, prompt").in("id", renderIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  const profiles = await fetchProfileMap(supabase, [
    ...(posts ?? []).map((p) => p["user_id"] as string),
    ...(renders ?? []).map((p) => p["user_id"] as string),
  ]);

  for (const p of posts ?? []) {
    const owner = p["user_id"] as string;
    map.set(`post:${p["id"] as string}`, {
      kind: "post",
      id: p["id"] as string,
      author_name: fallbackName(profiles.get(owner) ?? null, owner),
      body: (p["body"] as string | null) ?? null,
      image_url: await signPostFile(supabase, (p["image_url"] as string | null) ?? null),
    });
  }
  for (const r of renders ?? []) {
    const owner = r["user_id"] as string;
    const rid = r["id"] as string;
    map.set(`render:${rid}`, {
      kind: "render",
      id: rid,
      author_name: fallbackName(profiles.get(owner) ?? null, owner),
      body: (r["prompt"] as string | null) ?? null,
      image_url: await signRender(supabase, owner, rid),
    });
  }
  return map;
}

export const getConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("direct_messages")
      .select("id, from_user, to_user, body, read_at, created_at, shared_post_id, shared_render_id")
      .or(`from_user.eq.${userId},to_user.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(400);
    if (error) return { conversations: [] as Conversation[], error: error.message };

    const grouped = new Map<string, { last: Record<string, unknown>; unread: number }>();
    for (const r of rows ?? []) {
      const other = (r.from_user as string) === userId ? (r.to_user as string) : (r.from_user as string);
      const entry = grouped.get(other) ?? { last: r as Record<string, unknown>, unread: 0 };
      if ((r.to_user as string) === userId && !r.read_at) entry.unread += 1;
      grouped.set(other, entry);
    }

    const ids = Array.from(grouped.keys());
    const profiles = await fetchProfileMap(supabase, ids);
    const conversations: Conversation[] = await Promise.all(
      ids.map(async (id) => {
        const g = grouped.get(id)!;
        const p = profiles.get(id) ?? null;
        const body = (g.last["body"] as string | null) ?? null;
        return {
          user: {
            id,
            name: fallbackName(p, id),
            qualifications: p?.qualifications ?? null,
            avatar_signed: await signAvatar(supabase, p?.avatar_url ?? null),
          },
          last_body: body ?? "📎 Postingan dibagikan",
          last_at: g.last["created_at"] as string,
          unread: g.unread,
        };
      }),
    );
    conversations.sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime());
    return { conversations, error: null as string | null };
  });

export const getThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ withUser: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const other = data.withUser;
    const { data: rows, error } = await supabase
      .from("direct_messages")
      .select("id, from_user, to_user, body, read_at, created_at, shared_post_id, shared_render_id")
      .or(
        `and(from_user.eq.${userId},to_user.eq.${other}),and(from_user.eq.${other},to_user.eq.${userId})`,
      )
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) return { messages: [] as DirectMessage[], partner: null, error: error.message };

    await supabase
      .from("direct_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("to_user", userId)
      .eq("from_user", other)
      .is("read_at", null);

    const sharedMap = await buildSharedMap(
      supabase,
      (rows ?? []).map((r) => r.shared_post_id as string | null).filter(Boolean) as string[],
      (rows ?? []).map((r) => r.shared_render_id as string | null).filter(Boolean) as string[],
    );

    const profiles = await fetchProfileMap(supabase, [other]);
    const p = profiles.get(other) ?? null;

    const messages: DirectMessage[] = (rows ?? []).map((r) => ({
      id: r.id as string,
      from_user: r.from_user as string,
      to_user: r.to_user as string,
      body: (r.body as string | null) ?? null,
      created_at: r.created_at as string,
      read_at: (r.read_at as string | null) ?? null,
      mine: (r.from_user as string) === userId,
      shared: r.shared_post_id
        ? (sharedMap.get(`post:${r.shared_post_id as string}`) ?? null)
        : r.shared_render_id
          ? (sharedMap.get(`render:${r.shared_render_id as string}`) ?? null)
          : null,
    }));

    return {
      messages,
      partner: {
        id: other,
        name: fallbackName(p, other),
        qualifications: p?.qualifications ?? null,
        avatar_signed: await signAvatar(supabase, p?.avatar_url ?? null),
      } as MessageAccount,
      error: null as string | null,
    };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        toUser: z.string().uuid(),
        body: z.string().max(4000).nullable().optional(),
        shared_post_id: z.string().uuid().nullable().optional(),
        shared_render_id: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.toUser === userId)
      return { ok: false as const, error: "Tidak bisa mengirim pesan ke diri sendiri." };
    const body = (data.body ?? "").trim();
    if (!body && !data.shared_post_id && !data.shared_render_id)
      return { ok: false as const, error: "Pesan masih kosong." };

    const { error } = await supabase.from("direct_messages").insert({
      from_user: userId,
      to_user: data.toUser,
      body: body || null,
      shared_post_id: data.shared_post_id ?? null,
      shared_render_id: data.shared_render_id ?? null,
    });
    return { ok: !error, error: error?.message ?? null };
  });

export const getNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ count: unreadMessages }, { data: seen }] = await Promise.all([
      supabase
        .from("direct_messages")
        .select("id", { count: "exact", head: true })
        .eq("to_user", userId)
        .is("read_at", null),
      supabase.from("feed_seen").select("last_seen_at").eq("user_id", userId).maybeSingle(),
    ]);

    const since = (seen?.last_seen_at as string | null) ?? new Date(0).toISOString();
    const [{ count: newPosts }, { count: newRenders }] = await Promise.all([
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .neq("user_id", userId)
        .gt("created_at", since),
      supabase
        .from("renders")
        .select("id", { count: "exact", head: true })
        .neq("user_id", userId)
        .eq("status", "completed")
        .gt("created_at", since),
    ]);

    return {
      unreadMessages: unreadMessages ?? 0,
      feedUpdates: (newPosts ?? 0) + (newRenders ?? 0),
    };
  });

export const markFeedSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("feed_seen")
      .upsert({ user_id: userId, last_seen_at: now, updated_at: now }, { onConflict: "user_id" });
    return { ok: !error, error: error?.message ?? null };
  });
