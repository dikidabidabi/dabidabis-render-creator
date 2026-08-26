import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Repeat2, Search, Send, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { searchAccounts, sendMessage, type MessageAccount } from "@/lib/messages.functions";

export type SharePayload = { kind: "post" | "tender" | "render"; id: string; title: string };

export function SharePostDialog({
  target,
  onClose,
  onShareToFeed,
}: {
  target: SharePayload | null;
  onClose: () => void;
  onShareToFeed: (target: SharePayload, note: string) => Promise<void> | void;
}) {
  const listAccounts = useServerFn(searchAccounts);
  const send = useServerFn(sendMessage);
  const [q, setQ] = useState("");
  const [accounts, setAccounts] = useState<MessageAccount[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [note, setNote] = useState("");
  const [feedNote, setFeedNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setLoadingList(true);
    const t = setTimeout(async () => {
      try {
        const res = await listAccounts({ data: { q } });
        setAccounts(res.accounts);
      } finally {
        setLoadingList(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, target, listAccounts]);

  const shareToFeed = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await onShareToFeed(target, feedNote.trim());
      setFeedNote("");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const shareViaMessage = async (to: string) => {
    if (!target) return;
    setPicked(to);
    const res = await send({
      data: {
        toUser: to,
        body: note.trim() || `Membagikan: ${target.title}`,
        ...(target.kind === "render"
          ? { shared_render_id: target.id }
          : { shared_post_id: target.id }),
      },
    });
    setPicked(null);
    if (res.ok) {
      toast.success("Postingan dikirim lewat pesan");
      setNote("");
      onClose();
    } else {
      toast.error(res.error ?? "Gagal mengirim pesan");
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bagikan postingan</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {target?.title || "Postingan"}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="feed">
          <TabsList className="w-full">
            <TabsTrigger value="feed" className="flex-1">
              Ke forum feed saya
            </TabsTrigger>
            <TabsTrigger value="dm" className="flex-1">
              Kirim lewat pesan
            </TabsTrigger>
          </TabsList>

          <TabsContent value="feed" className="space-y-3 pt-3">
            <Textarea
              value={feedNote}
              onChange={(e) => setFeedNote(e.target.value)}
              placeholder="Tambahkan catatan (opsional)…"
              rows={3}
            />
            <Button
              onClick={() => void shareToFeed()}
              disabled={busy}
              className="w-full bg-ember text-white hover:bg-ember/90"
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Repeat2 className="mr-2 h-4 w-4" />
              )}
              Bagikan ke feed saya
            </Button>
          </TabsContent>

          <TabsContent value="dm" className="space-y-3 pt-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Pesan pengantar (opsional)…"
              rows={2}
            />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari nama akun…"
                className="pl-9"
              />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {loadingList ? (
                <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat akun…
                </p>
              ) : accounts.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">Akun tidak ditemukan.</p>
              ) : (
                accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => void shareViaMessage(a.id)}
                    disabled={picked === a.id}
                    className="flex w-full items-center gap-3 rounded-lg border border-border/60 p-2 text-left transition-colors hover:border-ember/50 hover:bg-ember/5"
                  >
                    {a.avatar_signed ? (
                      <img
                        src={a.avatar_signed}
                        alt={`Foto profil ${a.name}`}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ember/15 text-ember">
                        <Users className="h-4 w-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.name}</span>
                      {a.qualifications && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {a.qualifications}
                        </span>
                      )}
                    </span>
                    {picked === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-ember" />
                    ) : (
                      <Send className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
