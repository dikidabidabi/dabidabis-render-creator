import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Heart, Loader2, MessageCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { getFeed, toggleLike, type FeedItem } from "@/lib/social.functions";
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
          "Lihat unggahan render arsitektur terbaru dari seluruh akun Dabidabi's, beri like, dan kunjungi galeri arsiteknya.",
      },
      { property: "og:title", content: "Forum Feed — Dabidabi's" },
      {
        property: "og:description",
        content: "Aliran karya render arsitektur terbaru dari komunitas Dabidabi's.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

function FeedPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const fetchFeed = useServerFn(getFeed);
  const like = useServerFn(toggleLike);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(true);

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

  const onLike = async (id: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, liked_by_me: !it.liked_by_me, like_count: it.like_count + (it.liked_by_me ? -1 : 1) }
          : it,
      ),
    );
    const res = await like({ data: { renderId: id } });
    if (!res.ok) {
      toast.error(res.error ?? "Gagal menyukai");
      void load();
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">Forum Feed</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Unggahan galeri terbaru dari seluruh arsitek di Dabidabi's.
        </p>
      </header>

      {busy ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Memuat feed…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          Belum ada unggahan. Mulai render di{" "}
          <Link to="/project" className="text-ember underline">
            Project
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-6">
          {items.map((it, i) => (
            <motion.article
              key={it.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3) }}
              className="overflow-hidden rounded-xl border border-border/60 bg-surface/40"
            >
              <div className="flex items-center gap-3 p-4">
                <Link to="/gallery" search={{ u: it.user_id }} className="shrink-0">
                  {it.author_avatar ? (
                    <img
                      src={it.author_avatar}
                      alt={`Foto profil ${it.author_name}`}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ember/15 text-ember">
                      <Users className="h-4 w-4" />
                    </div>
                  )}
                </Link>
                <div className="min-w-0">
                  <Link
                    to="/gallery"
                    search={{ u: it.user_id }}
                    className="block truncate text-sm font-semibold hover:text-ember"
                  >
                    {it.author_name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {it.author_qualifications ? `${it.author_qualifications} · ` : ""}
                    {timeAgo(it.created_at)}
                  </p>
                </div>
              </div>

              {it.result_url && (
                <Link to="/gallery" search={{ u: it.user_id }}>
                  <img
                    src={it.result_url}
                    alt={it.prompt.slice(0, 120)}
                    loading="lazy"
                    className="w-full bg-black/5 object-cover"
                  />
                </Link>
              )}

              <div className="space-y-3 p-4">
                <p className="line-clamp-3 text-sm text-muted-foreground">{it.prompt}</p>
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void onLike(it.id)}
                    className={it.liked_by_me ? "text-ember" : "text-muted-foreground"}
                  >
                    <Heart className={`mr-1.5 h-4 w-4 ${it.liked_by_me ? "fill-current" : ""}`} />
                    {it.like_count}
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                    <Link to="/gallery" search={{ u: it.user_id }}>
                      <MessageCircle className="mr-1.5 h-4 w-4" />
                      {it.comment_count}
                    </Link>
                  </Button>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </main>
  );
}
