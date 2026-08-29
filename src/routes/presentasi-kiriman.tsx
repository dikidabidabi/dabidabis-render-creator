import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Inbox, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PresentasiBox, PrintStyles } from "./presentasi";

export const Route = createFileRoute("/presentasi-kiriman")({
  head: () => ({
    meta: [
      { title: "Presentasi Kiriman — Dabidabi's" },
      {
        name: "description",
        content:
          "Kotak masuk presentasi yang dibagikan akun lain: buka, telusuri slide, dan cetak dalam format A3 lanskap.",
      },
      { property: "og:title", content: "Presentasi Kiriman — Dabidabi's" },
      {
        property: "og:description",
        content: "Presentasi yang dibagikan akun lain, siap dibuka dan dicetak.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PresentasiKirimanPage,
});

type ShareRow = {
  id: string;
  title: string;
  created_at: string;
  from_user: string;
  payload: {
    sketch?: unknown;
    narasi?: unknown;
    perspektif?: unknown;
    moodboard?: unknown;
    plan?: unknown;
    analysis?: unknown;
    cover?: string | null;
    views?: Record<string, { scale: number; tx: number; ty: number }>;
  } | null;
};

function PresentasiKirimanPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [senders, setSenders] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!user) { setRows([]); setBusy(false); return; }
    if (!silent) setBusy(true);
    const { data, error } = await supabase
      .from("shared_presentations")
      .select("id, title, created_at, from_user, payload")
      .eq("to_user", user.id)
      .order("created_at", { ascending: false });
    if (error && !silent) toast.error("Gagal memuat presentasi kiriman.");
    const list = (data ?? []) as unknown as ShareRow[];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.from_user)));
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      const map: Record<string, string> = {};
      for (const p of profs ?? []) {
        map[p.id as string] = ((p as { display_name: string | null }).display_name || "").trim()
          || `Arsitek ${(p.id as string).slice(0, 6)}`;
      }
      setSenders(map);
    }
    setBusy(false);
  }, [user]);

  useEffect(() => {
    if (loading) return;
    void refresh();
    // Presentasi sumber bisa berubah kapan saja — segarkan berkala.
    const iv = window.setInterval(() => void refresh(true), 20000);
    return () => window.clearInterval(iv);
  }, [loading, refresh]);

  const remove = async (id: string) => {
    const { error } = await supabase.from("shared_presentations").delete().eq("id", id);
    if (error) { toast.error("Gagal menghapus kiriman."); return; }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success("Kiriman dihapus.");
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <PrintStyles />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Presentasi Kiriman</h1>
          <p className="text-sm text-muted-foreground">
            Presentasi yang dibagikan akun lain kepada Anda. Buka untuk menelusuri slide, lalu cetak
            atau unduh PDF/PPTX.
          </p>
        </div>
        <Link
          to="/presentasi"
          className="rounded-md border border-border bg-background/60 px-3 py-2 text-xs font-medium hover:border-primary hover:text-primary"
        >
          ← Presentasi saya
        </Link>
      </div>

      {!user && !loading ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/40 p-10 text-center text-sm text-muted-foreground">
          Masuk untuk melihat presentasi yang dibagikan kepada Anda.
        </div>
      ) : busy || loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/40 p-10 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Belum ada presentasi yang dibagikan kepada Anda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const p = r.payload ?? {};
            if (!p.sketch) return null;
            return (
              <div key={r.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
                  <span className="truncate">
                    Dari <strong className="text-foreground">{senders[r.from_user] ?? "Akun"}</strong>
                    {" · "}
                    {new Date(r.created_at).toLocaleString("id-ID")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 no-print"
                    title="Hapus kiriman"
                    onClick={() => void remove(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <PresentasiBox
                  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                  sketch={p.sketch as any}
                  narasi={(Array.isArray(p.narasi) ? p.narasi : []) as never}
                  perspektif={(Array.isArray(p.perspektif) ? p.perspektif : []) as never}
                  moodboard={(p.moodboard ?? null) as never}
                  planOverride={(p.plan ?? null) as never}
                  analysisOverride={(p.analysis ?? null) as never}
                  hideShare
                  annotateShareId={r.id}
                  viewsOverride={p.views ?? null}
                  coverOverride={p.cover ?? null}
                  open={openId === r.id}
                  onToggle={() => setOpenId((prev) => (prev === r.id ? null : r.id))}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
