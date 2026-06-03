import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ImageDropzone } from "@/components/image-dropzone";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/narasi")({
  head: () => ({
    meta: [
      { title: "Narasi — Dabidabi's" },
      {
        name: "description",
        content:
          "Tulis narasi konsep tiap sketsa dengan tabel gagasan utama dan unggah gambar pendukung. Tersinkron otomatis ke slide Presentasi.",
      },
    ],
  }),
  component: NarasiPage,
});

// ---------- Types ----------
type NarasiItem = { id: string; text: string; images: (string | null)[] };
type NarasiStore = Record<string, NarasiItem[]>;

type PerspektifItem = { id: string; title: string; image: string | null };
type PerspektifStore = Record<string, PerspektifItem[]>;

type SketchLite = { id: string; title: string };
type SketchStoreShape = { sketches: SketchLite[]; openId: string | null };

const NARASI_KEY = "dabidabis_narasi_v1";
const PERSPEKTIF_KEY = "dabidabis_perspektif_v1";
const SKETCH_KEY = "dabidabis_sketch_v2";

function newNarasi(): NarasiItem {
  return {
    id: `N${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text: "",
    images: [null, null, null, null],
  };
}

function newPerspektif(): PerspektifItem {
  return {
    id: `P${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: "",
    image: null,
  };
}

function loadNarasiStore(): NarasiStore {
  try {
    const raw = localStorage.getItem(NARASI_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const out: NarasiStore = {};
    for (const k of Object.keys(v)) {
      const arr = (v as any)[k];
      if (!Array.isArray(arr)) continue;
      out[k] = arr.map((n: any) => ({
        id: String(n?.id ?? `${k}_${Math.random().toString(36).slice(2, 7)}`),
        text: typeof n?.text === "string" ? n.text : "",
        images: Array.isArray(n?.images)
          ? [0, 1, 2, 3].map((i) => (typeof n.images[i] === "string" ? n.images[i] : null))
          : [null, null, null, null],
      }));
      if (out[k].length === 0) out[k] = [newNarasi()];
    }
    return out;
  } catch {
    return {};
  }
}

function saveNarasiStore(s: NarasiStore) {
  try {
    localStorage.setItem(NARASI_KEY, JSON.stringify(s));
  } catch {
    toast.error("Gagal menyimpan: ukuran data melebihi kuota browser.");
  }
}

function loadPerspektifStore(): PerspektifStore {
  try {
    const raw = localStorage.getItem(PERSPEKTIF_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const out: PerspektifStore = {};
    for (const k of Object.keys(v)) {
      const arr = (v as any)[k];
      if (!Array.isArray(arr)) continue;
      out[k] = arr.map((p: any) => ({
        id: String(p?.id ?? `${k}_${Math.random().toString(36).slice(2, 7)}`),
        title: typeof p?.title === "string" ? p.title : "",
        image: typeof p?.image === "string" ? p.image : null,
      }));
    }
    return out;
  } catch {
    return {};
  }
}

function savePerspektifStore(s: PerspektifStore) {
  try {
    localStorage.setItem(PERSPEKTIF_KEY, JSON.stringify(s));
  } catch {
    toast.error("Gagal menyimpan perspektif: ukuran data melebihi kuota browser.");
  }
}

function NarasiPage() {
  const [sketches, setSketches] = useState<SketchLite[]>([]);
  const [store, setStore] = useState<NarasiStore>({});
  const [perspektifStore, setPerspektifStore] = useState<PerspektifStore>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastSketchOpenRef = useRef<string | null>(null);

  const loadSketches = useCallback(() => {
    try {
      const raw = localStorage.getItem(SKETCH_KEY);
      if (!raw) { setSketches([]); return; }
      const s = JSON.parse(raw) as SketchStoreShape;
      if (s && Array.isArray(s.sketches)) {
        const lite = s.sketches.map((x) => ({ id: String(x.id), title: String(x.title ?? "Sketsa") }));
        setSketches(lite);
        if (s.openId && s.openId !== lastSketchOpenRef.current) {
          lastSketchOpenRef.current = s.openId;
          if (lite.some((x) => x.id === s.openId)) {
            setOpenId(s.openId);
          }
        }
        setOpenId((prev) => {
          if (prev && lite.some((x) => x.id === prev)) return prev;
          return s.openId ?? lite[0]?.id ?? null;
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setStore(loadNarasiStore());
    setPerspektifStore(loadPerspektifStore());
    loadSketches();
    setLoaded(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SKETCH_KEY) loadSketches();
      if (e.key === NARASI_KEY) setStore(loadNarasiStore());
      if (e.key === PERSPEKTIF_KEY) setPerspektifStore(loadPerspektifStore());
    };
    const onVis = () => { if (document.visibilityState === "visible") loadSketches(); };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", loadSketches);
    const iv = window.setInterval(loadSketches, 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", loadSketches);
      window.clearInterval(iv);
    };
  }, [loadSketches]);

  useEffect(() => {
    if (!loaded) return;
    const h = setTimeout(() => saveNarasiStore(store), 300);
    return () => clearTimeout(h);
  }, [store, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const h = setTimeout(() => savePerspektifStore(perspektifStore), 300);
    return () => clearTimeout(h);
  }, [perspektifStore, loaded]);

  const getList = useCallback(
    (sketchId: string): NarasiItem[] => {
      const arr = store[sketchId];
      if (arr && arr.length > 0) return arr;
      return [newNarasi()];
    },
    [store],
  );

  const setList = useCallback((sketchId: string, list: NarasiItem[]) => {
    setStore((prev) => ({ ...prev, [sketchId]: list }));
  }, []);

  const getPerspektif = useCallback(
    (sketchId: string): PerspektifItem[] => perspektifStore[sketchId] ?? [],
    [perspektifStore],
  );

  const setPerspektif = useCallback((sketchId: string, list: PerspektifItem[]) => {
    setPerspektifStore((prev) => ({ ...prev, [sketchId]: list }));
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Narasi</h1>
        <p className="text-sm text-muted-foreground">
          Tulis gagasan utama tiap sketsa, unggah gambar pendukung, dan tambahkan perspektif. Tersinkron otomatis ke slide Presentasi.
        </p>
      </div>

      {loaded && sketches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/40 p-10 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Belum ada sketsa. Buat sketsa di halaman Sketsa terlebih dahulu.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sketches.map((sk) => (
            <NarasiBox
              key={sk.id}
              sketch={sk}
              open={openId === sk.id}
              onToggle={() => setOpenId((p) => (p === sk.id ? null : sk.id))}
              list={getList(sk.id)}
              setList={(l) => setList(sk.id, l)}
              perspektifList={getPerspektif(sk.id)}
              setPerspektifList={(l) => setPerspektif(sk.id, l)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NarasiBox({
  sketch, open, onToggle, list, setList, perspektifList, setPerspektifList,
}: {
  sketch: SketchLite;
  open: boolean;
  onToggle: () => void;
  list: NarasiItem[];
  setList: (l: NarasiItem[]) => void;
  perspektifList: PerspektifItem[];
  setPerspektifList: (l: PerspektifItem[]) => void;
}) {
  const update = (id: string, patch: Partial<NarasiItem>) => {
    setList(list.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  };
  const remove = (id: string) => {
    if (list.length <= 1) {
      setList([newNarasi()]);
      return;
    }
    setList(list.filter((n) => n.id !== id));
  };
  const add = () => setList([...list, newNarasi()]);

  const updateP = (id: string, patch: Partial<PerspektifItem>) => {
    setPerspektifList(perspektifList.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const removeP = (id: string) => setPerspektifList(perspektifList.filter((p) => p.id !== id));
  const addP = () => setPerspektifList([...perspektifList, newPerspektif()]);

  const perspektifCount = perspektifList.filter((p) => p.image).length;

  return (
    <div className={cn("rounded-xl border border-border bg-surface/40", open && "shadow-ember/20 shadow-lg")}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{sketch.title}</div>
          <div className="text-xs text-muted-foreground">
            {list.length} narasi · {list.reduce((s, n) => s + n.images.filter(Boolean).length, 0)} gambar · {perspektifCount} perspektif
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border/60 px-4 py-5">
          <Tabs defaultValue="narasi" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="narasi">Narasi</TabsTrigger>
              <TabsTrigger value="perspektif">Perspektif</TabsTrigger>
            </TabsList>

            <TabsContent value="narasi" className="space-y-6">
              {list.map((n, i) => (
                <NarasiEditor
                  key={n.id}
                  index={i}
                  item={n}
                  onChange={(patch) => update(n.id, patch)}
                  onRemove={() => remove(n.id)}
                  canRemove={list.length > 1}
                />
              ))}
              <div>
                <Button onClick={add} size="sm" className="bg-gradient-ember shadow-ember hover:opacity-90">
                  <Plus className="mr-1 h-4 w-4" /> Tambah Narasi
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="perspektif" className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Setiap perspektif yang diunggah akan otomatis menjadi slide tersendiri (A3 full screen) di halaman Presentasi.
              </p>
              {perspektifList.length === 0 && (
                <div className="rounded-lg border border-dashed border-border/60 bg-background/40 p-6 text-center text-sm text-muted-foreground">
                  Belum ada perspektif. Klik tombol di bawah untuk menambahkan.
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {perspektifList.map((p, i) => (
                  <PerspektifEditor
                    key={p.id}
                    index={i}
                    item={p}
                    onChange={(patch) => updateP(p.id, patch)}
                    onRemove={() => removeP(p.id)}
                  />
                ))}
              </div>
              <div>
                <Button onClick={addP} size="sm" className="bg-gradient-ember shadow-ember hover:opacity-90">
                  <Plus className="mr-1 h-4 w-4" /> Tambah Perspektif
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function NarasiEditor({
  index, item, onChange, onRemove, canRemove,
}: {
  index: number;
  item: NarasiItem;
  onChange: (patch: Partial<NarasiItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const setImage = (slot: number, value: string | null) => {
    const next = item.images.slice();
    next[slot] = value;
    onChange({ images: next });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Narasi {index + 1}
        </div>
        {canRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      <textarea
        value={item.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Tulis gagasan utama narasi di sini…"
        rows={6}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((slot) => (
          <ImageDropzone
            key={slot}
            value={item.images[slot]}
            label={`Gambar ${slot + 1}`}
            hint="Maksimal 8MB"
            compress
            onChange={(value) => setImage(slot, value)}
          />
        ))}
      </div>
    </div>
  );
}

function PerspektifEditor({
  index, item, onChange, onRemove,
}: {
  index: number;
  item: PerspektifItem;
  onChange: (patch: Partial<PerspektifItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Perspektif {index + 1}
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <ImageDropzone
        value={item.image}
        label="Gambar perspektif"
        hint="Maksimal 8MB · akan menjadi slide A3"
        compress
        onChange={(value) => onChange({ image: value })}
      />
      <input
        type="text"
        value={item.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Judul perspektif (mis. View Mata Burung)"
        className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  );
}
