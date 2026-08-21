// Dialog "Bagikan kepada" untuk mengirim satu judul presentasi ke akun lain.
import { useEffect, useState } from "react";
import { Loader2, Send, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

type Candidate = { id: string; display_name: string | null };

export function SharePresentationDialog({
  title,
  buildPayload,
}: {
  title: string;
  buildPayload: () => unknown;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Candidate[]>([]);
  const [target, setTarget] = useState<Candidate | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    let alive = true;
    const t = window.setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name")
        .ilike("display_name", `%${term}%`)
        .limit(8);
      if (!alive) return;
      setHits(((data ?? []) as Candidate[]).filter((p) => p.id !== user?.id));
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q, open, user?.id]);

  const send = async () => {
    if (!user) { toast.error("Masuk dulu untuk membagikan presentasi."); return; }
    if (!target) { toast.error("Pilih nama akun tujuan terlebih dahulu."); return; }
    setSending(true);
    try {
      const payload = buildPayload();
      const { error } = await supabase.from("shared_presentations").insert({
        from_user: user.id,
        to_user: target.id,
        title,
        payload: payload as never,
      });
      if (error) throw error;
      toast.success(`Presentasi "${title}" dikirim ke ${target.display_name ?? "akun"}.`);
      setOpen(false);
      setQ("");
      setTarget(null);
      setHits([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membagikan presentasi.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="h-8 shrink-0 gap-1.5" title="Bagikan presentasi ini">
          <Share2 className="h-4 w-4" />
          Bagikan
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bagikan kepada</DialogTitle>
          <DialogDescription>
            Kirim presentasi “{title}” ke akun lain. Penerima dapat membuka dan mencetaknya di sub
            halaman Presentasi Kiriman.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={target ? (target.display_name ?? "Akun") : q}
            onChange={(e) => { setTarget(null); setQ(e.target.value); }}
            placeholder="Ketik nama akun tujuan…"
            autoFocus
          />
          {!target && hits.length > 0 && (
            <div className="max-h-52 overflow-y-auto rounded-md border border-border">
              {hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => { setTarget(h); setHits([]); }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {h.display_name?.trim() || `Arsitek ${h.id.slice(0, 6)}`}
                </button>
              ))}
            </div>
          )}
          {!target && q.trim().length >= 2 && hits.length === 0 && (
            <p className="text-xs text-muted-foreground">Tidak ada akun dengan nama tersebut.</p>
          )}
          <Button className="w-full gap-2" onClick={send} disabled={sending || !target}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Kirim presentasi
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
