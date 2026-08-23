import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, BookMarked, Copy, Trash2, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  loadPromptLibrary,
  removePromptFromLibrary,
  renamePromptInLibrary,
  type PromptLibraryEntry,
} from "@/lib/prompt-library";

export const Route = createFileRoute("/studio/pustaka-prompt")({
  head: () => ({
    meta: [
      { title: "Pustaka Prompt — Dabidabi's" },
      {
        name: "description",
        content:
          "Koleksi prompt dan gaya arsitektur tersimpan beserta satu contoh hasil render per prompt, siap dimuat kembali ke node Prompt & Style di Studio.",
      },
      { property: "og:title", content: "Pustaka Prompt — Dabidabi's" },
      {
        property: "og:description",
        content: "Simpan, tinjau, dan muat ulang prompt render AI favorit Anda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PustakaPromptPage,
});

function PustakaPromptPage() {
  const [items, setItems] = useState<PromptLibraryEntry[]>([]);

  useEffect(() => {
    setItems(loadPromptLibrary());
  }, []);

  const copy = (text: string) => {
    if (!text.trim()) return toast.error("Teks kosong");
    try {
      navigator.clipboard.writeText(text);
      toast.success("Disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Pustaka Prompt
          </h1>
          <p className="text-sm text-muted-foreground">
            {items.length} prompt tersimpan dari node Prompt &amp; Style.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/studio">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Kembali ke Studio
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-surface/60 p-10 text-center">
          <BookMarked className="mx-auto mb-3 h-8 w-8 text-ember" />
          <h2 className="font-display text-lg font-semibold">Belum ada prompt</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Buka Studio, lalu tekan <span className="font-medium">Save Prompt</span> pada node
            Prompt &amp; Style untuk menyimpan prompt beserta satu contoh hasil output.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((e) => (
            <article
              key={e.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-surface/60"
            >
              <div className="relative aspect-[4/3] w-full bg-muted/40">
                {e.sampleImage ? (
                  <img
                    src={e.sampleImage}
                    alt={`Contoh output ${e.name}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                    <ImageOff className="h-5 w-5" />
                    <span className="text-[11px]">Tanpa contoh output</span>
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">
                  #{e.no}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-3">
                <Input
                  value={e.name}
                  onChange={(ev) => {
                    const name = ev.target.value;
                    setItems((prev) =>
                      prev.map((x) => (x.id === e.id ? { ...x, name } : x)),
                    );
                    renamePromptInLibrary(e.id, name);
                  }}
                  className="h-8 text-sm font-medium"
                />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Gaya arsitektur
                  </p>
                  <p className="whitespace-pre-wrap text-xs">{e.style || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Detail tambahan
                  </p>
                  <p className="whitespace-pre-wrap text-xs">{e.detail || "—"}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Konsistensi geometri {e.geometryConsistency}% ·{" "}
                  {new Date(e.createdAt).toLocaleString("id-ID")}
                </p>
                <div className="mt-auto flex gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-[11px]"
                    onClick={() => copy([e.style, e.detail].filter(Boolean).join(". "))}
                  >
                    <Copy className="mr-1 h-3 w-3" /> Salin
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] text-red-500 hover:text-red-500"
                    onClick={() => {
                      removePromptFromLibrary(e.id);
                      setItems((prev) => prev.filter((x) => x.id !== e.id));
                      toast.success("Prompt dihapus");
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
