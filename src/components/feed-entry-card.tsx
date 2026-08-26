import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  CalendarClock,
  ExternalLink,
  FileText,
  Heart,
  Loader2,
  MapPin,
  MessageCircle,
  Paperclip,
  Play,
  Repeat2,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { setPendingTenderExec } from "@/lib/tender-exec";
import type { FeedEntry } from "@/lib/social.functions";


export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

function MapEmbed({
  address,
  lat,
  lon,
}: {
  address: string;
  lat?: number | null;
  lon?: number | null;
}) {
  // Koordinat (mis. dari lampiran sketsa) lebih presisi daripada teks alamat.
  const q =
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
      ? `${Number(lat)},${Number(lon)}`
      : encodeURIComponent(address);
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <iframe
        title={`Peta lokasi ${address}`}
        loading="lazy"
        className="h-56 w-full"
        src={`https://maps.google.com/maps?q=${q}&z=16&output=embed`}
      />
    </div>
  );
}

export function FeedEntryCard({
  item,
  index = 0,
  canDelete = false,
  busyRepost = false,
  onLike,
  onRepost,
  onDelete,
  onComment,
  children,
}: {
  item: FeedEntry;
  index?: number;
  canDelete?: boolean;
  busyRepost?: boolean;
  onLike: () => void;
  onRepost: () => void;
  onDelete?: () => void;
  onComment?: () => void;
  children?: React.ReactNode;
}) {
  const [showComments, setShowComments] = useState(false);
  const [showExec, setShowExec] = useState(false);
  const navigate = useNavigate();
  const isTender = item.kind === "tender";
  const hasCoords =
    Number.isFinite(Number(item.project_lat)) && Number.isFinite(Number(item.project_lon));

  const execute = (target: "sketch" | "masterplan") => {
    if (!hasCoords) {
      toast.error("Tender ini belum punya koordinat alamat proyek.");
      return;
    }
    setPendingTenderExec({
      target,
      title: (item.tender_title || item.body || "Tender").slice(0, 80),
      lat: Number(item.project_lat),
      lon: Number(item.project_lon),
      label: item.project_address ?? "",
      sketchUrl: item.sketch_url ?? null,
      sketchTitle: item.sketch_title ?? null,
    });
    setShowExec(false);
    toast.success(
      item.sketch_url
        ? "Sketsa tender disalin ke akun Anda"
        : target === "masterplan"
          ? "Peta dikirim ke Master Plan"
          : "Peta dikirim ke Sketsa",
    );
    void navigate({ to: target === "masterplan" ? "/masterplan" : "/sketch" });
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
      className={`overflow-hidden rounded-xl border bg-surface/40 ${
        isTender ? "border-ember/50" : "border-border/60"
      }`}
    >
      <div className="flex items-center gap-3 p-4">
        <Link to="/gallery" search={{ u: item.user_id }} className="shrink-0">
          {item.author_avatar ? (
            <img
              src={item.author_avatar}
              alt={`Foto profil ${item.author_name}`}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ember/15 text-ember">
              <Users className="h-4 w-4" />
            </div>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            to="/gallery"
            search={{ u: item.user_id }}
            className="block truncate text-sm font-semibold hover:text-ember"
          >
            {item.author_name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {item.author_qualifications ? `${item.author_qualifications} · ` : ""}
            {timeAgo(item.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {isTender && (
            <span className="rounded-md bg-ember/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ember">
              Tender
            </span>
          )}
          {canDelete && onDelete && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label="Hapus postingan"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {item.image_url && (
        <img
          src={item.image_url}
          alt={item.body.slice(0, 120) || "Gambar postingan"}
          loading="lazy"
          className="w-full bg-black/5 object-cover"
        />
      )}

      <div className="space-y-3 p-4">
        {isTender && item.tender_title && (
          <h3 className="font-display text-base font-semibold tracking-tight">
            {item.tender_title}
          </h3>
        )}
        {item.body && <p className="whitespace-pre-wrap text-sm text-foreground/85">{item.body}</p>}

        {item.repost && (
          <div className="rounded-lg border border-border/60 bg-background/50 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Repeat2 className="h-3.5 w-3.5" /> Repost dari{" "}
              <Link
                to="/gallery"
                search={{ u: item.repost.author_id }}
                className="font-medium hover:text-ember"
              >
                {item.repost.author_name}
              </Link>
            </p>
            {item.repost.image_url && (
              <img
                src={item.repost.image_url}
                alt="Postingan asli"
                loading="lazy"
                className="mb-2 w-full rounded-md object-cover"
              />
            )}
            {item.repost.body && (
              <p className="line-clamp-3 text-xs text-muted-foreground">{item.repost.body}</p>
            )}
          </div>
        )}

        {isTender && (
          <div className="space-y-2 rounded-lg border border-ember/30 bg-ember/5 p-3 text-xs">
            {item.tender_deadline && (
              <p className="flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5 text-ember" />
                Batas submit:{" "}
                <span className="font-medium">
                  {new Date(item.tender_deadline).toLocaleDateString("id-ID", { dateStyle: "long" })}
                </span>
              </p>
            )}
            {item.tor_url && (
              <a
                href={item.tor_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-ember hover:underline"
              >
                <FileText className="h-3.5 w-3.5" /> Unduh TOR/KAK (PDF)
              </a>
            )}
            {item.data_link && (
              <a
                href={item.data_link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 break-all text-ember hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" /> {item.data_link}
              </a>
            )}
            {item.project_address && (
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ember" />
                {item.project_address}
                {hasCoords && (
                  <span className="ml-1 shrink-0 text-muted-foreground">
                    ({Number(item.project_lat).toFixed(5)}, {Number(item.project_lon).toFixed(5)})
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {isTender && item.sketch_title && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-ember" />
            Lampiran sketsa:{" "}
            <span className="font-medium text-foreground">{item.sketch_title}</span>
            <span className="text-muted-foreground">
              ({item.sketch_source === "masterplan" ? "Master Plan" : "Sketsa"})
            </span>
          </p>
        )}

        {isTender && (item.project_address || hasCoords) && (
          <MapEmbed
            address={item.project_address ?? ""}
            lat={item.project_lat}
            lon={item.project_lon}
          />
        )}

        {isTender && hasCoords && (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowExec((v) => !v)}
              className="border-ember/50 text-ember hover:bg-ember/10"
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Eksekusi
            </Button>
            {showExec && (
              <div className="flex flex-wrap gap-2 rounded-lg border border-ember/30 bg-ember/5 p-3">
                <p className="w-full text-xs text-muted-foreground">
                  {item.sketch_url
                    ? "Salin sketsa & koordinat tender ini ke:"
                    : "Kirim peta & koordinat tender ini ke:"}
                </p>
                <Button size="sm" variant="secondary" onClick={() => execute("masterplan")}>
                  Halaman Master Plan
                </Button>
                <Button size="sm" variant="secondary" onClick={() => execute("sketch")}>
                  Halaman Sketsa
                </Button>
              </div>
            )}
          </div>
        )}


        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLike}
            className={item.liked_by_me ? "text-ember" : "text-muted-foreground"}
          >
            <Heart className={`mr-1.5 h-4 w-4 ${item.liked_by_me ? "fill-current" : ""}`} />
            {item.like_count}
          </Button>

          {children || onComment ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setShowComments((v) => !v);
                onComment?.();
              }}
            >
              <MessageCircle className="mr-1.5 h-4 w-4" />
              {item.comment_count}
            </Button>
          ) : (
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link to="/gallery" search={{ u: item.user_id }}>
                <MessageCircle className="mr-1.5 h-4 w-4" />
                {item.comment_count}
              </Link>
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={busyRepost}
            onClick={onRepost}
          >
            {busyRepost ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Repeat2 className="mr-1.5 h-4 w-4" />
            )}
            Repost
          </Button>
        </div>

        {showComments && children}
      </div>
    </motion.article>
  );
}
