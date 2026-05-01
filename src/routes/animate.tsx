import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion as fmotion, AnimatePresence } from "framer-motion";
import {
  Film,
  Download,
  Loader2,
  Sparkles,
  ZoomIn,
  ZoomOut,
  MoveHorizontal,
  MoveVertical,
  Move,
  RotateCw,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImageDropzone } from "@/components/image-dropzone";
import { useAuth } from "@/lib/auth";
import { generateDepthLayers } from "@/lib/animate.functions";
import {
  loadImage,
  renderAnimation,
  motionLabels,
  fileExtFromMime,
  type MotionPreset,
} from "@/lib/animate-render";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/animate")({
  component: AnimatePage,
});

const MOTIONS: { id: MotionPreset; icon: typeof ZoomIn; label: string }[] = [
  { id: "zoom-in", icon: ZoomIn, label: "Zoom In" },
  { id: "zoom-out", icon: ZoomOut, label: "Zoom Out" },
  { id: "pan-lr", icon: MoveHorizontal, label: "Pan →" },
  { id: "pan-rl", icon: MoveHorizontal, label: "Pan ←" },
  { id: "pan-tb", icon: MoveVertical, label: "Pan ↓" },
  { id: "pan-bt", icon: MoveVertical, label: "Pan ↑" },
  { id: "diagonal", icon: Move, label: "Diagonal" },
  { id: "orbit", icon: RotateCw, label: "Orbit" },
];

const DURATIONS = [3, 5, 8] as const;
const RESOLUTIONS = [
  { id: "1080p" as const, label: "1080p", desc: "Full HD · cepat" },
  { id: "2k" as const, label: "2K", desc: "2048px · sinematik" },
];

const METHODS = [
  {
    id: "kenburns" as const,
    label: "Ken Burns",
    desc: "Cepat & gratis · pan/zoom halus",
    icon: Film,
  },
  {
    id: "ai" as const,
    label: "AI Parallax 3D",
    desc: "Foreground+background terpisah · sudut bangunan berubah",
    icon: Wand2,
  },
];

function AnimatePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const aiKeyframeFn = useServerFn(generateCinematicKeyframe);

  const [image, setImage] = useState<string | null>(null);
  const [method, setMethod] = useState<"kenburns" | "ai">("kenburns");
  const [motion, setMotion] = useState<MotionPreset>("zoom-in");
  const [duration, setDuration] = useState<3 | 5 | 8>(5);
  const [resolution, setResolution] = useState<"1080p" | "2k">("1080p");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string>("");
  const [result, setResult] = useState<{ url: string; mime: string } | null>(null);
  const previewRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Cleanup blob URLs
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async () => {
    if (!image) return toast.error("Upload gambar terlebih dahulu");
    setGenerating(true);
    setProgress(0);
    setResult(null);

    try {
      setStage("Memuat gambar...");
      const startImg = await loadImage(image);

      let endImg: HTMLImageElement | null = null;
      if (method === "ai") {
        setStage("AI menyusun keyframe sinematik...");
        const res = await aiKeyframeFn({ data: { imageBase64: image, motion } });
        if (!res.ok) {
          toast.warning(`AI keyframe gagal — fallback ke Ken Burns. (${res.error})`);
        } else {
          try {
            endImg = await loadImage(res.imageBase64);
          } catch {
            toast.warning("Gagal memuat AI keyframe — fallback ke Ken Burns.");
            endImg = null;
          }
        }
      }

      setStage("Merender animasi...");
      const out = await renderAnimation({
        startImage: startImg,
        endImage: endImg,
        motion,
        durationSec: duration,
        resolution,
        fps: 30,
        onProgress: (p) => setProgress(p),
      });

      if (result) URL.revokeObjectURL(result.url);
      setResult({ url: out.url, mime: out.mimeType });
      toast.success(`Animasi siap! (${out.width}×${out.height} · ${fileExtFromMime(out.mimeType).toUpperCase()})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal merender animasi");
    } finally {
      setGenerating(false);
      setStage("");
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const ext = result ? fileExtFromMime(result.mime) : "mp4";

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Image to Animation
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ubah gambar/render menjadi video pendek dengan gerakan kamera sinematik — pan, zoom, atau parallax.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Controls */}
        <div className="space-y-6 rounded-2xl border border-border/60 bg-surface/60 p-5 shadow-soft backdrop-blur sm:p-6">
          <ImageDropzone
            label="Gambar sumber *"
            hint="JPG/PNG, maks 8MB · idealnya hasil render Studio"
            value={image}
            onChange={(v) => {
              setImage(v);
              setResult(null);
            }}
          />

          <div className="space-y-3">
            <Label>Metode</Label>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = method === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all",
                      active
                        ? "border-ember bg-ember/10 shadow-soft"
                        : "border-border/60 bg-surface/40 hover:border-border",
                    )}
                  >
                    <Icon className={cn("h-4 w-4", active ? "text-ember" : "text-muted-foreground")} />
                    <span className="text-sm font-medium leading-tight">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground">{m.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Gerakan kamera</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MOTIONS.map((m) => {
                const Icon = m.icon;
                const active = motion === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMotion(m.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-all",
                      active
                        ? "border-ember bg-ember/10 shadow-soft"
                        : "border-border/60 bg-surface/40 hover:border-border",
                    )}
                    title={motionLabels[m.id]}
                  >
                    <Icon className={cn("h-4 w-4", active ? "text-ember" : "text-muted-foreground")} />
                    <span className="text-[11px] font-medium leading-tight">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Durasi</Label>
              <div className="grid grid-cols-3 gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={cn(
                      "rounded-lg border p-2 text-sm font-medium transition-all",
                      duration === d
                        ? "border-ember bg-ember/10 text-ember shadow-soft"
                        : "border-border/60 bg-surface/40 hover:border-border",
                    )}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Resolusi</Label>
              <div className="grid grid-cols-2 gap-2">
                {RESOLUTIONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setResolution(r.id)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-lg border p-2 transition-all",
                      resolution === r.id
                        ? "border-ember bg-ember/10 shadow-soft"
                        : "border-border/60 bg-surface/40 hover:border-border",
                    )}
                  >
                    <span
                      className={cn(
                        "font-display text-sm font-semibold",
                        resolution === r.id ? "text-ember" : "text-foreground",
                      )}
                    >
                      {r.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {method === "ai"
              ? "AI Cinematic membuat keyframe akhir lalu di-blend untuk efek parallax (~10–25 detik tambahan)."
              : "Ken Burns merender langsung di browser — cepat & tanpa kredit AI."}
          </p>

          <Button
            onClick={handleGenerate}
            disabled={generating || !image}
            size="lg"
            className="w-full bg-gradient-ember text-base shadow-ember hover:opacity-90"
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {stage || "Memproses..."} {progress > 0 && progress < 1 ? `${Math.round(progress * 100)}%` : ""}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Buat Animasi
              </>
            )}
          </Button>
        </div>

        {/* Result */}
        <div className="rounded-2xl border border-border/60 bg-surface/60 p-5 shadow-soft backdrop-blur sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <Label>Hasil animasi</Label>
            {result && (
              <Button asChild variant="ghost" size="sm">
                <a href={result.url} download={`dabidabis-animation.${ext}`}>
                  <Download className="mr-1.5 h-4 w-4" />
                  Download .{ext}
                </a>
              </Button>
            )}
          </div>

          <div className="relative aspect-video overflow-hidden rounded-xl border border-border/60 bg-background">
            <AnimatePresence mode="wait">
              {generating ? (
                <fmotion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                >
                  <Film className="h-10 w-10 animate-pulse text-ember" />
                  <p className="text-sm text-muted-foreground">{stage}</p>
                  {progress > 0 && (
                    <div className="h-1.5 w-48 overflow-hidden rounded-full bg-border/60">
                      <div
                        className="h-full bg-gradient-ember transition-all"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                  )}
                </fmotion.div>
              ) : result ? (
                <fmotion.video
                  key="result"
                  src={result.url}
                  controls
                  autoPlay
                  loop
                  playsInline
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full w-full object-contain"
                />
              ) : image ? (
                <fmotion.img
                  key="preview"
                  ref={previewRef}
                  src={image}
                  alt="Preview"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full w-full object-contain opacity-70"
                />
              ) : (
                <fmotion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground"
                >
                  <Film className="h-8 w-8 opacity-40" />
                  <p className="text-sm">Animasi akan tampil di sini</p>
                </fmotion.div>
              )}
            </AnimatePresence>
          </div>

          {result && (
            <p className="mt-3 text-xs text-muted-foreground">
              Video tersimpan sementara di browser. Klik download untuk menyimpan.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
