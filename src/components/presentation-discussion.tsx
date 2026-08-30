// Kotak diskusi mengapung di kanan bawah presentasi (sumber & kiriman).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageSquare, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fetchDiscussion,
  fetchOwnerThreads,
  fetchRecipientThread,
  formatChatTime,
  sendDiscussion,
  type DiscussionMsg,
  type ShareThread,
} from "@/lib/presentation-discussion";

export function PresentationDiscussion({
  me,
  title,
  shareId,
}: {
  /** ID akun saya. */
  me: string;
  /** Judul presentasi (sisi pengirim, untuk mengumpulkan semua utas). */
  title?: string;
  /** ID kiriman (sisi penerima). */
  shareId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ShareThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(shareId ?? null);
  const [msgs, setMsgs] = useState<DiscussionMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Kumpulkan utas yang tersedia.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (shareId) {
        const t = await fetchRecipientThread(shareId, me);
        if (!alive) return;
        setThreads(t ? [t] : []);
        setActiveId(shareId);
        return;
      }
      if (!title) return;
      const list = await fetchOwnerThreads(me, title);
      if (!alive) return;
      setThreads(list);
      setActiveId((prev) => prev ?? list[0]?.id ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [me, title, shareId]);

  const load = useCallback(
    async (silent = false) => {
      if (!activeId) return;
      if (!silent) setLoading(true);
      try {
        const rows = await fetchDiscussion(activeId);
        setMsgs(rows);
      } catch {
        /* abaikan */
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeId],
  );

  useEffect(() => {
    if (!open || !activeId) return;
    void load();
    const iv = window.setInterval(() => void load(true), 10000);
    return () => window.clearInterval(iv);
  }, [open, activeId, load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open]);

  const active = useMemo(() => threads.find((t) => t.id === activeId) ?? null, [threads, activeId]);

  const submit = async () => {
    if (!activeId || !draft.trim()) return;
    setSending(true);
    try {
      await sendDiscussion(activeId, me, draft);
      setDraft("");
      await load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim pesan diskusi.");
    } finally {
      setSending(false);
    }
  };

  if (threads.length === 0 && !shareId) return null;

  return (
    <div className="no-print fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="flex h-[22rem] w-[19rem] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl sm:w-[21rem]">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="flex-1 truncate text-xs font-semibold">Diskusi presentasi</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Tutup diskusi">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {threads.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
              {threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveId(t.id)}
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-1 text-[10px] transition",
                    t.id === activeId
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.peerName}
                </button>
              ))}
            </div>
          )}

          {active && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              {active.peerAvatar ? (
                <img
                  src={active.peerAvatar}
                  alt={`Foto profil ${active.peerName}`}
                  className="h-6 w-6 rounded-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
                  {active.peerName.slice(0, 2)}
                </span>
              )}
              <span className="truncate text-[11px] text-muted-foreground">{active.peerName}</span>
            </div>
          )}

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {!loading && msgs.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Belum ada diskusi. Mulai percakapan tentang presentasi ini.
              </p>
            )}
            {msgs.map((m) => {
              const mine = m.user_id === me;
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px]",
                      mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={cn("mt-0.5 text-[9px]", mine ? "opacity-70" : "text-muted-foreground")}>
                      {formatChatTime(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-end gap-1.5 border-t border-border px-2 py-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              placeholder="Tulis pesan diskusi…"
              className="max-h-24 flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[11px] outline-none focus:border-primary"
            />
            <Button
              size="icon"
              className="h-8 w-8"
              onClick={() => void submit()}
              disabled={sending || !draft.trim() || !activeId}
              title="Kirim"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      <Button size="sm" className="gap-1.5 shadow-lg" onClick={() => setOpen((o) => !o)}>
        <MessageSquare className="h-4 w-4" />
        Diskusi
      </Button>
    </div>
  );
}
