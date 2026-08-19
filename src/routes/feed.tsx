import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  createPost,
  getFeed,
  togglePostLike,
  toggleLike,
  type FeedItem,
} from "@/lib/social.functions";
import { FeedEntryCard } from "@/components/feed-entry-card";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

export const Route = createFileRoute("/feed")({
  component: FeedPage,
  head: () => ({
    meta: [
      { title: "Forum Feed — Dabidabi's" },
      {
        name: "description",
        content:
          "Lihat unggahan render, postingan, dan tender terbaru dari seluruh akun Dabidabi's, beri like, repost, dan kunjungi galeri arsiteknya.",
      },
      { property: "og:title", content: "Forum Feed — Dabidabi's" },
      {
        property: "og:description",
        content: "Aliran karya render, postingan, dan tender arsitektur terbaru dari komunitas Dabidabi's.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function FeedPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const fetchFeed = useServerFn(getFeed);
  const likeRender = useServerFn(toggleLike);
  const likePost = useServerFn(togglePostLike);
  const postFn = useServerFn(createPost);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [reposting, setReposting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetchFeed({});
      if (res.error) toast.error(res.error);
      setItems(res.items);
    } catch {
      toast.error("Gagal memuat forum feed");
    } finally {
      setBusy(false);
    }
  }, [fetchFeed]);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
      return;
    }
    if (user) void load();
  }, [user, loading, navigate, load]);

  const onLike = async (item: FeedItem) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id
          ? { ...it, liked_by_me: !it.liked_by_me, like_count: it.like_count + (it.liked_by_me ? -1 : 1) }
          : it,
      ),
    );
    const res =
      item.kind === "render"
        ? await likeRender({ data: { renderId: item.id } })
        : await likePost({ data: { postId: item.id } });
    if (!res.ok) {
      toast.error(res.error ?? "Gagal menyukai");
      void load();
    }
  };

  const onRepost = async (item: FeedItem) => {
    setReposting(item.id);
    const res = await postFn({
      data:
        item.kind === "render"
          ? { kind: "post", repost_of_render: item.id }
          : { kind: "post", repost_of_post: item.id },
    });
    setReposting(null);
    if (res.ok) {
      toast.success("Berhasil repost ke forum feed");
      void load();
    } else {
      toast.error(res.error ?? "Gagal repost");
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">Forum Feed</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Render, postingan, dan tender terbaru dari seluruh arsitek di Dabidabi's.
        </p>
      </header>

      {busy ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Memuat feed…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          Belum ada unggahan. Mulai posting dari{" "}
          <Link to="/gallery" className="text-ember underline">
            Galeri
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-6">
          {items.map((it, i) => (
            <FeedEntryCard
              key={`${it.kind}-${it.id}`}
              item={it}
              index={i}
              busyRepost={reposting === it.id}
              onLike={() => void onLike(it)}
              onRepost={() => void onRepost(it)}
            />
          ))}
        </div>
      )}
    </main>
  );
}
