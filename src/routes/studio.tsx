import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Download, Loader2, Building2, Sofa, Moon, Brush, Dice5, Lock, Unlock, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ImageDropzone } from "@/components/image-dropzone";
import { useAuth } from "@/lib/auth";
import { generateRender, finalizeRender } from "@/lib/render.functions";
import { processRenderInBrowser } from "@/lib/client-canvas-pipeline";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/studio")({
  component: StudioPage,
});

const RENDER_TYPES = [
  { id: "exterior", label: "Eksterior", icon: Building2, desc: "Foto realistis siang" },
  { id: "interior", label: "Interior", icon: Sofa, desc: "Furniture & material" },
  { id: "night", label: "Night Shot", icon: Moon, desc: "Dramatis malam" },
  { id: "watercolor", label: "Watercolor", icon: Brush, desc: "Cat air artistik" },
] as const;

type RenderType = (typeof RENDER_TYPES)[number]["id"];

const RESOLUTIONS = [
  { id: "1k", label: "1K", desc: "1024px · cepat" },
  { id: "2k", label: "2K", desc: "2048px · tajam" },
  { id: "4k", label: "4K", desc: "3840px · maksimal" },
  { id: "8k", label: "8K", desc: "7680px · ultra" },
] as const;

type Resolution = (typeof RESOLUTIONS)[number]["id"];

function StudioPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const generateFn = useServerFn(generateRender);
  const finalizeFn = useServerFn(finalizeRender);

  const [sketch, setSketch] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [renderType, setRenderType] = useState<RenderType>("exterior");
  const [accuracy, setAccuracy] = useState(8);
  const [resolution, setResolution] = useState<Resolution>("1k");
  const [consistency, setConsistency] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [result, setResult] = useState<string | null>(null);
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 1_000_000));
  const [seedLocked, setSeedLocked] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  const handleGenerate = async () => {
    if (!sketch) return toast.error("Upload sketsa terlebih dahulu");
    if (!prompt.trim()) return toast.error("Tulis prompt deskripsi");
    if (!user) return toast.error("Sesi login tidak ditemukan");
    const useSeed = seedLocked
      ? seed
      : (() => {
          const next = Math.floor(Math.random() * 1_000_000);
          setSeed(next);
          return next;
        })();
    setGenerating(true);
    setResult(null);
    setProgressMsg("Tahap 1: render AI...");
    try {
      const res = await generateFn({
        data: {
          sketchBase64: sketch,
          referenceBase64: reference,
          prompt: prompt.trim(),
          renderType,
          accuracy,
          consistency,
          seed: useSeed,
          resolution,
        },
      });
      if (!res.ok) {
        toast.error(res.error || "Gagal render");
        return;
      }

      // Tahap 2-5 berjalan di browser via Canvas API (tanpa AI/API luar).
      const processed = await processRenderInBrowser(
        res.baseDataUrl,
        resolution,
        (m) => setProgressMsg(m),
      );

      setProgressMsg("Mengunggah hasil...");
      const path = `${user.id}/${res.id}.${processed.ext}`;
      const { error: upErr } = await supabase.storage
        .from("renders")
        .upload(path, processed.blob, {
          contentType: processed.mime,
          upsert: true,
        });
      if (upErr) {
        toast.error("Upload gagal: " + upErr.message);
        return;
      }

      const fin = await finalizeFn({ data: { id: res.id, ext: processed.ext } });
      if (!fin.ok) {
        toast.error(fin.error || "Gagal finalize");
        return;
      }
      setResult(fin.resultUrl);
      toast.success(`Render selesai (${resolution.toUpperCase()})! Seed: ${useSeed}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setGenerating(false);
      setProgressMsg("");
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Render Studio
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload sketsa, pilih gaya, dan biarkan AI mengubahnya menjadi visualisasi profesional.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Controls */}
        <div className="space-y-6 rounded-2xl border border-border/60 bg-surface/60 p-5 shadow-soft backdrop-blur sm:p-6">
          <div className="grid grid-cols-2 gap-4">
            <ImageDropzone
              label="Sketsa *"
              hint="JPG/PNG, maks 8MB"
              value={sketch}
              onChange={setSketch}
            />
            <ImageDropzone
              label="Referensi gaya"
              hint="Opsional"
              value={reference}
              onChange={setReference}
            />
          </div>

          <div className="space-y-3">
            <Label>Tipe render</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RENDER_TYPES.map((t) => {
                const Icon = t.icon;
                const active = renderType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setRenderType(t.id)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all",
                      active
                        ? "border-ember bg-ember/10 shadow-soft"
                        : "border-border/60 bg-surface/40 hover:border-border",
                    )}
                  >
                    <Icon className={cn("h-4 w-4", active ? "text-ember" : "text-muted-foreground")} />
                    <span className="text-sm font-medium leading-tight">{t.label}</span>
                    <span className="text-[10px] text-muted-foreground">{t.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt deskripsi</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Contoh: Rumah modern minimalis 2 lantai dengan fasad batu alam, jendela kaca lebar, taman tropis di depan, suasana sore hari..."
              rows={4}
              className="resize-none"
            />
          </div>

          <div className="space-y-5">
            <SliderControl
              label="Akurasi sketsa"
              hint="Seberapa ketat AI mengikuti garis sketsa"
              value={accuracy}
              onChange={setAccuracy}
            />
            <SliderControl
              label="Konsistensi referensi"
              hint={reference ? "Kekuatan mengikuti gaya referensi" : "Aktifkan dengan upload referensi"}
              value={consistency}
              onChange={setConsistency}
              disabled={!reference}
            />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Maximize2 className="h-3.5 w-3.5 text-ember" />
              Resolusi output
            </Label>
            <div className="grid grid-cols-4 gap-2">
              {RESOLUTIONS.map((r) => {
                const active = resolution === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setResolution(r.id)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-lg border p-2.5 transition-all",
                      active
                        ? "border-ember bg-ember/10 shadow-soft"
                        : "border-border/60 bg-surface/40 hover:border-border",
                    )}
                  >
                    <span
                      className={cn(
                        "font-display text-base font-semibold",
                        active ? "text-ember" : "text-foreground",
                      )}
                    >
                      {r.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{r.desc}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {resolution === "1k"
              ? "Tahap 1 saja: render AI utuh (paling cepat, tanpa post-process)."
              : "5 tahap: 1) render AI utuh → 2) upscale 2–10× (menyesuaikan target 2K/4K/8K) → 3) pecah 16 tile (overlap 1%) → 4) tiap tile dipertajam AI dengan prompt & parameter IDENTIK (anti-variasi) → 5) gabung mulus dengan blending di overlap."}
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border/60 bg-surface/40 p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="seed" className="flex items-center gap-1.5 text-sm">
                {seedLocked ? (
                  <Lock className="h-3.5 w-3.5 text-ember" />
                ) : (
                  <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                Seed variasi
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {seedLocked ? "Terkunci" : "Acak setiap render"}
                </span>
                <Switch checked={seedLocked} onCheckedChange={setSeedLocked} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="seed"
                type="number"
                min={0}
                max={2147483647}
                value={seed}
                onChange={(e) => setSeed(Math.max(0, parseInt(e.target.value || "0", 10) || 0))}
                disabled={!seedLocked}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}
                title="Acak seed"
              >
                <Dice5 className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Kunci seed untuk variasi konsisten — ubah prompt/slider dengan seed yang sama untuk
              tweak halus pada komposisi yang sama.
            </p>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generating || !sketch || !prompt.trim()}
            size="lg"
            className="w-full bg-gradient-ember text-base shadow-ember hover:opacity-90"
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Merender + AI sharpening 16 tile seragam... (~30–90 detik)
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Render dengan AI
              </>
            )}
          </Button>
        </div>

        {/* Result */}
        <div className="rounded-2xl border border-border/60 bg-surface/60 p-5 shadow-soft backdrop-blur sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <Label>Hasil render</Label>
            {result && (
              <Button asChild variant="ghost" size="sm">
                <a href={result} target="_blank" rel="noreferrer" download>
                  <Download className="mr-1.5 h-4 w-4" />
                  Download
                </a>
              </Button>
            )}
          </div>

          <div className="relative aspect-square overflow-hidden rounded-xl border border-border/60 bg-background sm:aspect-[4/3]">
            <AnimatePresence mode="wait">
              {generating ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4"
                >
                  <div className="absolute inset-0 animate-shimmer" />
                  <Sparkles className="relative h-10 w-10 text-ember" />
                  <p className="relative text-sm text-muted-foreground">
                    AI sedang menyusun render Anda...
                  </p>
                </motion.div>
              ) : result ? (
                <motion.img
                  key="result"
                  src={result}
                  alt="Hasil render"
                  initial={{ opacity: 0, scale: 1.02 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="h-full w-full object-contain"
                />
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground"
                >
                  <Sparkles className="h-8 w-8 opacity-40" />
                  <p className="text-sm">Hasil render akan muncul di sini</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {result && (
            <p className="mt-3 text-xs text-muted-foreground">
              Tersimpan otomatis di galeri Anda.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function SliderControl({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("space-y-2", disabled && "opacity-50")}>
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="font-display text-sm font-semibold text-ember">{value}/10</span>
      </div>
      <Slider
        min={1}
        max={10}
        step={1}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
