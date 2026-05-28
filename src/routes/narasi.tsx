import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
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

type SketchLite = { id: string; title: string };
type SketchStoreShape = { sketches: SketchLite[]; openId: string | null };

const NARASI_KEY = "dabidabis_narasi_v1";
const SKETCH_KEY = "dabidabis_sketch_v2";

function newNarasi(): NarasiItem {
  return {
    id: `N${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text: "",
    images: [null, null, null, null],
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
  } catch (e) {
    toast.error("Gagal menyimpan: ukuran data melebihi kuota browser.");
  }
}

function NarasiPage() {
  const [sketches, setSketches] = useState<SketchLite[]>([]);
  const [store, setStore] = useState<NarasiStore>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastSketchOpenRef = useRef<string | null>(null);

  // Load sketches + auto-sync open sketch id with sketch page
  const loadSketches = useCallback(() => {
    try {
      const raw = localStorage.getItem(SKETCH_KEY);
      if (!raw) { setSketches([]); return; }
      const s = JSON.parse(raw) as SketchStoreShape;
      if (s && Array.isArray(s.sketches)) {
        const lite = s.sketches.map((x) => ({ id: String(x.id), title: String(x.title ?? "Sketsa") }));
        setSketches(lite);
        // Auto-open the sketch that's open on the sketch page, whenever it changes.
        if (s.openId && s.openId !== lastSketchOpenRef.current) {
          lastSketchOpenRef.current = s.openId;
          if (lite.some((x) => x.id === s.openId)) {
            setOpenId(s.openId);
          }
        }
        // First load fallback
        setOpenId((prev) => {
          if (prev && lite.some((x) => x.id === prev)) return prev;
          return s.openId ?? lite[0]?.id ?? null;
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setStore(loadNarasiStore());
    loadSketches();
    setLoaded(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SKETCH_KEY) loadSketches();
      if (e.key === NARASI_KEY) setStore(loadNarasiStore());
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

  // Save store (debounced)
  useEffect(() => {
    if (!loaded) return;
    const h = setTimeout(() => saveNarasiStore(store), 300);
    return () => clearTimeout(h);
  }, [store, loaded]);

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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Narasi</h1>
        <p className="text-sm text-muted-foreground">
          Tulis gagasan utama tiap sketsa dan unggah gambar pendukung. Tersinkron otomatis ke slide Konsep di Presentasi.
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NarasiBox({
  sketch, open, onToggle, list, setList,
}: {
  sketch: SketchLite;
  open: boolean;
  onToggle: () => void;
  list: NarasiItem[];
  setList: (l: NarasiItem[]) => void;
}) {
  const update = (id: string, patch: Partial<NarasiItem>) => {
    setList(list.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  };
  const remove = (id: string) => {
    if (list.length <= 1) {
      // Keep at least one narasi (so default slide stays)
      setList([newNarasi()]);
      return;
    }
    setList(list.filter((n) => n.id !== id));
  };
  const add = () => setList([...list, newNarasi()]);

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
            {list.length} narasi · {list.reduce((s, n) => s + n.images.filter(Boolean).length, 0)} gambar
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-6 border-t border-border/60 px-4 py-5">
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
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const setImage = async (slot: number, file: File | null) => {
    if (!file) {
      const next = item.images.slice();
      next[slot] = null;
      onChange({ images: next });
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Berkas bukan gambar.");
      return;
    }
    setBusy((b) => ({ ...b, [slot]: true }));
    try {
      const url = await fileToCompressedDataUrl(file);
      const next = item.images.slice();
      next[slot] = url;
      onChange({ images: next });
      toast.success(`Gambar ${slot + 1} diunggah`);
    } catch (err) {
      console.error("[narasi] setImage gagal", err);
      toast.error(`Gagal memuat gambar: ${(err as Error)?.message ?? "unknown"}`);
    } finally {
      setBusy((b) => ({ ...b, [slot]: false }));
    }
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
          <ImageSlot
            key={slot}
            value={item.images[slot]}
            busy={!!busy[slot]}
            onChange={(f) => setImage(slot, f)}
            label={`Gambar ${slot + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

function ImageSlot({
  value, busy, onChange, label,
}: { value: string | null; busy: boolean; onChange: (f: File | null) => void; label: string }) {
  return (
    <div className="relative">
      {value ? (
        <div className="group relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-black/40">
          <img src={value} alt={label} className="h-full w-full object-cover" />
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">
              Mengunggah…
            </div>
          )}
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={busy}
            className="absolute right-1 top-1 z-10 rounded-full bg-black/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Hapus gambar"
          >
            <X className="h-3 w-3" />
          </button>
          <label
            className="absolute inset-0 cursor-pointer"
            aria-label={`Ganti ${label}`}
          >
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                if (f) onChange(f);
              }}
            />
          </label>
        </div>
      ) : (
        <label
          className={cn(
            "flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background/60 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:bg-background hover:text-foreground",
            busy && "pointer-events-none opacity-70",
          )}
        >
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (f) onChange(f);
            }}
          />
          {busy ? (
            <span>Mengunggah…</span>
          ) : (
            <>
              <ImagePlus className="h-4 w-4" />
              <span>Unggah {label}</span>
            </>
          )}
        </label>
      )}
    </div>
  );
}

