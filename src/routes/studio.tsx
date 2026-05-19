import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Download, Loader2, Building2, Sofa, Moon, Brush } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { ImageDropzone } from "@/components/image-dropzone";
import { ApiKeyPanel } from "@/components/api-key-panel";
import { useAuth } from "@/lib/auth";
import { getApiKey, buildImagenPrompt } from "@/lib/api-key";
import { generateImagen } from "@/lib/imagen.functions";
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

function StudioPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [sketch, setSketch] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [renderType, setRenderType] = useState<RenderType>("exterior");
  const [accuracy, setAccuracy] = useState(8);
  const [consistency, setConsistency] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  const handleGenerate = async () => {
    const apiKey = getApiKey();
    if (!apiKey) return toast.error("Masukkan Google API Key terlebih dahulu.");
    if (!sketch) return toast.error("Upload sketsa terlebih dahulu");
    if (!prompt.trim()) return toast.error("Tulis prompt deskripsi");
    setGenerating(true);
    setResult(null);
    try {
      const finalPrompt = buildImagenPrompt({
        renderType,
        accuracy,
        consistency,
        userPrompt: prompt.trim(),
        hasReference: !!reference,
      });

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImages?key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          numberOfImages: 1,
          aspectRatio: "1:1",
          outputMimeType: "image/jpeg",
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        let msg = `Google API error (${resp.status})`;
        if (resp.status === 400) msg = "Request ditolak. Cek API Key & akses Imagen 3.";
        if (resp.status === 401 || resp.status === 403) msg = "API Key tidak valid atau tidak punya akses Imagen 3.";
        if (resp.status === 404) msg = "Model tidak ditemukan. Pastikan akses Imagen 3 aktif.";
        if (resp.status === 429) msg = "Quota habis / rate limit. Coba lagi nanti.";
        throw new Error(`${msg} — ${errText.slice(0, 240)}`);
      }

      const json = await resp.json();
      const imgB64: string | undefined = json?.generatedImages?.[0]?.image?.imageBytes;
      if (!imgB64) throw new Error("API tidak mengembalikan gambar.");

      setResult(`data:image/jpeg;base64,${imgB64}`);
      toast.success("Render selesai!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setGenerating(false);
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
          <ApiKeyPanel onChange={setHasKey} />
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

          <Button
            onClick={handleGenerate}
            disabled={generating || !sketch || !prompt.trim() || !hasKey}
            size="lg"
            className="w-full bg-gradient-ember text-base shadow-ember hover:opacity-90"
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Merender... (~20–40 detik)
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
