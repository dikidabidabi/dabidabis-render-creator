import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  Trash2,
  Download,
  Sparkles,
  ArrowRight,
  Camera,
  Heart,
  MessageCircle,
  Pencil,
  Save,
  Users,
  Send,
  X,
  Building2,
  FileText,
  Gavel,
  Image as ImageIcon,
  Network,
  PenLine,
  Paperclip,
  Reply,
  Check,
  ArrowUpDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { deleteRender } from "@/lib/render.functions";
import {
  getGallery,
  listGalleries,
  saveProfile,
  uploadAvatar,
  toggleLike,
  addComment,
  deleteComment,
  editComment,
  toggleCommentReaction,
  markRenderCommentsSeen,
  getPosts,
  createPost,
  deletePost,
  togglePostLike,
  addPostComment,
  deletePostComment,
  uploadPostFile,
  saveAccountSetup,
  type GalleryItem,
  type GalleryOwner,
  type Hierarchy,
  type PostItem,
} from "@/lib/social.functions";
import { FeedEntryCard } from "@/components/feed-entry-card";
import { nominatimSearch, type NominatimHit } from "@/lib/geo";
import {
  listAttachableSketches,
  buildAttachmentText,
  attachmentDataUrl,
  type AttachableSketch,
} from "@/lib/tender-sketch";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";


export const Route = createFileRoute("/gallery")({
  validateSearch: z.object({
    u: z.string().uuid().optional(),
    r: z.string().uuid().optional(),
    c: z.string().uuid().optional(),
  }),

  component: GalleryPage,
  head: () => ({
    meta: [
      { title: "Galeri Render Arsitektur — Dabidabi's" },
      {
        name: "description",
        content:
          "Galeri render arsitektur tiap arsitek: profil, kualifikasi, serta like dan komentar antar akun.",
      },
      { property: "og:title", content: "Galeri Render Arsitektur — Dabidabi's" },
      {
        property: "og:description",
        content: "Kunjungi galeri arsitek lain, beri like dan komentar pada karya render mereka.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type GalleryCard = {
  id: string;
  name: string;
  qualifications: string | null;
  avatar_signed: string | null;
  render_count: number;
  is_me: boolean;
};

function GalleryPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const galleryFn = useServerFn(getGallery);
  const listFn = useServerFn(listGalleries);
  const delFn = useServerFn(deleteRender);
  const postsFn = useServerFn(getPosts);
  const repostFn = useServerFn(createPost);
  const delPostFn = useServerFn(deletePost);
  const likePostFn = useServerFn(togglePostLike);

  const [owner, setOwner] = useState<GalleryOwner | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [others, setOthers] = useState<GalleryCard[]>([]);
  const [hierarchy, setHierarchy] = useState<Hierarchy>(null);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [reposting, setReposting] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const r = await galleryFn({ data: search.u ? { userId: search.u } : {} });
      setOwner(r.owner);
      setIsOwner(r.isOwner);
      setItems(r.items);
      setHierarchy(r.hierarchy);
      const p = await postsFn({ data: search.u ? { userId: search.u } : {} });
      setPosts(p.posts);
      const l = await listFn();
      setOthers(l.galleries);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat galeri");
    } finally {
      setFetching(false);
    }
  }, [galleryFn, listFn, postsFn, search.u]);

  const reloadPosts = useCallback(async () => {
    const p = await postsFn({ data: search.u ? { userId: search.u } : {} });
    setPosts(p.posts);
  }, [postsFn, search.u]);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
      return;
    }
    if (user) void load();
  }, [user, loading, navigate, load]);

  const handleLikePost = async (post: PostItem) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, liked_by_me: !p.liked_by_me, like_count: p.like_count + (p.liked_by_me ? -1 : 1) }
          : p,
      ),
    );
    const r = await likePostFn({ data: { postId: post.id } });
    if (!r.ok) {
      toast.error(r.error || "Gagal menyukai");
      void reloadPosts();
    }
  };

  const handleRepost = async (payload: { renderId?: string; postId?: string }) => {
    const key = payload.renderId ?? payload.postId ?? "";
    setReposting(key);
    const r = await repostFn({
      data: payload.renderId
        ? { kind: "post", repost_of_render: payload.renderId }
        : { kind: "post", repost_of_post: payload.postId! },
    });
    setReposting(null);
    if (r.ok) {
      toast.success("Berhasil repost ke forum feed");
      void reloadPosts();
    } else {
      toast.error(r.error || "Gagal repost");
    }
  };

  const handleDeletePost = async (id: string) => {
    if (!confirm("Hapus postingan ini?")) return;
    const r = await delPostFn({ data: { id } });
    if (r.ok) {
      setPosts((prev) => prev.filter((p) => p.id !== id));
      toast.success("Postingan dihapus");
    } else {
      toast.error(r.error || "Gagal hapus");
    }
  };


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
      {owner && (
        <ProfileHeader owner={owner} isOwner={isOwner} onChange={setOwner} count={items.length} />
      )}

      {owner && (
        <HierarchySection
          hierarchy={hierarchy}
          owner={owner}
          isOwner={isOwner}
          onSaved={load}
        />
      )}

      {isOwner && <PostComposer onCreated={reloadPosts} />}

      {posts.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <PenLine className="h-4 w-4 text-ember" />
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Postingan & Tender
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {posts.map((p, i) => (
              <FeedEntryCard
                key={p.id}
                item={p}
                index={i}
                canDelete={p.is_mine}
                busyRepost={reposting === p.id}
                onLike={() => void handleLikePost(p)}
                onRepost={() => void handleRepost({ postId: p.id })}
                onDelete={() => void handleDeletePost(p.id)}
              >
                <PostComments post={p} currentUserId={user?.id ?? null} onChange={reloadPosts} />
              </FeedEntryCard>
            ))}
          </div>
        </section>
      )}


      <div className="mb-8 mt-10 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {isOwner ? "Galeri" : `Galeri ${owner?.name ?? ""}`}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{items.length} render tersimpan</p>
        </div>
        {isOwner && (
          <Button asChild className="bg-gradient-primary shadow-primary hover:opacity-90">
            <Link to="/studio">
              <Sparkles className="mr-2 h-4 w-4" />
              Render baru
            </Link>
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-surface/40 px-6 py-20 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground/40" />
          <h2 className="mt-4 font-display text-xl font-semibold">Belum ada render</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {isOwner
              ? "Mulai dengan mengupload sketsa pertama Anda di studio."
              : "Arsitek ini belum membagikan karya."}
          </p>
          {isOwner && (
            <Button asChild className="mt-6 bg-gradient-primary shadow-primary hover:opacity-90">
              <Link to="/studio">
                Buka Studio <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <RenderCard
              key={item.id}
              item={item}
              index={i}
              canDelete={isOwner}
              currentUserId={user?.id ?? null}
              onDelete={() => handleDelete(item.id)}
              onPatch={(patch) =>
                setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...patch } : x)))
              }
            />
          ))}
        </div>
      )}

      <OtherGalleries others={others} activeId={owner?.id ?? null} />
    </main>
  );
}

function ProfileHeader({
  owner,
  isOwner,
  onChange,
  count,
}: {
  owner: GalleryOwner;
  isOwner: boolean;
  onChange: (o: GalleryOwner) => void;
  count: number;
}) {
  const saveFn = useServerFn(saveProfile);
  const avatarFn = useServerFn(uploadAvatar);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(owner.display_name ?? "");
  const [bio, setBio] = useState(owner.bio ?? "");
  const [qual, setQual] = useState(owner.qualifications ?? "");

  useEffect(() => {
    setName(owner.display_name ?? "");
    setBio(owner.bio ?? "");
    setQual(owner.qualifications ?? "");
  }, [owner]);

  const pickAvatar = async (file: File) => {
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Ukuran foto maksimal 4 MB");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("Gagal membaca file"));
      fr.readAsDataURL(file);
    });
    setBusy(true);
    const r = await avatarFn({ data: { dataUrl } });
    setBusy(false);
    if (r.ok) {
      onChange({ ...owner, avatar_signed: r.url ?? owner.avatar_signed });
      toast.success("Foto profil diperbarui");
    } else {
      toast.error(r.error || "Gagal unggah foto");
    }
  };

  const save = async () => {
    setBusy(true);
    const r = await saveFn({
      data: { display_name: name.trim() || null, bio: bio.trim() || null, qualifications: qual.trim() || null },
    });
    setBusy(false);
    if (r.ok) {
      onChange({
        ...owner,
        display_name: name.trim() || null,
        bio: bio.trim() || null,
        qualifications: qual.trim() || null,
        name: name.trim() || owner.name,
      });
      setEditing(false);
      toast.success("Profil disimpan");
    } else {
      toast.error(r.error || "Gagal menyimpan");
    }
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-surface/60 p-5 shadow-soft sm:p-7">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="relative shrink-0">
          <div className="h-28 w-28 overflow-hidden rounded-2xl border border-border/60 bg-background sm:h-32 sm:w-32">
            {owner.avatar_signed ? (
              <img
                src={owner.avatar_signed}
                alt={`Foto profil ${owner.name}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-display text-3xl text-muted-foreground/50">
                {owner.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          {isOwner && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pickAvatar(f);
                  e.target.value = "";
                }}
              />
              <Button
                size="icon"
                variant="secondary"
                disabled={busy}
                className="absolute -bottom-2 -right-2 h-9 w-9 rounded-full shadow-soft"
                onClick={() => fileRef.current?.click()}
                aria-label="Unggah foto profil"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </Button>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama pemilik akun"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 font-display text-lg outline-none focus:border-ember/60"
              />
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Deskripsi personal (studio, fokus desain, pengalaman)"
                rows={3}
                className="w-full resize-y rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-ember/60"
              />
              <textarea
                value={qual}
                onChange={(e) => setQual(e.target.value)}
                placeholder="Kualifikasi arsitek (STRA/IAI, pendidikan, sertifikasi, penghargaan)"
                rows={3}
                className="w-full resize-y rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-ember/60"
              />
              <div className="flex gap-2">
                <Button onClick={save} disabled={busy} className="bg-gradient-primary hover:opacity-90">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Simpan
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  <X className="mr-2 h-4 w-4" /> Batal
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-2xl font-semibold tracking-tight">{owner.name}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {owner.account_type && (
                      <span className="rounded-md bg-ember/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ember">
                        {owner.account_type}
                      </span>
                    )}
                    {owner.professional_level && (
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {owner.professional_level}
                      </span>
                    )}
                    {(owner.corporate_code || owner.corporate_parent_code) && (
                      <span className="rounded-md border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {owner.corporate_code || owner.corporate_parent_code}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{count} karya render</p>
                </div>
                {isOwner && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Edit profil
                  </Button>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/80">
                {owner.bio ?? (isOwner ? "Belum ada deskripsi personal." : "—")}
              </p>
              <div className="mt-4 rounded-xl border border-border/50 bg-background/40 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-ember">
                  Kualifikasi arsitek
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">
                  {owner.qualifications ?? (isOwner ? "Belum diisi." : "—")}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const REACTION_EMOJIS = ["\ud83d\udc4d", "\u2764\ufe0f", "\ud83d\udd25", "\ud83d\udc4f", "\ud83d\udca1", "\ud83d\ude2e"];

type SortMode = "baru" | "lama" | "populer";

type GalleryComment = GalleryItem["comments"][number];

function commentScore(c: GalleryComment, replies: GalleryComment[]) {
  const reactions = (c.reactions ?? []).reduce((n, r) => n + r.count, 0);
  return reactions * 2 + replies.length;
}

function CommentRow({
  comment,
  replies,
  currentUserId,
  depth,
  onReply,
  onEdit,
  onDelete,
  onReact,
  children,
}: {
  comment: GalleryComment;
  replies: GalleryComment[];
  currentUserId: string | null;
  depth: number;
  onReply: (c: GalleryComment) => void;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const mine = comment.user_id === currentUserId;
  const edited = comment.updated_at && comment.updated_at !== comment.created_at;

  const save = async () => {
    const body = draft.trim();
    if (!body || body === comment.body) {
      setEditing(false);
      setDraft(comment.body);
      return;
    }
    setSaving(true);
    await onEdit(comment.id, body);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className={depth > 0 ? "ml-5 border-l border-border/50 pl-2" : ""}>
      <div className="flex gap-2 rounded-lg bg-background/50 p-2">
        <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-surface">
          {comment.author_avatar ? (
            <img src={comment.author_avatar} alt={comment.author_name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              {comment.author_name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium">
            {comment.author_name}
            <span className="ml-2 font-normal text-muted-foreground">
              {new Date(comment.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
              {edited ? " · diedit" : ""}
            </span>
          </p>

          {editing ? (
            <div className="mt-1 flex gap-1">
              <input
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void save();
                  }
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(comment.body);
                  }
                }}
                className="min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:border-ember/60"
              />
              <Button size="icon" className="h-7 w-7" disabled={saving} onClick={save} aria-label="Simpan komentar">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-xs text-foreground/80">{comment.body}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {(comment.reactions ?? []).map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(comment.id, r.emoji)}
                className={`rounded-full border px-1.5 py-0.5 text-[10px] transition-colors ${
                  r.mine ? "border-ember/60 bg-ember/10 text-ember" : "border-border/60 text-muted-foreground hover:border-ember/40"
                }`}
              >
                {r.emoji} {r.count}
              </button>
            ))}
            <div className="relative">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className="rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-ember/40"
                aria-label="Tambah reaksi"
              >
                + 😊
              </button>
              {pickerOpen && (
                <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-lg border border-border/60 bg-surface p-1 shadow-soft">
                  {REACTION_EMOJIS.map((e) => (
                    <button
                      key={e}
                      className="rounded px-1 text-sm hover:bg-ember/10"
                      onClick={() => {
                        setPickerOpen(false);
                        onReact(comment.id, e);
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => onReply(comment)}
              className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-ember"
            >
              <Reply className="h-3 w-3" /> Balas
              {replies.length > 0 ? ` (${replies.length})` : ""}
            </button>
          </div>
        </div>
        {mine && !editing && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              className="text-muted-foreground hover:text-ember"
              onClick={() => {
                setDraft(comment.body);
                setEditing(true);
              }}
              aria-label="Edit komentar"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(comment.id)}
              aria-label="Hapus komentar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {children ? <div className="mt-1 space-y-1">{children}</div> : null}
    </div>
  );
}

function RenderCard({
  item,
  index,
  canDelete,
  currentUserId,
  onDelete,
  onPatch,
}: {
  item: GalleryItem;
  index: number;
  canDelete: boolean;
  currentUserId: string | null;
  onDelete: () => void;
  onPatch: (patch: Partial<GalleryItem>) => void;
}) {
  const likeFn = useServerFn(toggleLike);
  const commentFn = useServerFn(addComment);
  const delCommentFn = useServerFn(deleteComment);
  const editCommentFn = useServerFn(editComment);
  const reactFn = useServerFn(toggleCommentReaction);
  const seenFn = useServerFn(markRenderCommentsSeen);
  const [lightbox, setLightbox] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortMode>("baru");
  const [replyTo, setReplyTo] = useState<GalleryComment | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [lightbox]);

  const openLightbox = () => {
    setLightbox(true);
    if (item.new_comment_count > 0) {
      onPatch({ new_comment_count: 0 });
    }
    void seenFn({ data: { renderId: item.id } }).catch(() => {});
  };

  const like = async () => {
    const optimistic = !item.liked_by_me;
    onPatch({ liked_by_me: optimistic, like_count: item.like_count + (optimistic ? 1 : -1) });
    const r = await likeFn({ data: { renderId: item.id } });
    if (!r.ok) {
      onPatch({ liked_by_me: !optimistic, like_count: item.like_count });
      toast.error(r.error || "Gagal menyukai");
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const r = await commentFn({
      data: { renderId: item.id, body, parentId: replyTo?.id ?? null },
    });
    setBusy(false);
    if (r.ok && r.comment) {
      onPatch({ comments: [...item.comments, r.comment] });
      setText("");
      setReplyTo(null);
    } else {
      toast.error(r.error || "Gagal mengirim komentar");
    }
  };

  const removeComment = async (id: string) => {
    const r = await delCommentFn({ data: { id } });
    if (r.ok)
      onPatch({ comments: item.comments.filter((c) => c.id !== id && c.parent_id !== id) });
    else toast.error(r.error || "Gagal hapus komentar");
  };

  const updateComment = async (id: string, body: string) => {
    const r = await editCommentFn({ data: { id, body } });
    if (r.ok)
      onPatch({
        comments: item.comments.map((c) =>
          c.id === id ? { ...c, body: r.body ?? body, updated_at: r.updated_at ?? c.updated_at } : c,
        ),
      });
    else toast.error(r.error || "Gagal memperbarui komentar");
  };

  const react = async (id: string, emoji: string) => {
    const target = item.comments.find((c) => c.id === id);
    if (!target) return;
    const list = [...(target.reactions ?? [])];
    const idx = list.findIndex((r) => r.emoji === emoji);
    const wasMine = idx >= 0 ? list[idx].mine : false;
    if (idx >= 0) {
      const next = { ...list[idx], mine: !wasMine, count: list[idx].count + (wasMine ? -1 : 1) };
      if (next.count <= 0) list.splice(idx, 1);
      else list[idx] = next;
    } else {
      list.push({ emoji, count: 1, mine: true });
    }
    onPatch({
      comments: item.comments.map((c) => (c.id === id ? { ...c, reactions: list } : c)),
    });
    const r = await reactFn({ data: { commentId: id, emoji } });
    if (!r.ok) toast.error(r.error || "Gagal memberi reaksi");
  };

  const repliesOf = (id: string) =>
    item.comments
      .filter((c) => c.parent_id === id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const roots = item.comments.filter((c) => !c.parent_id);
  const sortedRoots = [...roots].sort((a, b) => {
    if (sort === "populer") return commentScore(b, repliesOf(b.id)) - commentScore(a, repliesOf(a.id));
    const da = new Date(a.created_at).getTime();
    const db = new Date(b.created_at).getTime();
    return sort === "baru" ? db - da : da - db;
  });

  const renderTree = (c: GalleryComment, depth: number): React.ReactNode => {
    const kids = repliesOf(c.id);
    return (
      <CommentRow
        key={c.id}
        comment={c}
        replies={kids}
        currentUserId={currentUserId}
        depth={depth}
        onReply={(target) => setReplyTo(target)}
        onEdit={updateComment}
        onDelete={removeComment}
        onReact={react}
      >
        {kids.map((k) => renderTree(k, depth + 1))}
      </CommentRow>
    );
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-surface/60 shadow-soft transition-all hover:border-ember/40"
    >
      <div
        className={`relative aspect-[4/3] overflow-hidden bg-background ${
          item.result_url && item.status === "completed" ? "cursor-zoom-in" : ""
        }`}
        onClick={() => {
          if (item.result_url && item.status === "completed") openLightbox();
        }}
        role={item.result_url && item.status === "completed" ? "button" : undefined}
        aria-label="Perbesar gambar"
      >
        {item.result_url && item.status === "completed" ? (
          <img
            src={item.result_url}
            alt={item.prompt}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {item.status === "failed" ? "Gagal" : "Belum selesai"}
          </div>
        )}
        {item.new_comment_count > 0 && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-ember px-2 py-0.5 text-[10px] font-semibold text-white shadow-soft">
            <MessageCircle className="h-3 w-3" />
            {item.new_comment_count} baru
          </span>
        )}
        <div
          className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {item.result_url && (
            <Button asChild size="icon" variant="secondary" className="h-8 w-8">
              <a href={item.result_url} target="_blank" rel="noreferrer" download>
                <Download className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          {canDelete && (
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8 hover:bg-destructive hover:text-destructive-foreground"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
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

        <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={like}
            className={item.liked_by_me ? "text-ember" : "text-muted-foreground"}
          >
            <Heart className={`mr-1.5 h-4 w-4 ${item.liked_by_me ? "fill-current" : ""}`} />
            {item.like_count}
          </Button>
          <Button size="sm" variant="ghost" className="relative text-muted-foreground" onClick={openLightbox}>
            <MessageCircle className="mr-1.5 h-4 w-4" />
            {item.comments.length}
            {item.new_comment_count > 0 && (
              <span className="ml-1.5 h-2 w-2 rounded-full bg-ember" aria-label="Komentar baru" />
            )}
          </Button>
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 sm:p-6"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Pratinjau gambar"
        >
          <Button
            size="icon"
            variant="secondary"
            className="absolute right-3 top-3 z-10 h-10 w-10 rounded-full"
            onClick={() => setLightbox(false)}
            aria-label="Tutup"
          >
            <X className="h-5 w-5" />
          </Button>

          <img
            src={item.result_url ?? ""}
            alt={item.prompt}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Panel komentar mengambang */}
          <div
            className="absolute bottom-3 left-3 right-3 flex max-h-[55vh] flex-col rounded-2xl border border-border/60 bg-surface/95 p-4 shadow-soft backdrop-blur sm:bottom-6 sm:left-auto sm:right-6 sm:top-6 sm:max-h-none sm:w-96"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={like}
                className={item.liked_by_me ? "text-ember" : "text-muted-foreground"}
              >
                <Heart className={`mr-1.5 h-4 w-4 ${item.liked_by_me ? "fill-current" : ""}`} />
                {item.like_count}
              </Button>
              <span className="flex items-center text-xs text-muted-foreground">
                <MessageCircle className="mr-1.5 h-4 w-4" />
                {item.comments.length} komentar
              </span>
              {item.result_url && (
                <Button asChild size="icon" variant="ghost" className="ml-auto h-8 w-8">
                  <a href={item.result_url} target="_blank" rel="noreferrer" download aria-label="Unduh gambar">
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>

            <div className="mb-2 flex items-center gap-1">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              {(["baru", "lama", "populer"] as SortMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setSort(m)}
                  className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors ${
                    sort === m ? "bg-ember/15 text-ember" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "baru" ? "Terbaru" : m === "lama" ? "Terlama" : "Populer"}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {roots.length === 0 && <p className="text-xs text-muted-foreground">Belum ada komentar.</p>}
              {sortedRoots.map((c) => renderTree(c, 0))}
            </div>

            {replyTo && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-ember/10 px-2 py-1 text-[11px] text-ember">
                <Reply className="h-3 w-3" />
                Membalas {replyTo.author_name}
                <button className="ml-auto" onClick={() => setReplyTo(null)} aria-label="Batal balas">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="mt-3 flex gap-2 border-t border-border/50 pt-3">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={replyTo ? `Balas ${replyTo.author_name}…` : "Tulis komentar…"}
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-ember/60"
              />
              <Button size="icon" className="h-9 w-9" disabled={busy} onClick={send} aria-label="Kirim komentar">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </motion.article>
  );
}

function OtherGalleries({ others, activeId }: { others: GalleryCard[]; activeId: string | null }) {
  if (others.length <= 1) return null;
  return (
    <section className="mt-14">
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-4 w-4 text-ember" />
        <h2 className="font-display text-xl font-semibold tracking-tight">Kunjungi galeri arsitek lain</h2>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {others.map((g) => (
          <Link
            key={g.id}
            to="/gallery"
            search={{ u: g.id }}
            className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
              g.id === activeId ? "border-ember/60 bg-ember/5" : "border-border/60 bg-surface/50 hover:border-ember/40"
            }`}
          >
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-background">
              {g.avatar_signed ? (
                <img src={g.avatar_signed} alt={g.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                  {g.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {g.name}
                {g.is_me ? " (Anda)" : ""}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {g.render_count} karya{g.qualifications ? ` · ${g.qualifications.split("\n")[0]}` : ""}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ============================ Bagan hierarki korporasi ============================ */

function HierarchyNodeCard({
  node,
  highlight,
  isCorp,
}: {
  node: { id: string; name: string; avatar_signed: string | null; level: string | null };
  highlight: boolean;
  isCorp?: boolean;
}) {
  return (
    <Link
      to="/gallery"
      search={{ u: node.id }}
      className={`flex min-w-[170px] items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        highlight
          ? "border-ember/70 bg-ember/10 shadow-primary"
          : "border-border/60 bg-surface/50 hover:border-ember/40"
      }`}
    >
      {node.avatar_signed ? (
        <img
          src={node.avatar_signed}
          alt={`Foto profil ${node.name}`}
          className="h-9 w-9 rounded-full object-cover"
        />
      ) : (
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-full ${
            isCorp ? "bg-ember/20 text-ember" : "bg-muted text-muted-foreground"
          }`}
        >
          {isCorp ? <Building2 className="h-4 w-4" /> : <Users className="h-4 w-4" />}
        </div>
      )}
      <div className="min-w-0">
        <p
          className={`truncate text-sm ${highlight ? "font-semibold text-ember" : "font-medium"}`}
        >
          {node.name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{node.level ?? "Arsitek"}</p>
      </div>
    </Link>
  );
}

const PERORANGAN_LEVELS = [
  "Mahasiswa",
  "Non Arsitek",
  "Pra Arsitek",
  "Arsitek Madya",
  "Arsitek Senior",
];
const KORPORASI_LEVELS = ["Akun Korporasi", "Arsitek Madya", "Arsitek Senior"];

function HierarchySection({
  hierarchy,
  owner,
  isOwner,
  onSaved,
}: {
  hierarchy: Hierarchy;
  owner: GalleryOwner;
  isOwner: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const setupFn = useServerFn(saveAccountSetup);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountType, setAccountType] = useState<"perorangan" | "korporasi">(
    (owner.account_type as "perorangan" | "korporasi") ?? "perorangan",
  );
  const [level, setLevel] = useState(owner.professional_level ?? "");
  const [code, setCode] = useState(owner.corporate_code ?? "");
  const [parentCode, setParentCode] = useState(owner.corporate_parent_code ?? "");
  const [name, setName] = useState(owner.display_name ?? "");

  useEffect(() => {
    setAccountType((owner.account_type as "perorangan" | "korporasi") ?? "perorangan");
    setLevel(owner.professional_level ?? "");
    setCode(owner.corporate_code ?? "");
    setParentCode(owner.corporate_parent_code ?? "");
    setName(owner.display_name ?? "");
  }, [owner]);

  const isCorpAccount = accountType === "korporasi" && level === "Akun Korporasi";
  const levels = accountType === "korporasi" ? KORPORASI_LEVELS : PERORANGAN_LEVELS;

  const save = async () => {
    if (accountType === "korporasi") {
      if (isCorpAccount && !code.trim()) {
        toast.error("Isi kode korporasi terlebih dahulu.");
        return;
      }
      if (!isCorpAccount && !parentCode.trim()) {
        toast.error("Isi kode korporasi induk yang ingin dihubungkan.");
        return;
      }
    }
    setBusy(true);
    const r = await setupFn({
      data: {
        account_type: accountType,
        professional_level: level.trim() || null,
        corporate_code: isCorpAccount ? code.trim() : null,
        corporate_parent_code: accountType === "korporasi" && !isCorpAccount ? parentCode.trim() : null,
        display_name: name.trim() || null,
      },
    });
    setBusy(false);
    if (r.ok) {
      toast.success("Hierarki & profil diperbarui");
      setEditing(false);
      await onSaved();
    } else {
      toast.error(r.error || "Gagal menyimpan");
    }
  };

  if (!hierarchy && !isOwner) return null;

  return (
    <section className="mt-8 rounded-2xl border border-border/60 bg-surface/40 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Network className="h-4 w-4 text-ember" />
        <h2 className="font-display text-lg font-semibold tracking-tight">Bagan Hierarki</h2>
        {hierarchy && (
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {hierarchy.code}
          </span>
        )}
        {isOwner && !editing && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit hierarki
          </Button>
        )}
      </div>

      {isOwner && editing && (
        <div className="mb-5 space-y-4 rounded-xl border border-border/60 bg-background/50 p-4">
          <p className="text-[11px] text-muted-foreground">
            Isian di bawah ini juga menentukan data profil akun Anda (nama, jenis akun, dan
            kualifikasi jenjang).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Nama tampilan</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama akun" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Jenis akun</Label>
              <div className="flex gap-2">
                {(["perorangan", "korporasi"] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant={accountType === t ? "default" : "outline"}
                    size="sm"
                    className={accountType === t ? "bg-gradient-primary hover:opacity-90" : ""}
                    onClick={() => {
                      setAccountType(t);
                      setLevel("");
                    }}
                  >
                    {t === "perorangan" ? "Perorangan" : "Korporasi"}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Jenjang / kualifikasi</Label>
            <div className="flex flex-wrap gap-2">
              {levels.map((l) => (
                <Button
                  key={l}
                  type="button"
                  size="sm"
                  variant={level === l ? "default" : "outline"}
                  className={level === l ? "bg-gradient-primary hover:opacity-90" : ""}
                  onClick={() => setLevel(l)}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>

          {accountType === "korporasi" && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                {isCorpAccount ? "Kode korporasi (milik Anda)" : "Kode korporasi induk"}
              </Label>
              <Input
                value={isCorpAccount ? code : parentCode}
                onChange={(e) =>
                  isCorpAccount ? setCode(e.target.value) : setParentCode(e.target.value)
                }
                placeholder="mis. DABIDABI-STUDIO"
              />
              <p className="text-[11px] text-muted-foreground">
                {isCorpAccount
                  ? "Arsitek yang mengetik kode ini akan otomatis terhubung di bawah bagan Anda."
                  : "Akun Anda akan muncul di bawah bagan akun korporasi dengan kode tersebut."}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={save} disabled={busy} className="bg-gradient-primary hover:opacity-90">
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Simpan hierarki
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              <X className="mr-2 h-4 w-4" /> Batal
            </Button>
          </div>
        </div>
      )}

      {hierarchy ? (
        <div className="flex flex-col items-center">
          {hierarchy.corporation ? (
            <HierarchyNodeCard
              node={hierarchy.corporation}
              highlight={hierarchy.corporation.id === owner.id}
              isCorp
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 px-4 py-2 text-xs text-muted-foreground">
              Akun korporasi «{hierarchy.code}» belum terdaftar
            </div>
          )}

          {hierarchy.members.length > 0 && (
            <>
              <div className="h-6 w-px bg-border" />
              <div className="h-px w-full max-w-3xl bg-border" />
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                {hierarchy.members.map((m) => (
                  <HierarchyNodeCard key={m.id} node={m} highlight={m.id === owner.id} />
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        !editing && (
          <p className="text-xs text-muted-foreground">
            Belum ada bagan hierarki. Pilih jenis akun korporasi dan isi kode korporasi melalui
            «Edit hierarki» untuk membentuk bagan.
          </p>
        )
      )}
    </section>
  );
}

/* ============================ Posting & Tender ============================ */

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Gagal membaca file"));
    fr.readAsDataURL(file);
  });
}

function PostComposer({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const uploadFn = useServerFn(uploadPostFile);
  const createFn = useServerFn(createPost);
  const [mode, setMode] = useState<"post" | "tender">("post");
  const [body, setBody] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [torPath, setTorPath] = useState<string | null>(null);
  const [torName, setTorName] = useState<string | null>(null);
  const [deadline, setDeadline] = useState("");
  const [dataLink, setDataLink] = useState("");
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [suggests, setSuggests] = useState<NominatimHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachables, setAttachables] = useState<AttachableSketch[]>([]);
  const [attached, setAttached] = useState<AttachableSketch | null>(null);
  const [attachPath, setAttachPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  // Sugesti alamat (Nominatim) — sama seperti pencarian lokasi di halaman sketsa.
  useEffect(() => {
    if (mode !== "tender") return;
    const q = address.trim();
    if (q.length < 3) {
      setSuggests([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await nominatimSearch(q, 6);
        if (alive) setSuggests(hits);
      } catch {
        if (alive) setSuggests([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 450);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [address, mode]);

  const pickImage = async (file: File) => {
    setBusy(true);
    const r = await uploadFn({ data: { dataUrl: await fileToDataUrl(file), kind: "image" } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Gagal unggah gambar");
    setImagePath(r.path);
    setImagePreview(r.url);
  };

  const pickPdf = async (file: File) => {
    setBusy(true);
    const r = await uploadFn({ data: { dataUrl: await fileToDataUrl(file), kind: "pdf" } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Gagal unggah PDF");
    setTorPath(r.path);
    setTorName(file.name);
  };

  const reset = () => {
    setBody("");
    setImagePath(null);
    setImagePreview(null);
    setTorPath(null);
    setTorName(null);
    setDeadline("");
    setDataLink("");
    setAddress("");
    setTitle("");
    setCoords(null);
    setSuggests([]);
    setAttached(null);
    setAttachPath(null);
    setAttachOpen(false);
  };

  const openAttach = () => {
    setAttachables(listAttachableSketches());
    setAttachOpen((v) => !v);
  };

  // Lampirkan sketsa: unggah snapshot lengkap (.dabidabi.json) lalu isi otomatis
  // alamat/koordinat proyek dari geo sketsa agar peta langsung muncul.
  const attachSketch = async (item: AttachableSketch) => {
    const text = buildAttachmentText(item.id, item.source);
    if (!text) return toast.error("Data sketsa tidak ditemukan di perangkat ini.");
    setBusy(true);
    const r = await uploadFn({ data: { dataUrl: attachmentDataUrl(text), kind: "sketch" } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Gagal melampirkan sketsa");
    setAttached(item);
    setAttachPath(r.path);
    setAttachOpen(false);
    if (!title.trim()) setTitle(item.title);
    if (item.lat != null && item.lon != null) {
      setCoords({ lat: item.lat, lon: item.lon });
      setAddress(
        item.label?.trim() || `${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}`,
      );
      setSuggests([]);
      toast.success("Sketsa dilampirkan — peta lokasi diambil dari koordinat sketsa");
    } else {
      toast.success("Sketsa dilampirkan (belum memuat koordinat)");
    }
  };

  const submit = async () => {
    setBusy(true);
    const r = await createFn({
      data: {
        kind: mode,
        body: body.trim() || null,
        image_url: imagePath,
        tender_title: mode === "tender" ? title.trim() || null : null,
        tender_deadline: mode === "tender" ? deadline || null : null,
        tor_url: mode === "tender" ? torPath : null,
        data_link: mode === "tender" ? dataLink.trim() || null : null,
        project_address: mode === "tender" ? address.trim() || null : null,
        project_lat: mode === "tender" ? (coords?.lat ?? null) : null,
        project_lon: mode === "tender" ? (coords?.lon ?? null) : null,
        sketch_url: mode === "tender" ? attachPath : null,
        sketch_title: mode === "tender" ? (attached?.title ?? null) : null,
        sketch_source: mode === "tender" ? (attached?.source ?? null) : null,
      },
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Gagal memposting");
    toast.success(mode === "tender" ? "Tender diposting ke forum feed" : "Postingan terkirim");
    reset();
    await onCreated();
  };

  return (
    <section className="mt-8 rounded-2xl border border-border/60 bg-surface/40 p-5">
      <div className="mb-4 flex gap-2">
        {(
          [
            { k: "post" as const, label: "Posting", icon: PenLine },
            { k: "tender" as const, label: "Tender", icon: Gavel },
          ]
        ).map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => setMode(k)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === k
                ? "border-ember/60 bg-ember/10 text-ember"
                : "border-border/60 text-muted-foreground hover:border-ember/40"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={
          mode === "tender"
            ? "Deskripsi tender: lingkup pekerjaan, syarat peserta, dll."
            : "Bagikan tulisan atau catatan proyek Anda…"
        }
        className="w-full resize-y rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-ember/60"
      />

      {imagePreview && (
        <div className="relative mt-3 w-fit">
          <img
            src={imagePreview}
            alt="Pratinjau gambar postingan"
            className="max-h-48 rounded-lg object-cover"
          />
          <Button
            size="icon"
            variant="secondary"
            className="absolute right-1 top-1 h-7 w-7"
            onClick={() => {
              setImagePath(null);
              setImagePreview(null);
            }}
            aria-label="Hapus gambar"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {mode === "tender" && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tender-title">Judul tender</Label>
            <Input
              id="tender-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sayembara Gedung Kesenian Kota…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deadline">Batas submit</Label>
            <Input
              id="deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="datalink">Link data</Label>
            <Input
              id="datalink"
              value={dataLink}
              onChange={(e) => setDataLink(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="relative space-y-1.5 sm:col-span-2">
            <Label htmlFor="addr">Alamat proyek (memunculkan peta &amp; koordinat)</Label>
            <Input
              id="addr"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setCoords(null);
              }}
              placeholder="Jl. Contoh No. 1, Jakarta"
              autoComplete="off"
            />
            {suggests.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border/60 bg-background shadow-lg">
                {suggests.map((h) => (
                  <li key={`${h.lat},${h.lon},${h.display_name}`}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-xs hover:bg-ember/10"
                      onClick={() => {
                        setAddress(h.display_name);
                        setCoords({ lat: Number(h.lat), lon: Number(h.lon) });
                        setSuggests([]);
                      }}
                    >
                      {h.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {searching
                ? "Mencari lokasi…"
                : coords
                  ? `Koordinat: ${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`
                  : "Pilih salah satu sugesti alamat untuk mengambil koordinat."}
            </p>
            {coords && (
              <div className="overflow-hidden rounded-lg border border-border/60">
                <iframe
                  title="Peta lokasi proyek tender"
                  loading="lazy"
                  className="h-48 w-full"
                  src={`https://maps.google.com/maps?q=${coords.lat},${coords.lon}&z=16&output=embed`}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickImage(f);
            e.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" onClick={() => imgRef.current?.click()} disabled={busy}>
          <ImageIcon className="mr-2 h-3.5 w-3.5" />
          Gambar
        </Button>

        {mode === "tender" && (
          <>
            <input
              ref={pdfRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickPdf(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => pdfRef.current?.click()}
              disabled={busy}
            >
              <FileText className="mr-2 h-3.5 w-3.5" />
              {torName ? "TOR/KAK terunggah" : "TOR/KAK (PDF)"}
            </Button>
          </>
        )}

        {mode === "tender" && (
          <Button variant="outline" size="sm" onClick={openAttach} disabled={busy}>
            <Paperclip className="mr-2 h-3.5 w-3.5" />
            {attached ? `Sketsa: ${attached.title}` : "Attach sketsa"}
          </Button>
        )}

        <Button
          size="sm"
          className="ml-auto bg-gradient-primary shadow-primary hover:opacity-90"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-2 h-3.5 w-3.5" />
          )}
          {mode === "tender" ? "Posting tender" : "Posting"}
        </Button>
      </div>

      {mode === "tender" && attachOpen && (
        <div className="mt-3 rounded-xl border border-border/60 bg-background/60 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Pilih sketsa dari halaman Sketsa atau Master Plan. Seluruh data (geometri, level,
            tabulasi, narasi, presentasi) dilampirkan sebagai salinan.
          </p>
          {attachables.length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada sketsa di akun ini.</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-auto">
              {attachables.map((a) => (
                <li key={`${a.source}-${a.id}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void attachSketch(a)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-ember/10"
                  >
                    <span className="rounded bg-ember/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ember">
                      {a.source === "masterplan" ? "Master Plan" : "Sketsa"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {a.lat != null && a.lon != null
                        ? `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`
                        : "tanpa koordinat"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === "tender" && attached && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5 text-ember" />
          Lampiran sketsa: <span className="font-medium text-foreground">{attached.title}</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => {
              setAttached(null);
              setAttachPath(null);
            }}
            aria-label="Hapus lampiran sketsa"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </section>
  );
}

function PostComments({
  post,
  currentUserId,
  onChange,
}: {
  post: PostItem;
  currentUserId: string | null;
  onChange: () => void | Promise<void>;
}) {
  const addFn = useServerFn(addPostComment);
  const delFn = useServerFn(deletePostComment);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const r = await addFn({ data: { postId: post.id, body: text.trim() } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Gagal mengirim komentar");
    setText("");
    await onChange();
  };

  return (
    <div className="space-y-3">
      {post.comments.map((c) => (
        <div key={c.id} className="flex items-start gap-2">
          {c.author_avatar ? (
            <img
              src={c.author_avatar}
              alt={`Foto profil ${c.author_name}`}
              className="h-7 w-7 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
              <Users className="h-3 w-3 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1 rounded-lg bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold">{c.author_name}</p>
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{c.body}</p>
          </div>
          {c.user_id === currentUserId && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={async () => {
                const r = await delFn({ data: { id: c.id } });
                if (r.ok) await onChange();
                else toast.error(r.error || "Gagal hapus");
              }}
              aria-label="Hapus komentar"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Tulis komentar…"
          className="h-9"
        />
        <Button size="icon" className="h-9 w-9" onClick={() => void send()} disabled={busy}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
