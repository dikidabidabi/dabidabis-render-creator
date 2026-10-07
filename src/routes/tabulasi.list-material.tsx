import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TabulasiNavigation } from "@/components/tabulasi-navigation";
import { loadMaterialLibrary, MATERIAL_KINDS, saveMaterialLibrary, type LibraryMaterial, type MaterialKind } from "@/lib/material-library";

export const Route = createFileRoute("/tabulasi/list-material")({
  head: () => ({ meta: [
    { title: "List Material — Dabidabi's" },
    { name: "description", content: "Pustaka material pekerjaan dasar, lantai, dinding, plafon, dan fasad untuk proyek Dabidabi's." },
    { property: "og:title", content: "List Material — Dabidabi's" },
    { property: "og:description", content: "Kelola seluruh acuan material dan kode spesifikasi untuk setiap proyek." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: MaterialLibraryPage,
});

async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) throw new Error("Pilih gambar berukuran maksimal 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    let maxSize = 900;
    let output = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Gambar tidak dapat diproses.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      output = canvas.toDataURL("image/jpeg", 0.78 - attempt * 0.06);
      if (output.length < 850 * 1024) break;
      maxSize *= 0.8;
    }
    return output;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function MaterialLibraryPage() {
  const [materials, setMaterials] = useState<LibraryMaterial[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollPos, setScrollPos] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);
  useEffect(() => {
    const reload = () => setMaterials(loadMaterialLibrary());
    reload();
    window.addEventListener("storage", reload);
    return () => window.removeEventListener("storage", reload);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setMaxScroll(Math.max(0, el.scrollWidth - el.clientWidth));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const update = (next: LibraryMaterial[]) => {
    setMaterials(next);
    void saveMaterialLibrary(next).catch(() => toast.error("Material gagal disimpan."));
  };
  const add = (kind: MaterialKind) => update([...materials, {
    id: crypto.randomUUID(),
    kind,
    name: "",
    image: null,
    description: "",
    product: "",
    code: "",
  }]);
  const change = (id: string, fields: Partial<LibraryMaterial>) => update(materials.map((m) => m.id === id ? { ...m, ...fields } : m));
  const handleUpload = async (file: File) => {
    if (!uploadId) return;
    try {
      const image = await compressImage(file);
      change(uploadId, { image });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gambar gagal diunggah.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Tabulasi</h1>
      <p className="mb-6 text-sm text-muted-foreground">Acuan material untuk seluruh proyek dalam akun ini.</p>
      <TabulasiNavigation active="list-material" />
      <h2 className="mb-4 text-lg font-semibold">List Material</h2>
      <div className="overflow-hidden">
        <div ref={scrollRef} onScroll={(event) => setScrollPos(event.currentTarget.scrollLeft)} className="flex gap-5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MATERIAL_KINDS.map((kind) => (
          <section key={kind} className="w-80 min-w-0 shrink-0">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-sm font-semibold capitalize">{kind}</h3>
              <Button size="sm" variant="outline" onClick={() => add(kind)}><Plus />Tambah material</Button>
            </div>
            <div className="space-y-2">
              {materials.filter((m) => m.kind === kind).map((m) => (
                <div key={m.id} className="rounded-md border border-border bg-surface/40 p-2">
                  <div className="flex items-start gap-2">
                    <Button type="button" variant="outline" size="icon" className="h-14 w-14 shrink-0 overflow-hidden p-0" title={`Unggah gambar ${m.name || kind}`} onClick={() => { setUploadId(m.id); uploadRef.current?.click(); }}>
                      {m.image ? <img src={m.image} alt={m.name || "Material"} className="h-full w-full object-cover" /> : <ImagePlus className="text-muted-foreground" />}
                    </Button>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input aria-label={`Nama material ${kind}`} placeholder="Nama material" value={m.name} onChange={(event) => change(m.id, { name: event.target.value })} className="min-w-0 text-sm" />
                      <Input aria-label={`Kode material ${m.name || kind}`} placeholder="Kode material, contoh MR" value={m.code} onChange={(event) => change(m.id, { code: event.target.value.toUpperCase().replace(/\s+/g, "") })} className="min-w-0 font-mono text-sm uppercase" />
                      <Textarea aria-label={`Deskripsi material ${m.name || kind}`} placeholder="Deskripsi" value={m.description} onChange={(event) => change(m.id, { description: event.target.value })} className="min-h-20 resize-y text-sm" />
                      <Textarea aria-label={`Produk material ${m.name || kind}`} placeholder="Produk" value={m.product} onChange={(event) => change(m.id, { product: event.target.value })} className="min-h-16 resize-y text-sm" />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" title={`Hapus ${m.name || "material"}`} onClick={() => update(materials.filter((item) => item.id !== m.id))}><Trash2 /></Button>
                  </div>
                </div>
              ))}
              {!materials.some((m) => m.kind === kind) && <p className="py-5 text-center text-xs text-muted-foreground">Belum ada material.</p>}
            </div>
          </section>
        ))}
        </div>
        {maxScroll > 0 && (
          <input
            type="range"
            aria-label="Geser daftar material"
            min={0}
            max={maxScroll}
            value={Math.min(scrollPos, maxScroll)}
            onChange={(event) => {
              const value = Number(event.target.value);
              setScrollPos(value);
              if (scrollRef.current) scrollRef.current.scrollLeft = value;
            }}
            className="mt-3 w-full accent-primary"
          />
        )}
      </div>
      <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void handleUpload(file); }} />
    </main>
  );
}