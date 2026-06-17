import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Trash2, Download, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { listMyRenders, deleteRender, type RenderItem } from "@/lib/render.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

export const Route = createFileRoute("/gallery")({
  component: GalleryPage,
});

function GalleryPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const listFn = useServerFn(listMyRenders);
  const delFn = useServerFn(deleteRender);

  const [items, setItems] = useState<RenderItem[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
      return;
    }
    if (user) {
      listFn()
        .then((r) => setItems(r.items))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Error"))
        .finally(() => setFetching(false));
    }
  }, [user, loading, navigate, listFn]);

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus render ini?")) return;
    const r = await delFn({ data: { id } });
    if (r.ok) {
      setItems((prev) => prev.filter((x) => x.id !== id));
      toast.success("Render dihapus");
    } else {
      toast.error(r.error || "Gagal hapus");
    }
  };

  if (loading || fetching) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Galeri</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {items.length} render tersimpan
          </p>
        </div>
        <Button asChild className="bg-gradient-primary shadow-primary hover:opacity-90">
          <Link to="/studio">
            <Sparkles className="mr-2 h-4 w-4" />
            Render baru
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-surface/40 px-6 py-20 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground/40" />
          <h2 className="mt-4 font-display text-xl font-semibold">Belum ada render</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Mulai dengan mengupload sketsa pertama Anda di studio.
          </p>
          <Button asChild className="mt-6 bg-gradient-primary shadow-primary hover:opacity-90">
            <Link to="/studio">
              Buka Studio <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <motion.article
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              className="group overflow-hidden rounded-2xl border border-border/60 bg-surface/60 shadow-soft transition-all hover:border-ember/40"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-background">
                {item.result_url && item.status === "completed" ? (
                  <img
                    src={item.result_url}
                    alt={item.prompt}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    {item.status === "failed" ? "Gagal" : "Belum selesai"}
                  </div>
                )}
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {item.result_url && (
                    <Button asChild size="icon" variant="secondary" className="h-8 w-8">
                      <a href={item.result_url} target="_blank" rel="noreferrer" download>
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-md bg-ember/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ember">
                    {item.render_type}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Akurasi {item.accuracy} · Konsistensi {item.consistency}
                  </span>
                </div>
                <p className="line-clamp-2 text-sm text-foreground/80">{item.prompt}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {new Date(item.created_at).toLocaleString("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </main>
  );
}
