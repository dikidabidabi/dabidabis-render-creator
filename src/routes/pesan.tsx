import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MessageSquare, Search, Send, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useNotifications } from "@/lib/notifications";
import { timeAgo } from "@/components/feed-entry-card";
import {
  getConversations,
  getThread,
  searchAccounts,
  sendMessage,
  type Conversation,
  type DirectMessage,
  type MessageAccount,
  type SharedPreview,
} from "@/lib/messages.functions";

export const Route = createFileRoute("/pesan")({
  component: MessagesPage,
  head: () => ({
    meta: [
      { title: "Pesan — Dabidabi's" },
      {
        name: "description",
        content:
          "Kirim pesan langsung antar akun Dabidabi's, bagikan postingan forum feed, dan pantau notifikasi pesan baru.",
      },
      { property: "og:title", content: "Pesan — Dabidabi's" },
      {
        property: "og:description",
        content: "Komunikasi langsung antar arsitek di Dabidabi's lewat pesan pribadi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Avatar({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img src={url} alt={`Foto profil ${name}`} className="h-9 w-9 rounded-full object-cover" />
  ) : (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ember/15 text-ember">
      <Users className="h-4 w-4" />
    </span>
  );
}

function MessagesPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { refresh } = useNotifications();
  const listConvos = useServerFn(getConversations);
  const loadThread = useServerFn(getThread);
  const send = useServerFn(sendMessage);
  const listAccounts = useServerFn(searchAccounts);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<MessageAccount | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [accounts, setAccounts] = useState<MessageAccount[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const reloadConvos = useCallback(async () => {
    const res = await listConvos({});
    if (res.error) toast.error(res.error);
    setConversations(res.conversations);
    setBusy(false);
  }, [listConvos]);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
      return;
    }
    if (user) void reloadConvos();
  }, [user, loading, navigate, reloadConvos]);

  useEffect(() => {
    if (!q.trim()) {
      setAccounts([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await listAccounts({ data: { q } });
      setAccounts(res.accounts);
    }, 250);
    return () => clearTimeout(t);
  }, [q, listAccounts]);

  const openThread = useCallback(
    async (partner: MessageAccount) => {
      setActive(partner);
      setMessages([]);
      const res = await loadThread({ data: { withUser: partner.id } });
      if (res.error) toast.error(res.error);
      setMessages(res.messages);
      if (res.partner) setActive(res.partner);
      void refresh();
      void reloadConvos();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    },
    [loadThread, refresh, reloadConvos],
  );

  const submit = async () => {
    if (!active || !draft.trim()) return;
    setSending(true);
    const res = await send({ data: { toUser: active.id, body: draft } });
    setSending(false);
    if (!res.ok) {
      toast.error(res.error ?? "Gagal mengirim pesan");
      return;
    }
    setDraft("");
    await openThread(active);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">Pesan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Komunikasi langsung antar akun dan berbagi postingan forum feed.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3 rounded-xl border border-border/60 bg-surface/40 p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari akun untuk memulai chat…"
              className="pl-9"
            />
          </div>

          {accounts.length > 0 && (
            <div className="space-y-1 rounded-lg border border-ember/30 bg-ember/5 p-2">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ember">
                Mulai percakapan
              </p>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setQ("");
                    void openThread(a);
                  }}
                  className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-background/60"
                >
                  <Avatar url={a.avatar_signed} name={a.name} />
                  <span className="truncate text-sm">{a.name}</span>
                </button>
              ))}
            </div>
          )}

          {busy ? (
            <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Memuat…
            </p>
          ) : conversations.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              Belum ada percakapan. Cari akun di atas untuk mulai berkirim pesan.
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.user.id}>
                  <button
                    type="button"
                    onClick={() => void openThread(c.user)}
                    className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors ${
                      active?.id === c.user.id ? "bg-ember/10" : "hover:bg-background/60"
                    }`}
                  >
                    <Avatar url={c.user.avatar_signed} name={c.user.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.user.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.last_body}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(c.last_at)}
                      </span>
                      {c.unread > 0 && (
                        <span className="rounded-full bg-ember px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {c.unread}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="flex min-h-[28rem] flex-col rounded-xl border border-border/60 bg-surface/40">
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <MessageSquare className="h-8 w-8 text-ember/60" />
              Pilih percakapan atau cari akun untuk mulai berkirim pesan.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border/60 p-3">
                <Avatar url={active.avatar_signed} name={active.name} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{active.name}</p>
                  {active.qualifications && (
                    <p className="truncate text-xs text-muted-foreground">
                      {active.qualifications}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada pesan.</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] space-y-2 rounded-xl px-3 py-2 text-sm ${
                          m.mine
                            ? "bg-ember text-white"
                            : "border border-border/60 bg-background/70 text-foreground"
                        }`}
                      >
                        {m.shared && (
                          <div
                            className={`overflow-hidden rounded-lg border ${
                              m.mine ? "border-white/30 bg-white/10" : "border-border/60 bg-surface/60"
                            }`}
                          >
                            {m.shared.image_url && (
                              <img
                                src={m.shared.image_url}
                                alt="Postingan yang dibagikan"
                                loading="lazy"
                                className="w-full object-cover"
                              />
                            )}
                            <div className="p-2 text-xs">
                              <p className="font-semibold">{m.shared.author_name}</p>
                              {m.shared.body && (
                                <p className="line-clamp-3 opacity-80">{m.shared.body}</p>
                              )}
                            </div>
                          </div>
                        )}
                        {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                        <p className={`text-[10px] ${m.mine ? "text-white/70" : "text-muted-foreground"}`}>
                          {timeAgo(m.created_at)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              <div className="flex items-end gap-2 border-t border-border/60 p-3">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="Tulis pesan…"
                  rows={2}
                  className="min-h-[44px] flex-1 resize-none"
                />
                <Button
                  onClick={() => void submit()}
                  disabled={sending || !draft.trim()}
                  className="bg-ember text-white hover:bg-ember/90"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
