import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabulasiNavigation } from "@/components/tabulasi-navigation";
import { loadMaterialLibrary, MATERIAL_KINDS, saveMaterialLibrary, type LibraryMaterial, type MaterialKind } from "@/lib/material-library";

export const Route = createFileRoute("/tabulasi/list-material")({
  head: () => ({ meta: [
    { title: "List Material — Dabidabi's" },
    { name: "description", content: "Pustaka material lantai, dinding, dan plafon untuk proyek arsitektur Dabidabi's." },
    { property: "og:title", content: "List Material — Dabidabi's" },
    { property: "og:description", content: "Kelola acuan material lantai, dinding, dan plafon untuk setiap proyek." },
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
  useEffect(() => {
    const reload = () => setMaterials(loadMaterialLibrary());
    reload();
    window.addEventListener("storage", reload);
    return () => window.removeEventListener("storage", reload);
  }, []);

  const update = (next: LibraryMaterial[]) => {
    setMaterials(next);
    void saveMaterialLibrary(next).catch(() => toast.error("Material gagal disimpan."));
  };
  const add = (kind: MaterialKind) => update([...materials, { id: crypto.randomUUID(), kind, name: "", image: null }]);
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
      <div className="grid gap-5 md:grid-cols-3">
        {MATERIAL_KINDS.map((kind) => (
          <section key={kind} className="min-w-0">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-sm font-semibold capitalize">{kind}</h3>
              <Button size="sm" variant="outline" onClick={() => add(kind)}><Plus />Tambah material</Button>
            </div>
            <div className="space-y-2">
              {materials.filter((m) => m.kind === kind).map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-md border border-border bg-surface/40 p-2">
                  <Button type="button" variant="outline" size="icon" className="h-14 w-14 shrink-0 overflow-hidden p-0" title={`Unggah gambar ${m.name || kind}`} onClick={() => { setUploadId(m.id); uploadRef.current?.click(); }}>
                    {m.image ? <img src={m.image} alt={m.name || "Material"} className="h-full w-full object-cover" /> : <ImagePlus className="text-muted-foreground" />}
                  </Button>
                  <Input aria-label={`Nama material ${kind}`} placeholder="Nama material" value={m.name} onChange={(event) => change(m.id, { name: event.target.value })} className="min-w-0 text-sm" />
                  <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" title={`Hapus ${m.name || "material"}`} onClick={() => update(materials.filter((item) => item.id !== m.id))}><Trash2 /></Button>
                </div>
              ))}
              {!materials.some((m) => m.kind === kind) && <p className="py-5 text-center text-xs text-muted-foreground">Belum ada material.</p>}
            </div>
          </section>
        ))}
      </div>
      <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void handleUpload(file); }} />
    </main>
  );
}