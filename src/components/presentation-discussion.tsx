// Kotak diskusi menempel di bawah tiap presentasi (sumber & kiriman).
// Realtime antar akun + lencana jumlah chat baru.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  countUnread,
  fetchDiscussion,
  fetchOwnerThreads,
  fetchParticipants,
  fetchRecipientThread,
  formatChatTime,
  sendDiscussion,
  setSeenAt,
  type DiscussionMsg,
  type Person,
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
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Kumpulkan utas yang tersedia (hanya akun yang dibagikan presentasi ini).
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

  const threadIds = useMemo(() => threads.map((t) => t.id), [threads]);
  const idsKey = threadIds.join(",");

  // Hitung awal chat baru pada semua utas.
  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, number> = {};
      for (const id of threadIds) {
        try {
          const rows = await fetchDiscussion(id);
          next[id] = countUnread(rows, me, id);
        } catch {
          next[id] = 0;
        }
      }
      if (alive) setUnread(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, me]);

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
    if (!activeId) return;
    void load();
  }, [activeId, load]);

  // Realtime: pesan baru masuk seketika untuk semua utas presentasi ini.
  useEffect(() => {
    if (threadIds.length === 0) return;
    const set = new Set(threadIds);
    const channel = supabase
      .channel(`presentation-discussions-${threadIds[0]}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "presentation_discussions" },
        (payload) => {
          const row = payload.new as DiscussionMsg;
          if (!row?.share_id || !set.has(row.share_id)) return;
          if (row.share_id === activeId) {
            setMsgs((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
          }
          if (row.user_id === me) return;
          if (row.share_id === activeId && open) {
            setSeenAt(row.share_id, row.created_at);
            return;
          }
          setUnread((prev) => ({ ...prev, [row.share_id]: (prev[row.share_id] ?? 0) + 1 }));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, activeId, open, me]);

  // Tandai terbaca saat utas aktif dibuka.
  useEffect(() => {
    if (!open || !activeId) return;
    setSeenAt(activeId);
    setUnread((prev) => (prev[activeId] ? { ...prev, [activeId]: 0 } : prev));
  }, [open, activeId, msgs.length]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open]);

  const active = useMemo(() => threads.find((t) => t.id === activeId) ?? null, [threads, activeId]);
  const totalUnread = useMemo(
    () => threadIds.reduce((s, id) => s + (unread[id] ?? 0), 0),
    [threadIds, unread],
  );
  const heading = active?.title || title || "Presentasi";

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

  if (threads.length === 0) return null;

  return (
    <div className="no-print mt-3 overflow-hidden rounded-xl border border-border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        <MessageSquare className="h-4 w-4 text-primary" />
        <span className="flex-1 truncate text-xs font-semibold">Diskusi — {heading}</span>
        {totalUnread > 0 && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            {totalUnread}
          </span>
        )}
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="flex h-[20rem] flex-col border-t border-border">
          {threads.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
              {threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveId(t.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition",
                    t.id === activeId
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.peerName}
                  {(unread[t.id] ?? 0) > 0 && (
                    <span className="rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                      {unread[t.id]}
                    </span>
                  )}
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
    </div>
  );
}
