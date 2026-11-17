import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ClipboardPaste, Copy, FileText, GripHorizontal, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TabulasiNavigation } from "@/components/tabulasi-navigation";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadMaterialLibrary, loadRksPasals, MATERIAL_KINDS, saveMaterialLibrary, saveRksPasals, type LibraryMaterial, type MaterialKind, type RksPasalDef } from "@/lib/material-library";
import { normalizeRksDoc, rksDocOf, rksHasContent, rksPlainText, rksWordCount, type RksDoc } from "@/lib/rks-content";

const RksEditor = lazy(() => import("@/components/rks-editor"));
type RksClip = { pasalId: string | null; doc: RksDoc | null; text: string; from: string };

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
  const [rksId, setRksId] = useState<string | null>(null);
  const [pasals, setPasals] = useState<RksPasalDef[]>([]);
  const [newPasal, setNewPasal] = useState("");
  const [clip, setClip] = useState<RksClip | null>(null);
  const materialsRef = useRef(materials);
  const pasalsRef = useRef(pasals);
  useEffect(() => {
    const reload = () => {
      const nextMaterials = loadMaterialLibrary();
      const nextPasals = loadRksPasals();
      materialsRef.current = nextMaterials;
      pasalsRef.current = nextPasals;
      setMaterials(nextMaterials);
      setPasals(nextPasals);
    };
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
    materialsRef.current = next;
    setMaterials(next);
    void saveMaterialLibrary(next).catch(() => toast.error("Material gagal disimpan."));
  };
  const updatePasals = (next: RksPasalDef[]) => {
    pasalsRef.current = next;
    setPasals(next);
    void saveRksPasals(next).catch(() => toast.error("Pasal RKS gagal disimpan."));
  };
  const pasalOf = (m: LibraryMaterial) => (m.pasalId ? pasals.find((pasal) => pasal.id === m.pasalId) : undefined);
  const effectiveDoc = (m: LibraryMaterial) => {
    const pasal = pasalOf(m);
    return pasal ? rksDocOf(pasal) : rksDocOf(m);
  };
  const add = (kind: MaterialKind) => update([...materialsRef.current, {
    id: crypto.randomUUID(),
    kind,
    name: "",
    image: null,
    description: "",
    product: "",
    code: "",
    rks: "",
    rksDoc: null,
    pasalId: null,
  }]);
  const change = (id: string, fields: Partial<LibraryMaterial>) => update(materialsRef.current.map((m) => m.id === id ? { ...m, ...fields } : m));
  const changePasal = (id: string, fields: Partial<RksPasalDef>) => updatePasals(pasalsRef.current.map((p) => p.id === id ? { ...p, ...fields } : p));

  const addPasal = () => {
    const name = newPasal.trim();
    if (!name) return;
    updatePasals([...pasalsRef.current, { id: crypto.randomUUID(), name, rks: "", rksDoc: null }]);
    setNewPasal("");
  };
  const removePasal = (pasal: RksPasalDef) => {
    const members = materialsRef.current.filter((m) => m.pasalId === pasal.id);
    if (members.length && !window.confirm(`Hapus pasal "${pasal.name || "tanpa nama"}"? ${members.length} material akan kembali memakai narasi RKS sendiri.`)) return;
    const shared = rksDocOf(pasal);
    update(materialsRef.current.map((m) => m.pasalId !== pasal.id ? m : {
      ...m,
      pasalId: null,
      // Narasi bersama disalin ke material yang belum punya narasi sendiri agar tidak hilang.
      ...(!rksHasContent(rksDocOf(m)) && shared ? { rksDoc: shared, rks: pasal.rks || rksPlainText(shared) } : {}),
    }));
    updatePasals(pasalsRef.current.filter((p) => p.id !== pasal.id));
  };
  const assignPasal = (m: LibraryMaterial, pasalId: string | null) => {
    const current = materialsRef.current.find((item) => item.id === m.id) ?? m;
    if (pasalId) {
      const pasal = pasalsRef.current.find((p) => p.id === pasalId);
      const own = rksDocOf(current);
      // Pasal baru tanpa narasi mengambil narasi material ini sebagai awal.
      if (pasal && !rksHasContent(rksDocOf(pasal)) && own && rksHasContent(own)) changePasal(pasal.id, { rksDoc: own, rks: rksPlainText(own) });
      change(m.id, { pasalId });
    } else {
      const pasal = current.pasalId ? pasalsRef.current.find((p) => p.id === current.pasalId) : undefined;
      const shared = pasal ? rksDocOf(pasal) : null;
      change(m.id, { pasalId: null, ...(!rksHasContent(rksDocOf(current)) && shared ? { rksDoc: shared, rks: rksPlainText(shared) } : {}) });
    }
  };
  const editDoc = (m: LibraryMaterial, json: unknown) => {
    const doc = normalizeRksDoc(json);
    const text = rksPlainText(doc);
    const current = materialsRef.current.find((item) => item.id === m.id) ?? m;
    const pasal = current.pasalId ? pasalsRef.current.find((p) => p.id === current.pasalId) : undefined;
    if (pasal) changePasal(pasal.id, { rksDoc: doc, rks: text });
    else change(m.id, { rksDoc: doc, rks: text });
  };
  const copyRks = (m: LibraryMaterial) => {
    const doc = effectiveDoc(m);
    const text = rksPlainText(doc);
    setClip({ pasalId: pasalOf(m)?.id ?? null, doc, text, from: m.name || "material tanpa nama" });
    void navigator.clipboard?.writeText(text).catch(() => {});
    toast.success(`RKS ${m.name || "material"} disalin.`);
  };
  const pasteRks = (m: LibraryMaterial) => {
    if (!clip) return;
    const before = materialsRef.current.find((item) => item.id === m.id);
    if (!before) return;
    const previous = { pasalId: before.pasalId ?? null, rksDoc: before.rksDoc ?? null, rks: before.rks };
    const pasal = clip.pasalId ? pasalsRef.current.find((p) => p.id === clip.pasalId) : undefined;
    if (pasal) change(m.id, { pasalId: pasal.id });
    else change(m.id, { pasalId: null, rksDoc: clip.doc, rks: clip.text });
    toast.success(pasal ? `${m.name || "Material"} kini memakai pasal "${pasal.name}".` : `RKS dari ${clip.from} ditempel ke ${m.name || "material"}.`, {
      action: { label: "Urungkan", onClick: () => change(m.id, previous) },
    });
  };
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
      <section aria-labelledby="pasal-rks-title" className="mb-5 rounded-md border border-border bg-surface/40 p-3">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="pasal-rks-title" className="text-sm font-semibold">Pasal RKS</h3>
          <p className="text-xs text-muted-foreground">Material dengan pasal yang sama memakai satu narasi RKS dan ditulis sekali di dokumen RKS.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pasals.map((pasal) => {
            const count = materials.filter((m) => m.pasalId === pasal.id).length;
            return (
              <div key={pasal.id} className="flex items-center gap-1 rounded-md border border-border bg-background pl-1">
                <Input aria-label="Nama pasal" value={pasal.name} onChange={(event) => changePasal(pasal.id, { name: event.target.value })} className="h-8 w-52 border-0 px-2 text-sm shadow-none focus-visible:ring-1" />
                <span className="whitespace-nowrap text-[11px] text-muted-foreground" title="Jumlah material dalam pasal ini">{count} material</span>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title={`Hapus pasal ${pasal.name}`} onClick={() => removePasal(pasal)}><Trash2 /></Button>
              </div>
            );
          })}
          <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); addPasal(); }}>
            <Input aria-label="Nama pasal baru" placeholder="Nama pasal baru, contoh Pekerjaan Cat" value={newPasal} onChange={(event) => setNewPasal(event.target.value)} className="h-8 w-64 text-sm" />
            <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!newPasal.trim()}><Plus />Tambah pasal</Button>
          </form>
        </div>
      </section>
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
                      {(() => {
                        const pasal = pasalOf(m);
                        const words = rksWordCount(pasal ? pasal.rks || rksPlainText(rksDocOf(pasal)) : m.rks);
                        return (
                          <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <Button type="button" size="sm" variant={rksId === m.id ? "default" : "outline"} className="min-w-0 flex-1 justify-start" title={pasal ? `Rencana Kerja dan Syarat-syarat · Pasal ${pasal.name}` : "Rencana Kerja dan Syarat-syarat"} onClick={() => setRksId(rksId === m.id ? null : m.id)}>
                              <FileText />RKS
                              {words > 0 && <span className="ml-auto shrink-0 text-xs font-normal opacity-70">{words} kata</span>}
                            </Button>
                            <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" title={`Salin RKS ${m.name || "material"}`} aria-label={`Salin RKS ${m.name || "material"}`} disabled={words === 0} onClick={() => copyRks(m)}><Copy /></Button>
                            <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" title={clip ? `Tempel RKS dari ${clip.from}` : "Salin RKS material lain terlebih dahulu"} aria-label={`Tempel RKS ke ${m.name || "material"}`} disabled={!clip} onClick={() => pasteRks(m)}><ClipboardPaste /></Button>
                          </div>
                          {pasal && <p className="truncate text-[11px] text-muted-foreground" title={`Pasal ${pasal.name}`}>Pasal: {pasal.name || "tanpa nama"}</p>}
                          </div>
                        );
                      })()}
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" title={`Hapus ${m.name || "material"}`} onClick={() => update(materialsRef.current.filter((item) => item.id !== m.id))}><Trash2 /></Button>
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
      {(() => {
        const target = materials.find((m) => m.id === rksId);
        if (!target) return null;
        const pasal = pasalOf(target);
        const members = pasal ? materials.filter((m) => m.pasalId === pasal.id) : [];
        return (
          <RksNote
            key={target.id}
            material={target}
            pasal={pasal ?? null}
            pasals={pasals}
            members={members}
            doc={effectiveDoc(target)}
            onPasal={(pasalId) => assignPasal(target, pasalId)}
            onChange={(json) => editDoc(target, json)}
            onClose={() => setRksId(null)}
          />
        );
      })()}
      <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void handleUpload(file); }} />
    </main>
  );
}
function RksNote({ material, pasal, pasals, members, doc, onPasal, onChange, onClose }: {
  material: LibraryMaterial;
  pasal: RksPasalDef | null;
  pasals: RksPasalDef[];
  members: LibraryMaterial[];
  doc: RksDoc | null;
  onPasal: (pasalId: string | null) => void;
  onChange: (json: unknown) => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const width = Math.min(820, window.innerWidth - 32);
    setPos({ x: Math.max(16, (window.innerWidth - width) / 2), y: Math.max(16, window.innerHeight * 0.1) });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target as HTMLElement | null)?.closest?.("[role=listbox]")) closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const text = rksPlainText(doc);
  const words = rksWordCount(text);
  const others = members.filter((m) => m.id !== material.id);
  // Isi penyunting dimuat ulang saat sumber narasi (material sendiri / pasal) berganti.
  const sourceKey = pasal ? `pasal:${pasal.id}` : `material:${material.id}`;
  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={`RKS ${material.name || material.kind}`}
      className="fixed z-50 flex w-[min(820px,calc(100vw-2rem))] flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl"
      style={pos ? { left: pos.x, top: pos.y } : { visibility: "hidden" }}
    >
      <div
        className="flex cursor-move touch-none select-none items-center gap-2 border-b border-border px-3 py-2"
        onPointerDown={(event) => {
          // Menu pilihan pasal dirender di portal, tetapi event-nya tetap menggelembung ke sini.
          if (!event.currentTarget.contains(event.target as Node) || (event.target as HTMLElement).closest("button, [role=combobox], input") || !pos) return;
          drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const box = boxRef.current;
          const w = box?.offsetWidth ?? 0;
          const h = box?.offsetHeight ?? 0;
          setPos({
            x: Math.min(Math.max(0, event.clientX - drag.current.dx), Math.max(0, window.innerWidth - w)),
            y: Math.min(Math.max(0, event.clientY - drag.current.dy), Math.max(0, window.innerHeight - Math.min(h, 80))),
          });
        }}
        onPointerUp={() => { drag.current = null; }}
      >
        <GripHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">RKS · Rencana Kerja dan Syarat-syarat</p>
          <p className="truncate text-sm font-semibold">
            {material.code && <span className="mr-2 font-mono text-primary">{material.code}</span>}
            {material.name || "Material tanpa nama"} <span className="font-normal capitalize text-muted-foreground">· {material.kind}</span>
          </p>
        </div>
        <Select value={pasal?.id ?? "__own"} onValueChange={(value) => onPasal(value === "__own" ? null : value)}>
          <SelectTrigger aria-label="Pasal RKS" className="h-8 w-56 shrink-0 text-xs">
            <SelectValue placeholder="Pilih pasal" />
          </SelectTrigger>
          <SelectContent className="z-[60]">
            <SelectItem value="__own">Tanpa pasal (narasi sendiri)</SelectItem>
            {pasals.length > 0 && <SelectSeparator />}
            {pasals.map((item) => <SelectItem key={item.id} value={item.id}>Pasal: {item.name || "Tanpa nama"}</SelectItem>)}
            {pasals.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Tambahkan nama pasal di bagian Pasal RKS.</div>}
          </SelectContent>
        </Select>
        <Button type="button" variant="ghost" size="icon" title="Tutup" onClick={onClose}><X /></Button>
      </div>
      {pasal && (
        <p className="border-b border-border bg-accent/40 px-3 py-1.5 text-xs text-accent-foreground">
          Narasi pasal <b>{pasal.name || "tanpa nama"}</b>{others.length ? <> dipakai bersama {others.map((m) => m.name || "material tanpa nama").join(", ")}</> : " belum dipakai material lain"}. Perubahan di sini berlaku untuk semua material dalam pasal ini.
        </p>
      )}
      <Suspense fallback={<div className="flex h-[min(60vh,520px)] items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
        <RksEditor
          key={sourceKey}
          initial={doc}
          ariaLabel={`Narasi RKS ${material.name || material.kind}`}
          placeholder="Tulis narasi RKS: lingkup pekerjaan, persyaratan bahan, cara pelaksanaan, toleransi, pengujian, dan pemeliharaan..."
          onChange={onChange}
        />
      </Suspense>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>Tersimpan otomatis · P = nomor pasal, tersusun otomatis di dokumen RKS</span>
        <span>{words} kata · {text.length} karakter</span>
      </div>
    </div>
  );
}
