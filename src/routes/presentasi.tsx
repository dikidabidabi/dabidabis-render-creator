import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Layers,
  Play,
  Pause,
  Maximize2,
  Printer,
  FileDown,
  Presentation,
  X,
  Inbox,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import SunCalc from "suncalc";
import { drawOsmTiles } from "@/lib/geo";

export const Route = createFileRoute("/presentasi")({
  head: () => ({
    meta: [
      { title: "Presentasi — Dabidabi's" },
      { name: "description", content: "Slide presentasi A3 modern: per-level dan tabulasi, siap cetak." },
    ],
  }),
  component: PresentasiPage,
});

// ---------- Types ----------
type Point = { x: number; y: number };
type LineKind = "straight" | "arc" | "bezier";
type Line = {
  a: Point; b: Point; kind?: LineKind; bulge?: number; c1?: Point; c2?: Point; levelId?: string;
};
type Layer = {
  id: string; name: string; points: Point[]; areaM2: number; color: string; levelId?: string; coefficient?: number; gsb?: number[];
};
type Level = { id: string; name: string; mdpl: number; opacity: number; typicalCount?: number; typicalHeight?: number };
type Geo = { lat: number; lon: number; locked: boolean; mapOpacity: number; mapRotation?: number; label?: string };
type Sketch = {
  id: string; title: string; createdAt: number; updatedAt: number; scale: string;
  lines?: Line[]; layers: Layer[]; levels: Level[];
  kdbPct?: number; klbCoef?: number; fungsi?: string; northRotation?: number;
  geo?: Geo;
};
type StoreShape = { sketches: Sketch[]; openId: string | null };

const STORAGE_KEY = "dabidabis_sketch_v2";
const COST_KEY = "dabidabis_cost_v1";
const NARASI_KEY = "dabidabis_narasi_v1";

// ---------- Narasi store (sinkron dengan halaman /narasi) ----------
type NarasiItem = { id: string; text: string; images: (string | null)[] };
type NarasiStore = Record<string, NarasiItem[]>;
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
    }
    return out;
  } catch { return {}; }
}
function narasiForSketch(store: NarasiStore, sketchId: string): NarasiItem[] {
  const arr = store[sketchId];
  if (arr && arr.length > 0) return arr;
  return [{ id: `default-${sketchId}`, text: "", images: [null, null, null, null] }];
}

// A3 landscape: 420 × 297 mm. Internal slide canvas in px (proportional, 1mm ≈ 3.3674px).
const A3_W = 1414;
const A3_H = 1000;
const PAD = 84; // 2.5cm at this scale (2.5/42 * 1414 ≈ 84.16, 2.5/29.7 * 1000 ≈ 84.18)

function isLahan(n: string) { return n.trim().toLowerCase().startsWith("lahan"); }
function isVoid(n: string) { return n.trim().toLowerCase() === "void"; }

// Typical floor logic — kept in sync with sketch.tsx
const TYPICAL_FLOOR_H = 3;
function tipH(lv: { typicalHeight?: number }): number {
  const h = Number(lv.typicalHeight);
  return Number.isFinite(h) && h > 0 ? h : TYPICAL_FLOOR_H;
}
function isAutoLevelName(name: string): boolean {
  return /^Level\s+\d+(?:\s*[-–]\s*\d+)?$/i.test(name.trim());
}
function computeLevelDisplayNames(levels: Level[]): Record<string, string> {
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const out: Record<string, string> = {};
  let idx = 1;
  for (const lv of sorted) {
    const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
    const start = idx;
    const end = idx + k - 1;
    const auto = k > 1 ? `Level ${start}–${end}` : `Level ${start}`;
    out[lv.id] = isAutoLevelName(lv.name) ? auto : lv.name;
    idx = end + 1;
  }
  return out;
}
// Expand source levels into individual visible floors (one per typical copy)
type ExpandedFloor = {
  id: string; sourceId: string; name: string;
  mdpl: number; height: number;
  typicalIndex: number; typicalTotal: number;
};
function expandLevelsForView(levels: Level[]): ExpandedFloor[] {
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  let shift = 0;
  const adjusted = sorted.map((lv) => {
    const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
    const h = tipH(lv);
    const base = lv.mdpl + shift;
    shift += (k - 1) * h;
    return { lv, k, base, h };
  });
  const out: ExpandedFloor[] = [];
  for (let i = 0; i < adjusted.length; i++) {
    const { lv, k, base, h } = adjusted[i];
    const next = adjusted[i + 1];
    if (k === 1) {
      const hh = next ? Math.max(0.1, next.base - base) : 4;
      out.push({ id: lv.id, sourceId: lv.id, name: lv.name, mdpl: base, height: hh, typicalIndex: 0, typicalTotal: 1 });
    } else {
      for (let j = 0; j < k; j++) {
        out.push({
          id: `${lv.id}__t${j}`,
          sourceId: lv.id,
          name: lv.name,
          mdpl: base + j * h,
          height: h,
          typicalIndex: j,
          typicalTotal: k,
        });
      }
    }
  }
  return out;
}
function fmt(n: number, d = 2) {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtRp(n: number) {
  if (!Number.isFinite(n)) return "Rp 0";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}
function loadCostMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COST_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

// ---------- Page ----------
function PresentasiPage() {
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [narasiStore, setNarasiStore] = useState<NarasiStore>({});
  const lastRawRef = useRef<string | null>(null);
  const lastNarasiRawRef = useRef<string | null>(null);

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== lastRawRef.current) {
        lastRawRef.current = raw;
        if (!raw) { setSketches([]); setOpenId(null); }
        else {
          const s = JSON.parse(raw) as StoreShape;
          if (s && Array.isArray(s.sketches)) {
            setSketches(s.sketches as Sketch[]);
            setOpenId((prev) => {
              if (prev && s.sketches.some((x) => x.id === prev)) return prev;
              return s.openId ?? s.sketches[0]?.id ?? null;
            });
          }
        }
      }
      const nraw = localStorage.getItem(NARASI_KEY);
      if (nraw !== lastNarasiRawRef.current) {
        lastNarasiRawRef.current = nraw;
        setNarasiStore(loadNarasiStore());
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    setLoaded(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === NARASI_KEY) load();
    };
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", load);
    const iv = window.setInterval(load, 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", load);
      window.clearInterval(iv);
    };
  }, []);


  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <PrintStyles />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Presentasi</h1>
        <p className="text-sm text-muted-foreground">
          Slide A3 lanskap putih, modern dan siap cetak. Tersinkron otomatis dengan Sketsa & Tabulasi.
        </p>
      </div>

      {loaded && sketches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/40 p-10 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Belum ada sketsa. Buat sketsa di halaman Sketsa untuk melihat presentasinya di sini.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sketches.map((sk) => (
            <PresentasiBox
              key={sk.id}
              sketch={sk}
              narasi={narasiForSketch(narasiStore, sk.id)}
              open={openId === sk.id}
              onToggle={() => setOpenId((p) => (p === sk.id ? null : sk.id))}
            />
          ))}
        </div>
      )}

    </div>
  );
}

function PrintStyles() {
  // Print rules: A3 landscape, no margins, render only the active print container.
  return (
    <style>{`
@page { size: A3 landscape; margin: 0; }
@media print {
  html, body { background: #fff !important; }
  body > * { visibility: hidden !important; }
  .a3-print-root, .a3-print-root * { visibility: visible !important; }
  .a3-print-root { position: absolute; inset: 0; }
  .a3-print-page {
    width: 420mm; height: 297mm;
    page-break-after: always;
    break-after: page;
    overflow: hidden;
    background: #fff;
  }
  .a3-print-page:last-child { page-break-after: auto; }
  .no-print { display: none !important; }
}
`}</style>
  );
}

// ---------- Sketch Box ----------
function PresentasiBox({
  sketch, narasi, open, onToggle,
}: { sketch: Sketch; narasi: NarasiItem[]; open: boolean; onToggle: () => void }) {
  const slides = useMemo(() => buildSlides(sketch, narasi), [sketch, narasi]);

  const [idx, setIdx] = useState(0);
  const [full, setFull] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<null | "pptx" | "pdf">(null);
  const exportRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (idx >= slides.length) setIdx(0); }, [slides.length, idx]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % slides.length), 4500);
    return () => window.clearInterval(id);
  }, [playing, slides.length]);

  const prev = useCallback(() => setIdx((i) => (i - 1 + slides.length) % slides.length), [slides.length]);
  const next = useCallback(() => setIdx((i) => (i + 1) % slides.length), [slides.length]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") { setFull(false); setPlaying(false); }
      else if (e.key.toLowerCase() === "p") setPlaying((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, next, prev]);

  const renderSlideImages = useCallback(async (): Promise<string[]> => {
    // Wait two frames so the offscreen render mounts at full A3 size.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const root = exportRootRef.current;
    if (!root) throw new Error("Render container tidak siap");
    const pages = Array.from(root.querySelectorAll<HTMLElement>("[data-slide-page]"));
    const { default: html2canvas } = await import("html2canvas-pro");
    const images: string[] = [];
    for (const el of pages) {
      const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false });
      images.push(canvas.toDataURL("image/png"));
    }
    return images;
  }, []);

  const doExportPptx = useCallback(async () => {
    setExporting("pptx");
    try {
      const images = await renderSlideImages();
      const { default: PptxGenJS } = await import("pptxgenjs");
      const pres = new PptxGenJS();
      // A3 landscape: 420mm x 297mm = 16.54in x 11.69in
      pres.defineLayout({ name: "A3", width: 16.54, height: 11.69 });
      pres.layout = "A3";
      images.forEach((data) => {
        const slide = pres.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addImage({ data, x: 0, y: 0, w: 16.54, h: 11.69 });
      });
      const fname = `${(sketch.title || "presentasi").replace(/[^\w\-]+/g, "_")}.pptx`;
      await pres.writeFile({ fileName: fname });
    } catch (err) {
      console.error(err);
      window.alert("Gagal mengekspor PPTX: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(null);
    }
  }, [sketch.title, renderSlideImages]);

  const doExportPdf = useCallback(async () => {
    setExporting("pdf");
    try {
      const images = await renderSlideImages();
      const { default: jsPDF } = await import("jspdf");
      // A3 landscape: 420mm x 297mm
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
      images.forEach((data, i) => {
        if (i > 0) pdf.addPage("a3", "landscape");
        pdf.addImage(data, "PNG", 0, 0, 420, 297, undefined, "FAST");
      });
      const fname = `${(sketch.title || "presentasi").replace(/[^\w\-]+/g, "_")}.pdf`;
      pdf.save(fname);
    } catch (err) {
      console.error(err);
      window.alert("Gagal mengekspor PDF: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(null);
    }
  }, [sketch.title, renderSlideImages]);


  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface/60 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{sketch.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {slides.length} slide · {sketch.levels.length} level · A3 lanskap
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border p-4">
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-lg bg-neutral-200/40 p-4 shadow-inner">
              <A3Frame>
                <SlideContent slide={slides[idx]} />
              </A3Frame>
              {/* Controls overlay */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button variant="secondary" size="icon" className="h-8 w-8" onClick={prev}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" size="icon" className="h-8 w-8" onClick={next}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="secondary" size="icon" className="h-8 w-8"
                    onClick={() => setPlaying((p) => !p)}
                    title={playing ? "Jeda" : "Putar"}
                  >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="text-xs font-medium text-muted-foreground">
                  {idx + 1} / {slides.length} · {slides[idx]?.title}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="secondary" size="sm" className="h-8 gap-1.5" onClick={doExportPdf} disabled={exporting === "pdf"} title="Unduh sebagai PDF A3 lanskap">
                    {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                    PDF
                  </Button>
                  <Button
                    variant="secondary" size="sm" className="h-8 gap-1.5"
                    onClick={doExportPptx}
                    disabled={exporting === "pptx"}
                    title="Unduh sebagai PowerPoint (.pptx)"
                  >
                    {exporting === "pptx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Presentation className="h-4 w-4" />}
                    PPTX
                  </Button>
                  <Button
                    variant="secondary" size="icon" className="h-8 w-8"
                    onClick={() => { setFull(true); setPlaying(true); }}
                    title="Slideshow layar penuh"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>

              </div>
            </div>
            {/* Thumbs */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setIdx(i)}
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-1 text-[10px] transition-colors",
                    i === idx
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {i + 1}. {s.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {full && (
        <FullscreenSlideshow
          slides={slides}
          idx={idx}
          setIdx={setIdx}
          playing={playing}
          setPlaying={setPlaying}
          onClose={() => { setFull(false); setPlaying(false); }}
        />
      )}

      {/* Offscreen export container (full A3 canvas, captured by html2canvas for both PDF and PPTX) */}
      {exporting && (
        <div
          ref={exportRootRef}
          className="no-print"
          style={{ position: "fixed", left: "-100000px", top: 0, pointerEvents: "none" }}
          aria-hidden
        >
          {slides.map((s) => (
            <div
              key={s.id}
              data-slide-page
              style={{ width: A3_W, height: A3_H, background: "#fff", overflow: "hidden" }}
            >
              <SlideContent slide={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function FullscreenSlideshow({
  slides, idx, setIdx, playing, setPlaying, onClose,
}: {
  slides: Slide[];
  idx: number;
  setIdx: (n: number | ((i: number) => number)) => void;
  playing: boolean;
  setPlaying: (b: boolean | ((p: boolean) => boolean)) => void;
  onClose: () => void;
}) {
  const prev = () => setIdx((i) => (i - 1 + slides.length) % slides.length);
  const next = () => setIdx((i) => (i + 1) % slides.length);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900">
      <div className="relative h-full max-h-screen w-full">
        <div className="flex h-full w-full items-center justify-center p-8">
          <div className="w-full max-w-[1700px] shadow-2xl">
            <A3Frame>
              <SlideContent slide={slides[idx]} />
            </A3Frame>
          </div>
        </div>
        <div className="absolute right-4 top-4">
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white hover:bg-white/10" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
          <Button variant="ghost" size="icon" className="h-10 w-10 text-white hover:bg-white/10" onClick={prev}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-10 w-10 text-white hover:bg-white/10"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-10 w-10 text-white hover:bg-white/10" onClick={next}>
            <ChevronRight className="h-5 w-5" />
          </Button>
          <div className="ml-3 text-xs text-white/70">
            {idx + 1} / {slides.length} · {slides[idx]?.title}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- A3 Frame: maintains aspect, scales internal 1414x1000 canvas ----------
function A3Frame({ children }: { children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setScale(w / A3_W);
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={wrap}
      className="relative w-full overflow-hidden bg-white shadow-[0_10px_40px_-15px_rgba(0,0,0,0.45)] ring-1 ring-black/5"
      style={{ aspectRatio: `${A3_W} / ${A3_H}` }}
    >
      <div
        style={{
          width: A3_W,
          height: A3_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---------- Slide types ----------
type SiteView = "lokasi" | "akses" | "fasilitas" | "lingkungan";
type Slide =
  | { kind: "level"; id: string; title: string; sketch: Sketch; level: Level; bounds: Bounds }
  | { kind: "site"; id: string; title: string; sketch: Sketch; bounds: Bounds; view: SiteView }
  | { kind: "konsep"; id: string; title: string; sketch: Sketch; narasi: NarasiItem; index: number; total: number }
  | { kind: "matahari"; id: string; title: string; sketch: Sketch; bounds: Bounds }
  | { kind: "shadow-seasonal"; id: string; title: string; sketch: Sketch; bounds: Bounds }
  | { kind: "facade-zoning"; id: string; title: string; sketch: Sketch; bounds: Bounds }
  | { kind: "stacking"; id: string; title: string; sketch: Sketch }
  | { kind: "rekap"; id: string; title: string; sketch: Sketch; data: Stats }
  | { kind: "rincian"; id: string; title: string; sketch: Sketch }
  | { kind: "infografis"; id: string; title: string; sketch: Sketch; data: Stats }
  | { kind: "biaya"; id: string; title: string; sketch: Sketch; data: Stats };

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function computeBounds(sk: Sketch): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of sk.layers ?? []) for (const p of l.points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  for (const ln of sk.lines ?? []) for (const p of [ln.a, ln.b]) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const w = maxX - minX, h = maxY - minY;
  const pad = Math.max(w, h, 1) * 0.08;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function buildSlides(sk: Sketch, narasi: NarasiItem[] = []): Slide[] {
  const bounds = computeBounds(sk);
  const levels = [...(sk.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const data = computeStats(sk);
  const displayNames = computeLevelDisplayNames(levels);
  const out: Slide[] = [];
  // 4 slide analisa site di awal — selalu ada (pakai koordinat default jika belum dikunci).
  out.push({ kind: "site", id: "site-lokasi", title: "Lokasi & Konteks Tapak", sketch: sk, bounds, view: "lokasi" });
  out.push({ kind: "site", id: "site-akses", title: "Akses & Sirkulasi", sketch: sk, bounds, view: "akses" });
  out.push({ kind: "site", id: "site-fasilitas", title: "Fasilitas Sekitar & Radius Pencapaian", sketch: sk, bounds, view: "fasilitas" });
  out.push({ kind: "site", id: "site-lingkungan", title: "Blue–Green & Lalu Lintas", sketch: sk, bounds, view: "lingkungan" });
  // Slide Konsep — satu per narasi (minimal 1, sesuai default di halaman Narasi).
  const narasiList = narasi.length > 0 ? narasi : [{ id: `default-${sk.id}`, text: "", images: [null, null, null, null] }];
  narasiList.forEach((n, i) => {
    out.push({
      kind: "konsep",
      id: `konsep-${n.id}`,
      title: narasiList.length > 1 ? `Konsep ${i + 1}` : "Konsep",
      sketch: sk,
      narasi: n,
      index: i,
      total: narasiList.length,
    });
  });
  for (const lv of levels) {
    out.push({
      kind: "level",
      id: `lvl-${lv.id}`,
      title: displayNames[lv.id] ?? lv.name,
      sketch: sk,
      level: lv,
      bounds,
    });
  }
  out.push({ kind: "matahari", id: "matahari", title: "Analisa Matahari & Bukaan", sketch: sk, bounds });
  out.push({ kind: "shadow-seasonal", id: "shadow-seasonal", title: "Studi Bayangan Tahunan · 15.00 WIB", sketch: sk, bounds });
  out.push({ kind: "facade-zoning", id: "facade-zoning", title: "Zonasi Fasad · Masif vs Bukaan", sketch: sk, bounds });
  out.push({ kind: "stacking", id: "stacking", title: "Stacking Diagram", sketch: sk });
  out.push({ kind: "rekap", id: "rekap", title: "Rekapitulasi", sketch: sk, data });
  out.push({ kind: "rincian", id: "rincian", title: "Rincian per Level", sketch: sk });
  out.push({ kind: "infografis", id: "info", title: "Infografis", sketch: sk, data });
  out.push({ kind: "biaya", id: "biaya", title: "Estimasi Biaya", sketch: sk, data });
  return out;
}

// ---------- Stats ----------
type Stats = {
  totalLahanM2: number; totalRuangM2: number;
  totalEfektifM2: number; totalSaranaM2: number; totalSetengahM2: number;
  kdbPct?: number; klbCoef?: number;
  kdbLimitM2: number; klbLimitM2: number;
  kdbRencanaM2: number; klbRencanaM2: number;
  jumlahLapis: number; ketinggianM: number;
  totalTerhitungM2: number;
};

function computeStats(sk: Sketch): Stats {
  const layers = sk.layers ?? [];
  const levels = sk.levels ?? [];
  const lahan = layers.filter((l) => isLahan(l.name));
  const ruang = layers.filter((l) => !isLahan(l.name));
  // Build a multiplier lookup per source level (default 1).
  const mul: Record<string, number> = {};
  for (const lv of levels) mul[lv.id] = Math.max(1, Math.round(lv.typicalCount ?? 1));
  const kOf = (lid?: string) => (lid && mul[lid]) || 1;

  const totalLahanM2 = lahan.reduce((s, l) => s + (l.areaM2 || 0), 0);
  const totalRuangM2 = ruang.reduce((s, l) => s + (l.areaM2 || 0) * kOf(l.levelId), 0);
  const totalEfektifM2 = ruang.filter((l) => (l.coefficient ?? 1) === 1)
    .reduce((s, l) => s + l.areaM2 * kOf(l.levelId), 0);
  const totalSaranaM2 = ruang.filter((l) => (l.coefficient ?? 1) === 0)
    .reduce((s, l) => s + l.areaM2 * kOf(l.levelId), 0);
  const totalSetengahM2 = ruang.filter((l) => (l.coefficient ?? 1) === 0.5)
    .reduce((s, l) => s + l.areaM2 * kOf(l.levelId), 0);
  const kdbLimitM2 = (sk.kdbPct ?? 0) > 0 && totalLahanM2 > 0 ? (sk.kdbPct! / 100) * totalLahanM2 : 0;
  const klbLimitM2 = (sk.klbCoef ?? 0) > 0 && totalLahanM2 > 0 ? sk.klbCoef! * totalLahanM2 : 0;
  // KDB = footprint at ground only (no multiplier — ground floor is a single footprint)
  let kdbRencanaM2 = 0;
  if (levels.length > 0) {
    const ground = [...levels].sort((a, b) => a.mdpl - b.mdpl)[0];
    kdbRencanaM2 = ruang.filter((l) => l.levelId === ground.id).reduce((s, l) => s + l.areaM2, 0);
  }
  const klbRencanaM2 = ruang.reduce(
    (s, l) => s + l.areaM2 * (l.coefficient ?? 1) * kOf(l.levelId),
    0,
  );
  const jumlahLapis = levels.reduce((s, lv) => s + Math.max(1, Math.round(lv.typicalCount ?? 1)), 0);
  const baseHeight =
    levels.length > 1 ? Math.max(...levels.map((l) => l.mdpl)) - Math.min(...levels.map((l) => l.mdpl)) : 0;
  const typicalExtra = levels.reduce(
    (s, lv) => s + (Math.max(1, Math.round(lv.typicalCount ?? 1)) - 1) * tipH(lv),
    0,
  );
  const ketinggianM = baseHeight + typicalExtra;
  const totalTerhitungM2 = layers
    .filter((l) => !isLahan(l.name) && !isVoid(l.name))
    .reduce((s, l) => s + (l.areaM2 || 0) * kOf(l.levelId), 0);
  return {
    totalLahanM2, totalRuangM2, totalEfektifM2, totalSaranaM2, totalSetengahM2,
    kdbPct: sk.kdbPct, klbCoef: sk.klbCoef,
    kdbLimitM2, klbLimitM2, kdbRencanaM2, klbRencanaM2,
    jumlahLapis, ketinggianM, totalTerhitungM2,
  };
}

// ============= SLIDE CONTENT (white A3 modern theme) =============

const SLIDE_SCALE_KEY = "dabidabis_slidescale_v1";
function loadSlideScale(id: string): number | null {
  try {
    const raw = localStorage.getItem(SLIDE_SCALE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const n = v?.[id];
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch { return null; }
}
function saveSlideScale(id: string, scale: number | null) {
  try {
    const raw = localStorage.getItem(SLIDE_SCALE_KEY);
    const v = raw ? JSON.parse(raw) : {};
    if (scale == null) delete v[id]; else v[id] = scale;
    localStorage.setItem(SLIDE_SCALE_KEY, JSON.stringify(v));
  } catch { /* ignore */ }
}

// Scales children to fit; user can drag the bottom-right handle to scale manually.
function ManualScaleBox({
  slideId, children, style,
}: { slideId: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [userScale, setUserScale] = useState<number | null>(() => loadSlideScale(slideId));
  const scaleRef = useRef<number>(1);

  useEffect(() => { setUserScale(loadSlideScale(slideId)); }, [slideId]);

  // Measure ONCE on mount (and when slideId changes). Slides are static:
  // no ResizeObserver, no auto re-fit on data change. Only the user's manual
  // drag handle can change scale after the initial fit.
  useEffect(() => {
    if (!boxRef.current || !innerRef.current) return;
    let raf1 = 0, raf2 = 0;
    const measure = () => {
      if (!boxRef.current || !innerRef.current) return;
      const box = boxRef.current.getBoundingClientRect();
      const inner = innerRef.current;
      const prev = inner.style.transform;
      inner.style.transform = "none";
      const cw = inner.scrollWidth;
      const ch = inner.scrollHeight;
      inner.style.transform = prev;
      if (cw === 0 || ch === 0 || box.width === 0 || box.height === 0) return;
      setNatural({ w: cw, h: ch });
      setFitScale(Math.min(1, box.width / cw, box.height / ch));
    };
    // Two RAFs to let fonts/images settle before measuring once.
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(measure);
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [slideId]);


  const scale = userScale ?? fitScale;
  scaleRef.current = scale;

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!natural || !boxRef.current) return;
    const boxRect = boxRef.current.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const cx = ev.clientX - boxRect.left;
      const cy = ev.clientY - boxRect.top;
      const sx = cx / natural.w;
      const sy = cy / natural.h;
      const ns = Math.max(0.1, Math.min(4, Math.min(sx, sy)));
      scaleRef.current = ns;
      setUserScale(ns);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      saveSlideScale(slideId, scaleRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resetScale = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setUserScale(null);
    saveSlideScale(slideId, null);
  };

  const displayW = natural ? natural.w * scale : 0;
  const displayH = natural ? natural.h * scale : 0;

  return (
    <div ref={boxRef} style={{ ...style, position: "relative", overflow: "hidden" }}>
      <div
        ref={innerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: natural ? natural.w : "100%",
          height: natural ? natural.h : "100%",
          display: "flex",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
      {natural && (
        <div
          className="no-print slide-scale-handle"
          onPointerDown={startDrag}
          onDoubleClick={resetScale}
          title="Tarik untuk skala manual · Klik dua kali untuk reset"
          style={{
            position: "absolute",
            left: displayW - 18,
            top: displayH - 18,
            width: 22,
            height: 22,
            cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 0 50%, #111 50% 60%, transparent 60% 70%, #111 70% 80%, transparent 80%)",
            border: "1px solid rgba(0,0,0,0.35)",
            borderRadius: 3,
            backgroundColor: "rgba(255,255,255,0.85)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
            zIndex: 10,
            touchAction: "none",
          }}
        />
      )}
    </div>
  );
}


function SlideContent({ slide }: { slide?: Slide }) {
  if (!slide) return null;
  const body = (
    <>
      {slide.kind === "level" && <LevelBody slide={slide} />}
      {slide.kind === "site" && <SiteAnalysisBody slide={slide} />}
      {slide.kind === "konsep" && <KonsepBody slide={slide} />}
      {slide.kind === "matahari" && <MatahariBody slide={slide} />}
      {slide.kind === "shadow-seasonal" && <ShadowSeasonalBody slide={slide} />}
      {slide.kind === "facade-zoning" && <FacadeZoningBody slide={slide} />}
      {slide.kind === "stacking" && <StackingBody sketch={slide.sketch} />}
      {slide.kind === "rekap" && <RekapBody data={slide.data} sketch={slide.sketch} />}
      {slide.kind === "rincian" && <RincianBody sketch={slide.sketch} />}
      {slide.kind === "infografis" && <InfografisBody data={slide.data} sketch={slide.sketch} />}
      {slide.kind === "biaya" && <BiayaBody data={slide.data} sketch={slide.sketch} />}
    </>
  );
  const fixedLayout =
    slide.kind === "level" ||
    slide.kind === "matahari" ||
    slide.kind === "konsep" ||
    slide.kind === "shadow-seasonal" ||
    slide.kind === "facade-zoning";
  // Inner padded "safe area" inside the 1414x1000 canvas, 2.5cm inset.
  return (
    <div
      style={{
        width: A3_W,
        height: A3_H,
        background: "#ffffff",
        color: "#0a0a0a",
        fontFamily: "var(--font-sans, Manrope, sans-serif)",
        padding: PAD,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SlideHeader slide={slide} />
      {fixedLayout ? (
        <div style={{ flex: 1, minHeight: 0, marginTop: 28, marginBottom: 28, overflow: "hidden" }}>
          {body}
        </div>
      ) : (
        <ManualScaleBox slideId={slide.id} style={{ flex: 1, minHeight: 0, marginTop: 28, marginBottom: 28 }}>
          {body}
        </ManualScaleBox>
      )}
      <SlideFooter slide={slide} />
    </div>
  );
}


function SlideHeader({ slide }: { slide: Slide }) {
  const kicker =
    slide.kind === "level" ? "Sketsa · Level"
    : slide.kind === "site" ? (
        slide.view === "lokasi" ? "Analisa · Lokasi"
        : slide.view === "akses" ? "Analisa · Akses"
        : slide.view === "fasilitas" ? "Analisa · Fasilitas"
        : "Analisa · Lingkungan"
      )
    : slide.kind === "matahari" ? "Analisa · Matahari"
    : slide.kind === "shadow-seasonal" ? "Analisa · Bayangan Tahunan"
    : slide.kind === "facade-zoning" ? "Analisa · Zonasi Fasad"
    : slide.kind === "konsep" ? "Konsep · Narasi"
    : slide.kind === "stacking" ? "Sketsa · Stacking"
    : slide.kind === "rekap" ? "Tabulasi · Rekap"
    : slide.kind === "rincian" ? "Tabulasi · Rincian"
    : slide.kind === "infografis" ? "Tabulasi · Infografis"
    : "Tabulasi · Estimasi";
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, borderBottom: "1px solid #111", paddingBottom: 18 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, letterSpacing: "0.28em", textTransform: "uppercase", color: "#666", fontWeight: 600 }}>
          {kicker}
        </div>
        <div
          style={{
            fontFamily: "var(--font-display, Sora, sans-serif)",
            fontSize: 58, lineHeight: 1.02, letterSpacing: "-0.03em", fontWeight: 600, marginTop: 6,
          }}
        >
          {slide.title}
        </div>
      </div>
      <div style={{ textAlign: "right", color: "#111", flexShrink: 0 }}>
        <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {slide.sketch.title}
        </div>
        <div style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "#888", marginTop: 4 }}>
          Skala {slide.sketch.scale}{slide.sketch.fungsi ? ` · ${slide.sketch.fungsi}` : ""}
        </div>
      </div>
    </div>
  );
}

function SlideFooter({ slide }: { slide: Slide }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e5e5e5", paddingTop: 14, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#888" }}>
      <span style={{ fontWeight: 700, color: "#111" }}>Dabidabi's</span>
      <span>{slide.title}</span>
      <span>A3 · 420 × 297 mm</span>
    </div>
  );
}

// Sudut arah Utara nyata pada frame sketsa (CW dari sketsa-atas).
// Di Sketsa, user merotasi peta CW sebesar mapRotation supaya jalan/garis
// peta menempel pada tapak; otomatis Utara nyata berada di sudut mapRotation
// dari sketsa-atas. Inilah satu-satunya acuan untuk kompas & analisa matahari
// agar konsisten dengan superimpose di sketsa.
function effectiveNorthDeg(sketch: Sketch): number {
  const m = Number(sketch.geo?.mapRotation) || 0;
  return ((m % 360) + 360) % 360;
}

function SlideCompass({ rotation, size = 92 }: { rotation: number; size?: number }) {
  const r = ((rotation % 360) + 360) % 360;
  return (
    <div style={{ position: "absolute", right: 8, bottom: 8, width: size, height: size, pointerEvents: "none" }}>
      <div style={{ width: size, height: size, transform: `rotate(${r}deg)` }}>
        <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block" }}>
          <circle cx="50" cy="50" r="46" fill="rgba(255,255,255,0.92)" stroke="#0a0a0a" strokeWidth="2" />
          <circle cx="50" cy="50" r="2.5" fill="#0a0a0a" />
          <polygon points="50,8 42,52 50,46 58,52" fill="#e85d3a" stroke="#0a0a0a" strokeWidth="1.5" strokeLinejoin="round" />
          <polygon points="50,92 44,54 50,58 56,54" fill="#ffffff" stroke="#0a0a0a" strokeWidth="1.5" strokeLinejoin="round" />
          <text x="50" y="22" textAnchor="middle" fontSize="14" fontWeight="800" fill="#0a0a0a" fontFamily="Sora, sans-serif">U</text>
          <text x="50" y="86" textAnchor="middle" fontSize="9" fontWeight="700" fill="#555" fontFamily="Sora, sans-serif">S</text>
          <text x="84" y="54" textAnchor="middle" fontSize="9" fontWeight="700" fill="#555" fontFamily="Sora, sans-serif">T</text>
          <text x="16" y="54" textAnchor="middle" fontSize="9" fontWeight="700" fill="#555" fontFamily="Sora, sans-serif">B</text>
        </svg>
      </div>
    </div>
  );
}

// ---- Level body ----
function LevelBody({ slide }: { slide: Extract<Slide, { kind: "level" }> }) {
  const { sketch, level, bounds } = slide;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const layers = (sketch.layers ?? []).filter((l) => l.levelId === level.id);
  const lines = (sketch.lines ?? []).filter((l) => l.levelId === level.id);
  const lahanAll = (sketch.layers ?? []).filter((l) => isLahan(l.name));
  const k = Math.max(1, Math.round(level.typicalCount ?? 1));
  const luasPerLantai = layers.filter((l) => !isLahan(l.name)).reduce((s, l) => s + l.areaM2, 0);
  const totalLuas = luasPerLantai * k;
  const displayNames = computeLevelDisplayNames(sketch.levels ?? []);
  const displayName = displayNames[level.id] ?? level.name;
  // Level 1 = level dengan mdpl terendah. GSB & radius EVK hanya muncul di Level 1.
  const minMdpl = (sketch.levels ?? []).length
    ? Math.min(...(sketch.levels ?? []).map((l) => l.mdpl))
    : level.mdpl;
  const isGround = level.mdpl === minMdpl;
  const mPerSPx = sketchMetersPerSketchPx(sketch.scale);
  const pxPerM = 1 / mPerSPx;
  const evkRooms = isGround
    ? layers.filter((l) => l.name.trim().toLowerCase() === "tangga evk" && l.points.length >= 3)
    : [];
  const sw = Math.max(w, h);

  // Convex hull of all non-lahan room vertices for outer dimensions
  const roomLayers = layers.filter((l) => !isLahan(l.name));
  const allPts: Point[] = roomLayers.flatMap((l) => l.points);
  const hull = convexHull(allPts);
  const dimOffsetPx = sw * 0.018;

  return (
    <div style={{ display: "flex", gap: 32, width: "100%", height: "100%", alignItems: "stretch" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg
          viewBox={`${bounds.minX} ${bounds.minY} ${w} ${h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          {lahanAll.map((l) => (
            <g key={`lhn-${l.id}`}>
              <polygon
                points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={isGround ? "rgba(0,0,0,0.04)" : "none"}
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={sw * 0.0015}
                strokeDasharray={isGround ? undefined : `${sw * 0.008} ${sw * 0.005}`}
              />
              {isGround && l.points.map((_, i) => {
                const seg = inwardOffsetSegPx(l.points, i, getLayerGsbM(l, i) * pxPerM);
                if (getLayerGsbM(l, i) <= 0) return null;
                return (
                  <g key={`gsb-${l.id}-${i}`}>
                    <line
                      x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y}
                      stroke="rgba(0,0,0,0.9)"
                      strokeWidth={sw * 0.0012}
                      strokeDasharray={`${sw * 0.006} ${sw * 0.004}`}
                    />
                    <text
                      x={seg.mid.x} y={seg.mid.y}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={sw * 0.014} fontWeight={600} fill="#0a0a0a"
                      style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.9)", strokeWidth: sw * 0.006 } as React.CSSProperties}
                    >
                      {`GSB ${i + 1} (${getLayerGsbM(l, i)}m)`}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
          {layers.filter((l) => !isLahan(l.name)).map((l) => (
            <g key={l.id}>
              <polygon
                points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={l.color.replace("ALPHA", "0.28")}
                stroke={l.color.replace("ALPHA", "1")}
                strokeWidth={sw * 0.002}
              />
              <text
                x={centroid(l.points).x}
                y={centroid(l.points).y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={sw * 0.02}
                fontWeight={600}
                fill="#0a0a0a"
                style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.85)", strokeWidth: sw * 0.01 } as React.CSSProperties}
              >
                {l.name}
              </text>
            </g>
          ))}
          {lines.map((ln, i) => (
            <path
              key={i}
              d={linePath(ln)}
              stroke="#0a0a0a"
              strokeWidth={sw * 0.003}
              fill="none"
              strokeLinecap="round"
            />
          ))}
          {hull.length >= 2 && (() => {
            // Bounding box dari hull — dipakai sebagai acuan garis dimensi
            // tiap sisi (top/right/bottom/left) supaya semua label sejajar.
            const hxs = hull.map((p) => p.x);
            const hys = hull.map((p) => p.y);
            const bx0 = Math.min(...hxs), bx1 = Math.max(...hxs);
            const by0 = Math.min(...hys), by1 = Math.max(...hys);
            const hc = centroid(hull);
            const tick = sw * 0.006;
            const labelGap = sw * 0.012;
            return hull.map((_, i) => {
              const a = hull[i];
              const b = hull[(i + 1) % hull.length];
              const dx = b.x - a.x, dy = b.y - a.y;
              const len = Math.hypot(dx, dy) || 1;
              const lengthM = len * mPerSPx;
              if (lengthM < 0.5) return null;
              // outward normal (away from hull centroid)
              let nx = -dy / len, ny = dx / len;
              const midE = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              if ((midE.x - hc.x) * nx + (midE.y - hc.y) * ny < 0) { nx = -nx; ny = -ny; }
              // Pilih sisi dominan berdasarkan arah normal terbesar.
              const horizontal = Math.abs(nx) > Math.abs(ny);
              let oa: Point, ob: Point, labelX: number, labelY: number, labelDy: number;
              if (horizontal) {
                // sisi kiri/kanan — garis dimensi vertikal, label horizontal
                const x = nx > 0 ? bx1 + dimOffsetPx : bx0 - dimOffsetPx;
                oa = { x, y: a.y };
                ob = { x, y: b.y };
                labelX = x + (nx > 0 ? labelGap : -labelGap);
                labelY = (a.y + b.y) / 2;
                labelDy = 0;
              } else {
                // sisi atas/bawah — garis dimensi horizontal, label horizontal
                const y = ny > 0 ? by1 + dimOffsetPx : by0 - dimOffsetPx;
                oa = { x: a.x, y };
                ob = { x: b.x, y };
                labelX = (a.x + b.x) / 2;
                labelY = y + (ny > 0 ? labelGap : -labelGap);
                labelDy = 0;
              }
              return (
                <g key={`dim-${i}`}>
                  <line x1={a.x} y1={a.y} x2={oa.x} y2={oa.y}
                    stroke="rgba(0,0,0,0.45)" strokeWidth={sw * 0.0008}
                    strokeDasharray={`${sw * 0.004} ${sw * 0.003}`} />
                  <line x1={b.x} y1={b.y} x2={ob.x} y2={ob.y}
                    stroke="rgba(0,0,0,0.45)" strokeWidth={sw * 0.0008}
                    strokeDasharray={`${sw * 0.004} ${sw * 0.003}`} />
                  <line x1={oa.x - (horizontal ? 0 : 0)} y1={oa.y} x2={ob.x} y2={ob.y}
                    stroke="rgba(0,0,0,0.85)" strokeWidth={sw * 0.0012} />
                  {/* tick marks pada ujung garis dimensi */}
                  {horizontal ? (
                    <>
                      <line x1={oa.x - tick / 2} y1={oa.y} x2={oa.x + tick / 2} y2={oa.y}
                        stroke="rgba(0,0,0,0.85)" strokeWidth={sw * 0.0012} />
                      <line x1={ob.x - tick / 2} y1={ob.y} x2={ob.x + tick / 2} y2={ob.y}
                        stroke="rgba(0,0,0,0.85)" strokeWidth={sw * 0.0012} />
                    </>
                  ) : (
                    <>
                      <line x1={oa.x} y1={oa.y - tick / 2} x2={oa.x} y2={oa.y + tick / 2}
                        stroke="rgba(0,0,0,0.85)" strokeWidth={sw * 0.0012} />
                      <line x1={ob.x} y1={ob.y - tick / 2} x2={ob.x} y2={ob.y + tick / 2}
                        stroke="rgba(0,0,0,0.85)" strokeWidth={sw * 0.0012} />
                    </>
                  )}
                  <text
                    x={labelX} y={labelY} dy={labelDy}
                    textAnchor={horizontal ? (nx > 0 ? "start" : "end") : "middle"}
                    dominantBaseline={horizontal ? "central" : (ny > 0 ? "hanging" : "auto")}
                    fontSize={sw * 0.02} fontWeight={600} fill="#0a0a0a"
                    style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.92)", strokeWidth: sw * 0.008 } as React.CSSProperties}
                  >
                    {`${fmt(lengthM, 1)} m`}
                  </text>
                </g>
              );
            });
          })()}
          {evkRooms.map((l) => {
            const c = centroid(l.points);
            const rPx = 38 * pxPerM;
            return (
              <g key={`evk-${l.id}`}>
                <circle
                  cx={c.x} cy={c.y} r={rPx}
                  fill="none"
                  stroke="rgba(232,93,58,0.95)"
                  strokeWidth={sw * 0.0018}
                  strokeDasharray={`${sw * 0.008} ${sw * 0.005}`}
                />
                <line
                  x1={c.x} y1={c.y} x2={c.x + rPx} y2={c.y}
                  stroke="rgba(0,0,0,0.85)"
                  strokeWidth={sw * 0.0009}
                />
                <text
                  x={c.x + rPx / 2} y={c.y - sw * 0.004}
                  textAnchor="middle" dominantBaseline="alphabetic"
                  fontSize={sw * 0.015} fontWeight={700} fill="#0a0a0a"
                  style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.9)", strokeWidth: sw * 0.006 } as React.CSSProperties}
                >
                  38 m
                </text>
              </g>
            );
          })}
        </svg>
        <SlideCompass rotation={effectiveNorthDeg(sketch)} />
      </div>
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
        <BigStat
          label="Level"
          value={displayName}
          hint={k > 1
            ? `${fmt(level.mdpl, 1)} mdpl · tipikal ${k}×`
            : `${fmt(level.mdpl, 1)} mdpl`}
        />
        <BigStat label="Jumlah Ruang" value={String(layers.filter((l) => !isLahan(l.name)).length)} />
        <BigStat
          label="Total Luas"
          value={`${fmt(totalLuas)} m²`}
          hint={k > 1 ? `${fmt(luasPerLantai)} m² × ${k} lantai` : undefined}
        />
        {sketch.fungsi && <BigStat label="Fungsi" value={sketch.fungsi} />}
      </div>
    </div>
  );
}

// ============================================================
// ---- Site analysis (4 slide pertama): peta OSM + Overpass ----
// ============================================================

type OverpassEl = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
type OverpassResult = { elements: OverpassEl[] };

const overpassCache = new Map<string, Promise<OverpassResult>>();
function overpassFetch(query: string): Promise<OverpassResult> {
  const key = query;
  const c = overpassCache.get(key);
  if (c) return c;
  const p = (async () => {
    const endpoints = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];
    let lastErr: unknown;
    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(query),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        if (!r.ok) throw new Error(`overpass ${r.status}`);
        return (await r.json()) as OverpassResult;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("overpass failed");
  })();
  overpassCache.set(key, p);
  p.catch(() => overpassCache.delete(key));
  return p;
}

function useOverpass(query: string | null) {
  const [data, setData] = useState<OverpassResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!query) return;
    let alive = true;
    setErr(null);
    overpassFetch(query)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [query]);
  return { data, err };
}

// Haversine distance in meters.
function distMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6378137;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function elLatLon(el: OverpassEl): { lat: number; lon: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lon: el.lon };
  if (el.center) return el.center;
  return null;
}

// Canvas-based OSM tile map. Center at (lat,lon), radiusM half-width.

function SiteMapCanvas({
  lat, lon, radiusM, width, height, grayscale = true, opacity = 1,
}: {
  lat: number; lon: number; radiusM: number; width: number; height: number;
  grayscale?: boolean; opacity?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext("2d"); if (!ctx) return;
    let cancelled = false;
    const draw = () => {
      if (cancelled || !ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(dpr, 0, 0, dpr, width / 2 * dpr, height / 2 * dpr);
      const worldPxPerMeter = (Math.min(width, height) / 2) / radiusM;
      const halfW = width / 2, halfH = height / 2;
      drawOsmTiles(ctx, {
        lat, lon, worldPxPerMeter, opacity, grayscale,
        bounds: { minX: -halfW, minY: -halfH, maxX: halfW, maxY: halfH },
        onTileLoad: () => { if (!cancelled) requestAnimationFrame(draw); },
      });
    };
    draw();
    return () => { cancelled = true; };
  }, [lat, lon, radiusM, width, height, grayscale, opacity]);
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

// Compute the site footprint convex extent (in meters) relative to a center coordinate.
// We assume sketch world units are CANVAS pixels under sketch scale. Use `scale` mapping.
function sketchMetersPerSketchPx(scale: string): number {
  // mirror stackMetersPerPx logic.
  const major: Record<string, number> = { "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10 };
  return (major[scale] ?? 1) / 80;
}

// Project a (lat,lon) to local meters offset from a center.
function projectM(centerLat: number, centerLon: number, lat: number, lon: number) {
  const R = 6378137;
  const meanLat = ((centerLat + lat) / 2) * (Math.PI / 180);
  const dx = ((lon - centerLon) * Math.PI / 180) * Math.cos(meanLat) * R;
  const dy = -((lat - centerLat) * Math.PI / 180) * R;
  return { x: dx, y: dy };
}

// POI category palette + queries.
const POI_CATS: Array<{ key: string; label: string; color: string; q: string }> = [
  { key: "edu",   label: "Pendidikan",  color: "#1f9d55", q: 'node["amenity"~"school|university|college|kindergarten"]' },
  { key: "med",   label: "Kesehatan",   color: "#c0392b", q: 'node["amenity"~"hospital|clinic|doctors|pharmacy"]' },
  { key: "shop",  label: "Komersial",   color: "#d6a423", q: 'node["shop"];node["amenity"~"marketplace|mall"]' },
  { key: "food",  label: "Kuliner",     color: "#e85d3a", q: 'node["amenity"~"restaurant|cafe|fast_food|food_court"]' },
  { key: "trans", label: "Transportasi",color: "#2d6cdf", q: 'node["highway"="bus_stop"];node["railway"~"station|halt"];node["amenity"="bus_station"]' },
  { key: "wor",   label: "Ibadah",      color: "#8b5cf6", q: 'node["amenity"="place_of_worship"]' },
];

function SiteAnalysisBody({ slide }: { slide: Extract<Slide, { kind: "site" }> }) {
  const { sketch, view } = slide;
  const geo = sketch.geo;
  const lat = geo?.lat ?? -6.2;
  const lon = geo?.lon ?? 106.816666;
  const northDeg = effectiveNorthDeg(sketch); // = mapRotation
  // Radius peta tergantung view.
  const radiusM = view === "lokasi" ? 600 : view === "akses" ? 700 : view === "fasilitas" ? 1000 : 900;

  // Site footprint in meters relative to map center (assumes site centroid = geo).
  const mPerSPx = sketchMetersPerSketchPx(sketch.scale);
  const lahanAll = (sketch.layers ?? []).filter((l) => isLahan(l.name));
  const buildAll = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name));
  const allPts = [...lahanAll, ...buildAll].flatMap((l) => l.points);
  let centerSx = 0, centerSy = 0;
  if (allPts.length) {
    for (const p of allPts) { centerSx += p.x; centerSy += p.y; }
    centerSx /= allPts.length; centerSy /= allPts.length;
  }
  // Sketsa diputar -mapRotation supaya superimpose ke peta utara-ke-atas
  // identik dengan tampilan di Sketsa (peta diputar +mapRotation, sketsa diam).
  const rotRad = (-northDeg * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  const toMeters = (p: Point) => {
    const dx = (p.x - centerSx) * mPerSPx;
    const dy = (p.y - centerSy) * mPerSPx;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  };

  // ---------- Overpass queries per view ----------
  const radius = view === "fasilitas" ? 1200 : view === "akses" ? 900 : view === "lingkungan" ? 1100 : 500;
  const q = useMemo(() => {
    if (view === "akses") {
      return `[out:json][timeout:25];(way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|service"](around:${radius},${lat},${lon}););out tags center;`;
    }
    if (view === "fasilitas") {
      const inner = POI_CATS.map((c) => `${c.q}(around:${radius},${lat},${lon});`).join("");
      return `[out:json][timeout:25];(${inner});out tags center;`;
    }
    if (view === "lingkungan") {
      return `[out:json][timeout:25];(way["leisure"~"park|garden|nature_reserve"](around:${radius},${lat},${lon});way["landuse"~"forest|grass|recreation_ground|meadow|cemetery"](around:${radius},${lat},${lon});way["natural"~"water|wood|scrub"](around:${radius},${lat},${lon});way["waterway"~"river|stream|canal"](around:${radius},${lat},${lon}););out tags center;`;
    }
    // lokasi → minimal context (nearest road for orientation)
    return `[out:json][timeout:25];(way["highway"~"primary|secondary|tertiary|residential"](around:400,${lat},${lon}););out tags center 30;`;
  }, [view, radius, lat, lon]);
  const { data, err } = useOverpass(q);

  // Map size — leave room for right info column.
  const MAP_W = 760, MAP_H = 740;
  const pxPerM = (Math.min(MAP_W, MAP_H) / 2) / radiusM;

  // Render site footprint overlay (SVG over canvas), centered on map.
  const sitePolys = (lahanAll.length ? lahanAll : buildAll).map((l) => ({
    color: lahanAll.includes(l) ? "rgba(232,93,58,0.18)" : "rgba(232,93,58,0.55)",
    stroke: "#0a0a0a",
    pts: l.points.map(toMeters),
  }));

  // ---------- View-specific overlays ----------
  const els = data?.elements ?? [];
  const elsWithLL = els
    .map((e) => ({ e, ll: elLatLon(e) }))
    .filter((x): x is { e: OverpassEl; ll: { lat: number; lon: number } } => !!x.ll);

  // Akses: extract road tier list + nearest distance per tier.
  const roadTiers: Array<{ key: string; label: string; color: string }> = [
    { key: "primary",   label: "Primer",   color: "#c0392b" },
    { key: "secondary", label: "Sekunder", color: "#e85d3a" },
    { key: "tertiary",  label: "Tersier",  color: "#d6a423" },
    { key: "residential", label: "Lokal",  color: "#1f9d55" },
  ];
  const roadsByTier: Record<string, Array<{ name: string; dist: number; ll: { lat: number; lon: number } }>> = {};
  if (view === "akses") {
    for (const { e, ll } of elsWithLL) {
      const hw = e.tags?.highway ?? "";
      const tier =
        /^motorway|trunk|primary/.test(hw) ? "primary" :
        /^secondary/.test(hw) ? "secondary" :
        /^tertiary/.test(hw) ? "tertiary" :
        /^residential|unclassified|service/.test(hw) ? "residential" : null;
      if (!tier) continue;
      const arr = roadsByTier[tier] ?? (roadsByTier[tier] = []);
      arr.push({
        name: e.tags?.name ?? `(jalan ${hw})`,
        dist: distMeters(lat, lon, ll.lat, ll.lon),
        ll,
      });
    }
  }

  // Fasilitas: closest 3 per category and radius ring counts.
  const facsByCat = POI_CATS.map((c) => {
    const items: Array<{ name: string; dist: number; ll: { lat: number; lon: number } }> = [];
    if (view === "fasilitas") {
      for (const { e, ll } of elsWithLL) {
        const tags = e.tags ?? {};
        const m =
          (c.key === "edu" && /school|university|college|kindergarten/.test(tags.amenity ?? "")) ||
          (c.key === "med" && /hospital|clinic|doctors|pharmacy/.test(tags.amenity ?? "")) ||
          (c.key === "shop" && (tags.shop || /marketplace|mall/.test(tags.amenity ?? ""))) ||
          (c.key === "food" && /restaurant|cafe|fast_food|food_court/.test(tags.amenity ?? "")) ||
          (c.key === "trans" && (tags.highway === "bus_stop" || /station|halt/.test(tags.railway ?? "") || tags.amenity === "bus_station")) ||
          (c.key === "wor" && tags.amenity === "place_of_worship");
        if (!m) continue;
        items.push({
          name: tags.name ?? `(${c.label.toLowerCase()})`,
          dist: distMeters(lat, lon, ll.lat, ll.lon),
          ll,
        });
      }
    }
    items.sort((a, b) => a.dist - b.dist);
    return { cat: c, items };
  });

  // Lingkungan: split blue & green ways.
  const greenWays: OverpassEl[] = [];
  const blueWays: OverpassEl[] = [];
  if (view === "lingkungan") {
    for (const e of els) {
      const t = e.tags ?? {};
      const isBlue = t.natural === "water" || t.waterway || /water/.test(t.landuse ?? "");
      if (isBlue) blueWays.push(e); else greenWays.push(e);
    }
  }
  const greenAreaApprox = greenWays.length; // count proxy
  const blueAreaApprox = blueWays.length;

  // ---------- Render ----------
  return (
    <div style={{ display: "flex", gap: 28, width: "100%", height: "100%" }}>
      {/* Kiri: peta */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ border: "1px solid #111", padding: 10, position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700, marginBottom: 6 }}>
            Peta · {lat.toFixed(4)}°, {lon.toFixed(4)}° · radius {radiusM} m
          </div>
          <div style={{ position: "relative", width: MAP_W, height: MAP_H, alignSelf: "center" }}>
            <SiteMapCanvas lat={lat} lon={lon} radiusM={radiusM} width={MAP_W} height={MAP_H}
              grayscale={view !== "lingkungan"} opacity={0.95} />
            <svg viewBox={`-${MAP_W / 2} -${MAP_H / 2} ${MAP_W} ${MAP_H}`}
              style={{ position: "absolute", inset: 0, width: MAP_W, height: MAP_H }}
              preserveAspectRatio="none">
              {/* Radius rings (fasilitas/lingkungan/akses) */}
              {view !== "lokasi" && [250, 500, 800].filter((r) => r <= radiusM).map((r) => (
                <g key={r}>
                  <circle cx={0} cy={0} r={r * pxPerM} fill="none" stroke="#0a0a0a"
                    strokeOpacity={0.7} strokeDasharray="8 4" strokeWidth={1.6} />
                  <text x={0} y={-r * pxPerM - 6} textAnchor="middle" fontSize={13} fontWeight={700}
                    fill="#0a0a0a" fontFamily="Sora, sans-serif"
                    style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 4 } as React.CSSProperties}>
                    {r} m
                  </text>
                </g>
              ))}

              {/* Akses: jalan + label tier */}
              {view === "akses" && elsWithLL.map(({ e, ll }) => {
                const hw = e.tags?.highway ?? "";
                const tier = roadTiers.find((t) =>
                  (t.key === "primary" && /^motorway|trunk|primary/.test(hw)) ||
                  (t.key === "secondary" && /^secondary/.test(hw)) ||
                  (t.key === "tertiary" && /^tertiary/.test(hw)) ||
                  (t.key === "residential" && /^residential|unclassified|service/.test(hw))
                );
                if (!tier) return null;
                const p = projectM(lat, lon, ll.lat, ll.lon);
                return (
                  <circle key={e.id} cx={p.x * pxPerM} cy={p.y * pxPerM} r={3} fill={tier.color}
                    stroke="#fff" strokeWidth={1} />
                );
              })}

              {/* Fasilitas: titik POI berwarna per kategori */}
              {view === "fasilitas" && facsByCat.flatMap(({ cat, items }) =>
                items.map((it) => {
                  const p = projectM(lat, lon, it.ll.lat, it.ll.lon);
                  return (
                    <circle key={`${cat.key}-${it.ll.lat}-${it.ll.lon}`}
                      cx={p.x * pxPerM} cy={p.y * pxPerM} r={4}
                      fill={cat.color} stroke="#0a0a0a" strokeWidth={0.8} />
                  );
                })
              )}

              {/* Lingkungan: hijau & biru sebagai titik */}
              {view === "lingkungan" && elsWithLL.map(({ e, ll }) => {
                const t = e.tags ?? {};
                const isBlue = t.natural === "water" || t.waterway || /water/.test(t.landuse ?? "");
                const p = projectM(lat, lon, ll.lat, ll.lon);
                return (
                  <circle key={e.id} cx={p.x * pxPerM} cy={p.y * pxPerM} r={5}
                    fill={isBlue ? "rgba(45,108,223,0.55)" : "rgba(31,157,85,0.55)"}
                    stroke={isBlue ? "#2d6cdf" : "#1f9d55"} strokeWidth={1} />
                );
              })}

              {/* Site footprint overlay */}
              {sitePolys.map((poly, i) => (
                <polygon key={i}
                  points={poly.pts.map((p) => `${p.x * pxPerM},${p.y * pxPerM}`).join(" ")}
                  fill={poly.color} stroke={poly.stroke} strokeWidth={1.5} />
              ))}
              {/* Marker pusat */}
              <g>
                <circle cx={0} cy={0} r={7} fill="#e85d3a" stroke="#0a0a0a" strokeWidth={1.5} />
                <circle cx={0} cy={0} r={2} fill="#0a0a0a" />
              </g>
            </svg>
            <SlideCompass rotation={0} size={68} />
            {!data && !err && (
              <div style={{ position: "absolute", left: 10, bottom: 10, fontSize: 10, color: "#666",
                background: "rgba(255,255,255,0.85)", padding: "3px 8px", border: "1px solid #ddd" }}>
                Memuat data OpenStreetMap…
              </div>
            )}
            {err && (
              <div style={{ position: "absolute", left: 10, bottom: 10, fontSize: 10, color: "#c0392b",
                background: "rgba(255,255,255,0.9)", padding: "3px 8px", border: "1px solid #c0392b" }}>
                Data Overpass gagal dimuat — coba ulang slide.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, color: "#444", flexWrap: "wrap" }}>
            <LegendDot color="#e85d3a" label="Posisi tapak" />
            {view === "akses" && roadTiers.map((t) => <LegendDot key={t.key} color={t.color} label={`Jl. ${t.label}`} />)}
            {view === "fasilitas" && POI_CATS.map((c) => <LegendDot key={c.key} color={c.color} label={c.label} />)}
            {view === "lingkungan" && (<>
              <LegendDot color="#1f9d55" label="Ruang hijau" />
              <LegendDot color="#2d6cdf" label="Badan air" />
            </>)}
            <span style={{ color: "#888" }}>· © OpenStreetMap contributors</span>
          </div>
        </div>
      </div>

      {/* Kanan: narasi & data */}
      <div style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <BigStat
          label="Koordinat"
          value={geo?.locked ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : `${lat.toFixed(4)}°, ${lon.toFixed(4)}° (belum dikunci)`}
          hint={geo?.label || "Set di Sketsa → Lokasi & Peta"}
        />

        {view === "lokasi" && <LokasiPanel sketch={sketch} lahanCount={lahanAll.length} buildCount={buildAll.length} mPerSPx={mPerSPx} />}
        {view === "akses" && <AksesPanel roadTiers={roadTiers} roadsByTier={roadsByTier} />}
        {view === "fasilitas" && <FasilitasPanel facsByCat={facsByCat} />}
        {view === "lingkungan" && <LingkunganPanel greenN={greenAreaApprox} blueN={blueAreaApprox} radius={radius} />}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 999, background: color, border: "1px solid rgba(0,0,0,0.35)" }} />
      {label}
    </span>
  );
}

function LokasiPanel({ sketch, lahanCount, buildCount, mPerSPx }: {
  sketch: Sketch; lahanCount: number; buildCount: number; mPerSPx: number;
}) {
  const lahanM2 = (sketch.layers ?? []).filter((l) => isLahan(l.name)).reduce((s, l) => s + (l.areaM2 || 0), 0);
  const buildM2 = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name)).reduce((s, l) => s + (l.areaM2 || 0), 0);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <BigStat label="Luas Lahan" value={`${fmt(lahanM2)} m²`} hint={`${lahanCount} polygon`} />
        <BigStat label="Tapak Bangun" value={`${fmt(buildM2)} m²`} hint={`${buildCount} massa`} />
      </div>
      <div style={{ border: "1px solid #0a0a0a", background: "#0a0a0a", color: "#fff", padding: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#e85d3a", fontWeight: 800, marginBottom: 6 }}>
          Konteks Lokasi
        </div>
        <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 20, lineHeight: 1.25, fontWeight: 600, marginBottom: 6 }}>
          {sketch.geo?.label || "Lokasi tapak"}
        </div>
        <div style={{ fontSize: 12, color: "#cfcfcf", lineHeight: 1.5 }}>
          Marker oranye menandai pusat tapak pada peta OpenStreetMap. Outline polygon tapak diproyeksikan
          presisi sesuai skala sketsa ({sketch.scale}, 1 px ≈ {mPerSPx.toFixed(3)} m) dan arah utara denah.
        </div>
      </div>
    </>
  );
}

function AksesPanel({ roadTiers, roadsByTier }: {
  roadTiers: Array<{ key: string; label: string; color: string }>;
  roadsByTier: Record<string, Array<{ name: string; dist: number; ll: { lat: number; lon: number } }>>;
}) {
  return (
    <div style={{ border: "1px solid #111", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700 }}>
        Jalan Terdekat per Tier
      </div>
      {roadTiers.map((t) => {
        const arr = (roadsByTier[t.key] ?? []).sort((a, b) => a.dist - b.dist).slice(0, 3);
        const nearest = arr[0];
        return (
          <div key={t.key} style={{ borderTop: "1px solid #eee", paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: t.color }} />
                Jl. {t.label}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: nearest ? "#0a0a0a" : "#999", fontWeight: 700 }}>
                {nearest ? `${Math.round(nearest.dist)} m` : "—"}
              </span>
            </div>
            {arr.length > 0 ? (
              <div style={{ fontSize: 11, color: "#555", marginTop: 4, lineHeight: 1.4 }}>
                {arr.map((r, i) => (
                  <div key={i}>• {r.name} — {Math.round(r.dist)} m</div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Tidak ada dalam radius.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FasilitasPanel({ facsByCat }: {
  facsByCat: Array<{ cat: { key: string; label: string; color: string }; items: Array<{ name: string; dist: number }> }>;
}) {
  return (
    <div style={{ border: "1px solid #111", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700 }}>
        Fasilitas Terdekat (3 per kategori)
      </div>
      {facsByCat.map(({ cat, items }) => {
        const top = items.slice(0, 3);
        return (
          <div key={cat.key} style={{ borderTop: "1px solid #eee", paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: cat.color }} />
                {cat.label}
              </span>
              <span style={{ fontSize: 11, color: "#888" }}>{items.length} titik</span>
            </div>
            {top.length > 0 ? (
              <div style={{ fontSize: 11, color: "#555", marginTop: 4, lineHeight: 1.4 }}>
                {top.map((it, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {it.name}</span>
                    <span style={{ color: "#0a0a0a", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{Math.round(it.dist)} m</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>—</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LingkunganPanel({ greenN, blueN, radius }: { greenN: number; blueN: number; radius: number }) {
  const total = greenN + blueN;
  const greenPct = total > 0 ? Math.round((greenN / total) * 100) : 0;
  const bluePct = total > 0 ? 100 - greenPct : 0;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <BigStat label="Ruang hijau" value={String(greenN)} hint="elemen OSM" />
        <BigStat label="Badan air" value={String(blueN)} hint="elemen OSM" />
      </div>
      <div style={{ border: "1px solid #111", padding: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700, marginBottom: 8 }}>
          Komposisi Blue–Green (radius {radius} m)
        </div>
        <div style={{ height: 14, background: "#eee", display: "flex", overflow: "hidden", borderRadius: 2 }}>
          <div style={{ width: `${greenPct}%`, background: "#1f9d55" }} />
          <div style={{ width: `${bluePct}%`, background: "#2d6cdf" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", marginTop: 6 }}>
          <span>🟩 Hijau {greenPct}%</span>
          <span>🟦 Biru {bluePct}%</span>
        </div>
      </div>
      <div style={{ border: "1px solid #0a0a0a", background: "#0a0a0a", color: "#fff", padding: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#e85d3a", fontWeight: 800, marginBottom: 6 }}>
          Catatan Lalu Lintas
        </div>
        <div style={{ fontSize: 12, color: "#cfcfcf", lineHeight: 1.5 }}>
          Kepadatan lalu lintas didekati dari kerapatan jalan tier primer/sekunder di sekitar tapak
          (lihat slide Akses). Untuk data real-time, integrasikan layer Mapillary atau survei lapangan.
          Ruang hijau & badan air diturunkan dari tag <em>leisure/landuse/natural/waterway</em> OpenStreetMap.
        </div>
      </div>
    </>
  );
}

function KonsepBody({ slide }: { slide: Extract<Slide, { kind: "konsep" }> }) {

  const imgs = slide.narasi.images.filter((s): s is string => typeof s === "string" && s.length > 0);
  const text = slide.narasi.text.trim();
  // Pisahkan judul gagasan (baris pertama) dengan badan narasi.
  const firstBreak = text.indexOf("\n");
  const heading = firstBreak === -1 ? text : text.slice(0, firstBreak).trim();
  const body = firstBreak === -1 ? "" : text.slice(firstBreak + 1).trim();

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "stretch" }}>
      {/* Kiri: narasi */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingRight: 8, minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: "#888", fontWeight: 600 }}>
          Gagasan Utama · Narasi {slide.index + 1}
        </div>
        {heading && (
          <div
            style={{
              fontFamily: "var(--font-display, Sora, sans-serif)",
              fontSize: 30,
              lineHeight: 1.2,
              color: "#0a0a0a",
              fontWeight: 700,
              letterSpacing: "-0.01em",
              wordBreak: "break-word",
            }}
          >
            {heading}
          </div>
        )}
        <div
          style={{
            fontFamily: "var(--font-body, Manrope, sans-serif)",
            fontSize: 16,
            lineHeight: 1.55,
            color: text ? "#222" : "#bbb",
            fontWeight: 400,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {body || (heading ? "" : "Tulis gagasan utama narasi di halaman Narasi.")}
        </div>
      </div>

      {/* Kanan: gambar persegi dalam satu deret horizontal */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
        {imgs.length === 0 ? (
          <div
            style={{
              aspectRatio: "1 / 1",
              width: "100%",
              border: "1px dashed #bbb",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#999",
              fontSize: 13,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              textAlign: "center",
              padding: 12,
            }}
          >
            Unggah gambar di halaman Narasi
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${imgs.length}, 1fr)`,
              gap: 12,
              width: "100%",
            }}
          >
            {imgs.map((src, i) => (
              <div
                key={i}
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1 / 1",
                  border: "1px solid #e5e5e5",
                  borderRadius: 6,
                  overflow: "hidden",
                  background: "#f5f5f5",
                }}
              >
                <img
                  src={src}
                  alt={`Konsep ${slide.index + 1} gambar ${i + 1}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}



function MatahariBody({ slide }: { slide: Extract<Slide, { kind: "matahari" }> }) {
  const { sketch, bounds } = slide;
  const geo = sketch.geo;
  const northDeg = effectiveNorthDeg(sketch);
  const lat = geo?.lat ?? -6.2;
  const lon = geo?.lon ?? 106.816666;
  // Use equinox (≈ 21 Maret) sebagai dasar analisis tahunan netral.
  const baseDate = new Date(new Date().getFullYear(), 2, 21, 12, 0, 0);
  const times = SunCalc.getTimes(baseDate, lat, lon);
  const sunPos = (hour: number) => {
    const d = new Date(baseDate);
    d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    const p = SunCalc.getPosition(d, lat, lon);
    // SunCalc azimuth: 0 = south, +CW. Convert to north-CW (azimuth nyata).
    const azNorthCW = (p.azimuth + Math.PI) * (180 / Math.PI);
    // Konversi ke sudut pada frame sketsa: Utara nyata berada di sudut
    // `northDeg` (= mapRotation) dari sketsa-atas, jadi az_sketch = az_real + northDeg.
    const az = ((azNorthCW + northDeg) % 360 + 360) % 360;
    const alt = (p.altitude * 180) / Math.PI;
    return { az, alt };
  };
  const hours = [6, 8, 10, 12, 14, 16, 18];
  const path = hours.map((h) => ({ h, ...sunPos(h) })).filter((p) => p.alt > 0);
  const noon = sunPos(12);
  // Build a hemispherical "sun path" diagram (top-down, 0° utara).
  const R = 230;
  const cx = 260, cy = 260;
  const pt = (az: number, alt: number) => {
    const r = R * (1 - Math.max(0, Math.min(90, alt)) / 90);
    const a = (az - 90) * (Math.PI / 180); // 0°=utara → atas
    return { x: cx + r * Math.cos(a + Math.PI / 2), y: cy - r * Math.sin(a + Math.PI / 2) };
  };
  const pathPts = path.map((p) => pt(p.az, p.alt));
  // Orientasi bukaan: di Indonesia (tropis), sisi N/S menerima beban termal terendah,
  // sisi B (barat) tertinggi karena matahari sore. Rekomendasi disesuaikan dengan lat.
  const facadeRanking: Array<{ label: string; az: number; load: "rendah" | "sedang" | "tinggi"; note: string }> = [
    { label: "Utara", az: 0, load: lat < 0 ? "rendah" : "tinggi", note: lat < 0 ? "Sinar miring sepanjang tahun, ideal bukaan lebar." : "Beban tinggi pada musim panas; gunakan shading horizontal." },
    { label: "Timur", az: 90, load: "sedang", note: "Sinar pagi hangat & lembut, baik untuk ruang aktif pagi." },
    { label: "Selatan", az: 180, load: lat < 0 ? "tinggi" : "rendah", note: lat < 0 ? "Beban tertinggi tengah hari; pertimbangkan louvre vertikal." : "Bukaan terbesar dengan overhang sedang sangat ideal." },
    { label: "Barat", az: 270, load: "tinggi", note: "Silau & panas sore; minimalkan bukaan atau pakai secondary skin." },
  ];
  const best = facadeRanking.filter((f) => f.load === "rendah").map((f) => f.label).join(" & ") || "Utara & Timur";
  const avoid = facadeRanking.filter((f) => f.load === "tinggi").map((f) => f.label).join(" & ") || "Barat";

  // Build a top-down silhouette of all building footprints (union seperti stacking).
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
  const buildLayers = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name));
  const lahanAll = (sketch.layers ?? []).filter((l) => isLahan(l.name));
  const fmtTime = (d: Date) => d && !isNaN(d.getTime())
    ? `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`
    : "—";
  const daylight = times.sunrise && times.sunset
    ? ((times.sunset.getTime() - times.sunrise.getTime()) / 3.6e6).toFixed(2) + " jam"
    : "—";

  return (
    <div style={{ display: "flex", gap: 28, width: "100%", height: "100%" }}>
      {/* Kiri: diagram sun-path + silhouette denah dengan panah matahari */}
      <div style={{ flex: 1.1, minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ border: "1px solid #111", padding: 12, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700, marginBottom: 6 }}>
            Sun Path · Equinox 21 Mar · {lat.toFixed(3)}°, {lon.toFixed(3)}°
          </div>
          <svg viewBox="0 0 520 520" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", flex: 1 }}>
            {/* hemisphere rings */}
            {[0, 30, 60].map((a) => (
              <circle key={a} cx={cx} cy={cy} r={R * (1 - a / 90)} fill="none" stroke="#e5e5e5" strokeWidth={1} />
            ))}
            {/* cardinal axes */}
            <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="#cfcfcf" />
            <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="#cfcfcf" />
            <text x={cx} y={cy - R - 8} textAnchor="middle" fontSize={14} fontWeight={700} fill="#0a0a0a">U</text>
            <text x={cx} y={cy + R + 18} textAnchor="middle" fontSize={14} fontWeight={700} fill="#666">S</text>
            <text x={cx + R + 12} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#666">T</text>
            <text x={cx - R - 12} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#666">B</text>
            {/* sun path arc */}
            {pathPts.length >= 2 && (
              <polyline
                points={pathPts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#e85d3a"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            )}
            {path.map((p, i) => {
              const q = pathPts[i];
              return (
                <g key={p.h}>
                  <circle cx={q.x} cy={q.y} r={5} fill="#e85d3a" stroke="#0a0a0a" strokeWidth={1.2} />
                  <text x={q.x + 8} y={q.y - 6} fontSize={11} fontWeight={700} fill="#0a0a0a">{String(p.h).padStart(2, "0")}.00</text>
                </g>
              );
            })}
            {/* noon highlight */}
            {noon.alt > 0 && (() => {
              const q = pt(noon.az, noon.alt);
              return (
                <g>
                  <line x1={cx} y1={cy} x2={q.x} y2={q.y} stroke="#0a0a0a" strokeWidth={1} strokeDasharray="3 3" />
                  <text x={cx + 6} y={cy - 8} fontSize={10} fill="#666">Solar noon: {noon.alt.toFixed(0)}° / az {noon.az.toFixed(0)}°</text>
                </g>
              );
            })()}
          </svg>
        </div>
        {/* Denah ringkas dengan panah matahari noon */}
        <div style={{ border: "1px solid #111", padding: 12, height: 260, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700, marginBottom: 6 }}>
            Tapak · Arah matahari tengah hari
          </div>
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
            <svg viewBox={`${bounds.minX} ${bounds.minY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", display: "block" }}>
              {lahanAll.map((l) => (
                <polygon key={l.id} points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="rgba(0,0,0,0.04)" stroke="rgba(0,0,0,0.45)"
                  strokeWidth={Math.max(w, h) * 0.0015}
                  strokeDasharray={`${Math.max(w, h) * 0.006} ${Math.max(w, h) * 0.004}`} />
              ))}
              {buildLayers.map((l) => (
                <polygon key={l.id} points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="rgba(232,93,58,0.18)" stroke="#0a0a0a"
                  strokeWidth={Math.max(w, h) * 0.0018} />
              ))}
              {/* matahari arrows for 09, 12, 15 */}
              {[9, 12, 15].map((hh) => {
                const sp = sunPos(hh);
                if (sp.alt <= 0) return null;
                const cxw = (bounds.minX + bounds.maxX) / 2;
                const cyw = (bounds.minY + bounds.maxY) / 2;
                const len = Math.max(w, h) * 0.42;
                // az 0 = utara (y- pada kanvas). dx = sin(az), dy = -cos(az)
                const ar = (sp.az * Math.PI) / 180;
                // matahari berada DI arah az; sinar datang dari arah itu → panah menunjuk ke pusat
                const sx = cxw + Math.sin(ar) * len;
                const sy = cyw - Math.cos(ar) * len;
                const color = hh === 12 ? "#e85d3a" : "#0a0a0a";
                return (
                  <g key={hh}>
                    <line x1={sx} y1={sy} x2={cxw} y2={cyw} stroke={color} strokeWidth={Math.max(w, h) * 0.0025}
                      markerEnd={`url(#sun-arrow-${hh})`} />
                    <text x={sx} y={sy} fontSize={Math.max(w, h) * 0.025} fontWeight={700} fill={color}
                      textAnchor="middle" dominantBaseline="central"
                      style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.9)", strokeWidth: Math.max(w, h) * 0.012 } as React.CSSProperties}>
                      {hh}.00
                    </text>
                    <defs>
                      <marker id={`sun-arrow-${hh}`} viewBox="0 0 10 10" refX="9" refY="5"
                        markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M0,0 L10,5 L0,10 z" fill={color} />
                      </marker>
                    </defs>
                  </g>
                );
              })}
            </svg>
            <SlideCompass rotation={northDeg} size={72} />
          </div>
        </div>
      </div>

      {/* Kanan: ringkasan data + rekomendasi bukaan */}
      <div style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <BigStat
          label="Koordinat"
          value={geo?.locked ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : "Belum dikunci"}
          hint={geo?.label || "Set di Sketsa → Lokasi & Peta"}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <BigStat label="Terbit" value={fmtTime(times.sunrise)} />
          <BigStat label="Tenggelam" value={fmtTime(times.sunset)} />
          <BigStat label="Solar noon" value={fmtTime(times.solarNoon)} hint={`alt ${noon.alt.toFixed(0)}°`} />
          <BigStat label="Durasi siang" value={daylight} />
        </div>
        <div style={{ border: "1px solid #111", padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700, marginBottom: 8 }}>
            Beban Termal per Fasad
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {facadeRanking.map((f) => {
              const dot = f.load === "rendah" ? "#1f9d55" : f.load === "sedang" ? "#d6a423" : "#c0392b";
              return (
                <div key={f.label} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, lineHeight: 1.35 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: dot, marginTop: 4, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#0a0a0a" }}>
                      {f.label} <span style={{ color: "#888", fontWeight: 500 }}>· beban {f.load}</span>
                    </div>
                    <div style={{ color: "#444" }}>{f.note}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ border: "1px solid #0a0a0a", background: "#0a0a0a", color: "#fff", padding: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#e85d3a", fontWeight: 800, marginBottom: 6 }}>
            Usulan Bukaan
          </div>
          <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 22, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 6 }}>
            Maksimalkan ke <span style={{ color: "#e85d3a" }}>{best}</span>
          </div>
          <div style={{ fontSize: 12, color: "#cfcfcf", lineHeight: 1.45 }}>
            Hindari bukaan lebar di sisi <strong style={{ color: "#fff" }}>{avoid}</strong>. Gunakan shading horizontal untuk Utara/Selatan dan louvre vertikal / secondary skin pada Barat. Orientasi memanjang bangunan disarankan sejajar sumbu Timur–Barat agar fasad terbesar menghadap U/S.
          </div>
        </div>
        {!geo?.locked && (
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>
            Catatan: koordinat default Jakarta digunakan. Kunci koordinat di halaman <strong>Sketsa → Lokasi & Peta</strong> untuk analisis presisi.
          </div>
        )}
      </div>
    </div>
  );
}


function centroid(pts: Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

const DEFAULT_GSB_M_PRES = 4;
function getLayerGsbM(layer: Layer, i: number): number {
  const v = layer.gsb?.[i];
  return Number.isFinite(v) && (v as number) >= 0 ? (v as number) : DEFAULT_GSB_M_PRES;
}
function pointInPolyPres(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function inwardOffsetSegPx(pts: Point[], i: number, distPx: number): { a: Point; b: Point; mid: Point } {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len, ny = dx / len;
  const probe = { x: (a.x + b.x) / 2 + nx * 0.5, y: (a.y + b.y) / 2 + ny * 0.5 };
  if (!pointInPolyPres(probe, pts)) { nx = -nx; ny = -ny; }
  return {
    a: { x: a.x + nx * distPx, y: a.y + ny * distPx },
    b: { x: b.x + nx * distPx, y: b.y + ny * distPx },
    mid: { x: (a.x + b.x) / 2 + nx * distPx, y: (a.y + b.y) / 2 + ny * distPx },
  };
}

function convexHull(pts: Point[]): Point[] {
  const ps = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (ps.length < 3) return ps.slice();
  const sorted = [...ps].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}



function linePath(ln: Line): string {
  const kind = ln.kind ?? "straight";
  if (kind === "straight") return `M ${ln.a.x} ${ln.a.y} L ${ln.b.x} ${ln.b.y}`;
  if (kind === "arc") {
    const mid = { x: (ln.a.x + ln.b.x) / 2, y: (ln.a.y + ln.b.y) / 2 };
    const dx = ln.b.x - ln.a.x, dy = ln.b.y - ln.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const bulge = ln.bulge ?? 0;
    const cx = mid.x + 2 * nx * bulge;
    const cy = mid.y + 2 * ny * bulge;
    return `M ${ln.a.x} ${ln.a.y} Q ${cx} ${cy} ${ln.b.x} ${ln.b.y}`;
  }
  const c1 = ln.c1 ?? ln.a;
  const c2 = ln.c2 ?? ln.b;
  return `M ${ln.a.x} ${ln.a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${ln.b.x} ${ln.b.y}`;
}

// ---- Stacking Diagram (from Model 3D data) ----
function levelColor(i: number, total: number) {
  // Warm-to-cool gradient, deterministic per level index.
  const hue = 18 + (i / Math.max(1, total - 1)) * 200;
  return `hsl(${hue.toFixed(0)}, 62%, 52%)`;
}

function shadeHsl(hsl: string, deltaL: number) {
  const m = hsl.match(/hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)/);
  if (!m) return hsl;
  const L = Math.max(0, Math.min(100, parseFloat(m[3]) + deltaL));
  return `hsl(${m[1]}, ${m[2]}%, ${L.toFixed(0)}%)`;
}

const STACK_MAJOR_M: Record<string, number> = {
  "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10,
};
function stackMetersPerPx(scale: string) {
  // matches sketch grid: 8px minor × 10 minors per major
  return (STACK_MAJOR_M[scale] ?? 1) / 80;
}

// Axonometric (isometric-style) projection of stacked floors.
function AxonometricView({
  sketch,
  colorOf,
}: {
  sketch: Sketch;
  colorOf: (levelId: string) => string;
}) {
  const mPerPx = stackMetersPerPx(sketch.scale);
  const ascLevels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);

  if (ascLevels.length === 0) {
    return (
      <div style={{ color: "#999", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        Belum ada level untuk diproyeksikan.
      </div>
    );
  }

  const expanded = expandLevelsForView(ascLevels);
  const baseMdpl = expanded[0]?.mdpl ?? 0;
  const withH = expanded.map((f) => ({
    id: f.id,
    sourceId: f.sourceId,
    base: f.mdpl - baseMdpl,
    height: f.height,
  }));

  // Plan origin = bbox centroid of all layer points (in px space)
  let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity;
  for (const l of sketch.layers ?? []) {
    for (const p of l.points) {
      if (p.x < minPx) minPx = p.x;
      if (p.y < minPy) minPy = p.y;
      if (p.x > maxPx) maxPx = p.x;
      if (p.y > maxPy) maxPy = p.y;
    }
  }
  if (!Number.isFinite(minPx)) { minPx = 0; minPy = 0; maxPx = 0; maxPy = 0; }
  const ox = (minPx + maxPx) / 2;
  const oy = (minPy + maxPy) / 2;

  // Isometric projection: x→right, z→back, y→up
  const COS = Math.cos(Math.PI / 6); // 0.866
  const SIN = Math.sin(Math.PI / 6); // 0.5
  const project = (mx: number, mz: number, my: number) => ({
    x: (mx - mz) * COS,
    y: (mx + mz) * SIN - my,
  });

  type Face = {
    pts: { x: number; y: number }[];
    fill: string;
    stroke: string;
    depth: number;
    sw: number;
  };
  const faces: Face[] = [];

  const lahan = (sketch.layers ?? []).filter((l) => isLahan(l.name));
  const build = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name));

  // Ground plane (lahan) at y=0
  for (const ly of lahan) {
    const pm = ly.points.map((p) => ({ x: (p.x - ox) * mPerPx, z: (p.y - oy) * mPerPx }));
    const top = pm.map((p) => project(p.x, p.z, 0));
    const avg = pm.reduce((s, p) => s + p.x + p.z, 0) / Math.max(1, pm.length);
    faces.push({ pts: top, fill: "#efeae1", stroke: "#a8a195", depth: avg - 100000, sw: 0.4 });
  }

  // Floors
  for (const lv of withH) {
    const top = colorOf(lv.sourceId);
    const side = shadeHsl(top, -18);
    const layers = build.filter((l) => l.levelId === lv.sourceId);
    for (const ly of layers) {
      const pm = ly.points.map((p) => ({ x: (p.x - ox) * mPerPx, z: (p.y - oy) * mPerPx }));
      if (pm.length < 3) continue;
      const yBot = lv.base;
      const yTop = lv.base + lv.height;
      // Side quads
      for (let i = 0; i < pm.length; i++) {
        const a = pm[i];
        const b = pm[(i + 1) % pm.length];
        const quad = [
          project(a.x, a.z, yBot),
          project(b.x, b.z, yBot),
          project(b.x, b.z, yTop),
          project(a.x, a.z, yTop),
        ];
        const depth = (a.x + b.x + a.z + b.z) / 2 + yBot * 0.01;
        faces.push({ pts: quad, fill: side, stroke: "rgba(0,0,0,0.45)", depth, sw: 0.5 });
      }
      // Top face
      const topPts = pm.map((p) => project(p.x, p.z, yTop));
      const avg = pm.reduce((s, p) => s + p.x + p.z, 0) / pm.length;
      faces.push({
        pts: topPts,
        fill: top,
        stroke: "rgba(0,0,0,0.55)",
        depth: avg + yTop * 100 + 1,
        sw: 0.7,
      });
    }
  }

  faces.sort((a, b) => a.depth - b.depth);

  // Compute viewBox
  let vx0 = Infinity, vy0 = Infinity, vx1 = -Infinity, vy1 = -Infinity;
  for (const f of faces) for (const p of f.pts) {
    if (p.x < vx0) vx0 = p.x;
    if (p.y < vy0) vy0 = p.y;
    if (p.x > vx1) vx1 = p.x;
    if (p.y > vy1) vy1 = p.y;
  }
  if (!Number.isFinite(vx0)) { vx0 = -10; vy0 = -10; vx1 = 10; vy1 = 10; }
  const w = vx1 - vx0;
  const h = vy1 - vy0;
  const pad = Math.max(w, h, 1) * 0.06;
  const vb = `${vx0 - pad} ${vy0 - pad} ${w + pad * 2} ${h + pad * 2}`;
  const baseStroke = Math.max(w, h) * 0.0015;

  return (
    <svg
      viewBox={vb}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      {faces.map((f, i) => (
        <polygon
          key={i}
          points={f.pts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill={f.fill}
          stroke={f.stroke}
          strokeWidth={baseStroke * f.sw * 2}
          strokeLinejoin="round"
          opacity={1}
          fillOpacity={1}
        />
      ))}
    </svg>
  );
}

function StackingBody({ sketch }: { sketch: Sketch }) {
  const levelsAsc = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const build = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name));
  const displayNames = computeLevelDisplayNames(levelsAsc);

  // Color map keyed by source level id (matches axonometric)
  const colorMap = new Map<string, string>();
  levelsAsc.forEach((lv, i) => colorMap.set(lv.id, levelColor(i, levelsAsc.length)));
  const colorOf = (id: string) => colorMap.get(id) ?? "#888";

  // Expand into visible floors so typical copies appear as separate bars.
  const expanded = expandLevelsForView(levelsAsc);
  const expandedDesc = [...expanded].reverse();
  const totalFloors = expanded.length;
  const ketinggian = expanded.length
    ? expanded[expanded.length - 1].mdpl + expanded[expanded.length - 1].height - expanded[0].mdpl
    : 0;

  const rows = expandedDesc.map((f) => {
    const items = build.filter((l) => l.levelId === f.sourceId);
    const area = items.reduce((s, l) => s + (l.areaM2 || 0), 0);
    const baseName = displayNames[f.sourceId] ?? f.name;
    const label = f.typicalTotal > 1
      ? `${baseName} · tip ${f.typicalIndex + 1}/${f.typicalTotal}`
      : baseName;
    return { id: f.id, sourceId: f.sourceId, label, mdpl: f.mdpl, area, color: colorOf(f.sourceId) };
  });
  const maxArea = Math.max(1, ...rows.map((r) => r.area));
  const totalArea = rows.reduce((s, r) => s + r.area, 0);

  return (
    <div style={{ display: "flex", gap: 28, width: "100%", height: "100%", alignItems: "stretch" }}>
      {/* Aksonometrik 3D */}
      <div style={{ width: 720, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: "#777", fontWeight: 600, marginBottom: 8 }}>
          Aksonometrik · Model 3D
        </div>
        <div style={{ flex: 1, minHeight: 0, border: "1px solid #ececec", background: "#fafafa", padding: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <AxonometricView sketch={sketch} colorOf={colorOf} />
        </div>
        <div style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#999", marginTop: 6 }}>
          Proyeksi isometrik 30° · skala {sketch.scale}
        </div>
      </div>

      {/* Stack visual */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
        {rows.length === 0 && (
          <div style={{ color: "#999", fontSize: 14 }}>Belum ada level untuk ditampilkan.</div>
        )}
        {rows.map((r) => {
          const widthPct = 14 + (r.area / maxArea) * 86;
          return (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36 }}>
              <div style={{ width: 62, textAlign: "right", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#777", fontVariantNumeric: "tabular-nums" }}>
                {fmt(r.mdpl, 1)} m
              </div>
              <div style={{ flex: 1, position: "relative", height: 36 }}>
                <div
                  style={{
                    width: `${widthPct}%`,
                    height: "100%",
                    background: r.color,
                    border: "1px solid rgba(0,0,0,0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 12px",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <span style={{ fontFamily: "var(--font-display, Sora, sans-serif)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.label}
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>
                    {fmt(r.area)} m²
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
          <div style={{ width: 62 }} />
          <div style={{ flex: 1, borderTop: "1px solid #111" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 62, textAlign: "right", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#888" }}>
            MDPL
          </div>
          <div style={{ flex: 1, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#888" }}>
            Tanah / Permukaan Acuan
          </div>
        </div>
      </div>

      {/* Legend & summary */}
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: "#777", fontWeight: 600, marginBottom: 8 }}>
            Legenda Level
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {levelsAsc.slice().reverse().map((lv) => {
              const baseArea = build
                .filter((l) => l.levelId === lv.id)
                .reduce((s, l) => s + (l.areaM2 || 0), 0);
              const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
              const total = baseArea * k;
              const pct = totalArea > 0 ? (total / totalArea) * 100 : 0;
              const name = displayNames[lv.id] ?? lv.name;
              return (
                <div key={lv.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ width: 12, height: 12, background: colorOf(lv.id), border: "1px solid rgba(0,0,0,0.25)", flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}{k > 1 ? ` · ${k}×` : ""}
                  </span>
                  <span style={{ color: "#888", fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
                    {fmt(pct, 1)}%
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 70, textAlign: "right" }}>
                    {fmt(total)} m²
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <BigStat label="Jumlah Lapis" value={String(totalFloors)} />
        <BigStat label="Total Luas" value={`${fmt(totalArea)} m²`} hint="tanpa Lahan & Void" />
        <BigStat label="Ketinggian" value={`${fmt(ketinggian, 1)} m`} hint="termasuk tipikal" />
      </div>
    </div>
  );
}


// ---- Modern tiles ----
function BigStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: "18px 20px", borderTop: "1px solid #111", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: "#777", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", color: "#0a0a0a" }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: "#888" }}>{hint}</div>}
    </div>
  );
}

function GridStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: "22px 22px", border: "1px solid #ececec", borderRadius: 4, display: "flex", flexDirection: "column", gap: 8, background: "#fafafa" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#888", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", color: "#0a0a0a", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: "#888" }}>{hint}</div>}
    </div>
  );
}

// ---- Rekap ----
function RekapBody({ data, sketch }: { data: Stats; sketch: Sketch }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, width: "100%", alignContent: "start" }}>
      <GridStat label="Luas Lahan" value={`${fmt(data.totalLahanM2)} m²`} />
      <GridStat label="Jumlah Lapis" value={String(data.jumlahLapis)} />
      <GridStat label="Ketinggian" value={`${fmt(data.ketinggianM, 1)} m`} />
      <GridStat label="Fungsi" value={sketch.fungsi ?? "—"} />
      <GridStat
        label={`KDB${data.kdbPct ? ` (${data.kdbPct}%)` : ""}`}
        value={`${fmt(data.kdbRencanaM2)} m²`}
        hint={data.kdbLimitM2 > 0 ? `dari batas ${fmt(data.kdbLimitM2)} m²` : "batas belum diatur"}
      />
      <GridStat
        label={`KLB${data.klbCoef ? ` (×${data.klbCoef})` : ""}`}
        value={`${fmt(data.klbRencanaM2)} m²`}
        hint={data.klbLimitM2 > 0 ? `dari batas ${fmt(data.klbLimitM2)} m²` : "batas belum diatur"}
      />
      <GridStat label="Total Luas Ruang" value={`${fmt(data.totalRuangM2)} m²`} />
      <GridStat label="Total Terhitung" value={`${fmt(data.totalTerhitungM2)} m²`} hint="tanpa Lahan & Void" />
      <GridStat label="Luas Efektif" value={`${fmt(data.totalEfektifM2)} m²`} />
      <GridStat label="Luas Semi" value={`${fmt(data.totalSetengahM2)} m²`} />
      <GridStat label="Luas Sarana" value={`${fmt(data.totalSaranaM2)} m²`} />
      <GridStat label="KLB Rencana" value={`${fmt(data.klbRencanaM2)} m²`} />
    </div>
  );
}

// ---- Rincian ----
function RincianBody({ sketch }: { sketch: Sketch }) {
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name));
  const displayNames = computeLevelDisplayNames(levels);
  return (
    <div style={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{
        columnCount: levels.length > 2 ? 2 : 1,
        columnGap: 28,
        width: "100%",
      }}>
        {levels.map((lv) => {
          const items = ruang.filter((l) => l.levelId === lv.id);
          const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
          const totalAsliPer = items.reduce((s, l) => s + l.areaM2, 0);
          const totalEfPer = items.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);
          const totalAsli = totalAsliPer * k;
          const totalEf = totalEfPer * k;
          const name = displayNames[lv.id] ?? lv.name;
          return (
            <div key={lv.id} style={{ breakInside: "avoid", marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #111", paddingBottom: 6, marginBottom: 8 }}>
                <span style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {name}
                  {k > 1 && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", color: "#e85d3a", textTransform: "uppercase" }}>
                      tipikal {k}×
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#888" }}>
                  {fmt(lv.mdpl, 1)} mdpl · {fmt(totalEf)} m² efektif
                </span>
              </div>
              {items.length === 0 ? (
                <div style={{ fontSize: 13, color: "#999", padding: "8px 0" }}>Belum ada ruang.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#888", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase" }}>
                      <th style={{ textAlign: "left", padding: "6px 0", fontWeight: 600 }}>Ruang</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600 }}>Koef.</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600 }}>Luas</th>
                      <th style={{ textAlign: "right", padding: "6px 0", fontWeight: 600 }}>Efektif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => {
                      const coef = r.coefficient ?? 1;
                      const luas = r.areaM2 * k;
                      const ef = luas * coef;
                      return (
                        <tr key={r.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "6px 0" }}>{r.name}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{coef}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(luas)}</td>
                          <td style={{ padding: "6px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(ef)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: "1px solid #111", fontWeight: 600 }}>
                      <td style={{ padding: "8px 0" }} colSpan={2}>Total</td>
                      <td style={{ padding: "8px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(totalAsli)}</td>
                      <td style={{ padding: "8px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(totalEf)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Infografis ----
function InfografisBody({ data, sketch }: { data: Stats; sketch: Sketch }) {
  const total = data.totalRuangM2 || 1;
  const pctEfektif = (data.totalEfektifM2 / total) * 100;
  const pctSarana = (data.totalSaranaM2 / total) * 100;
  const pctSetengah = (data.totalSetengahM2 / total) * 100;
  const kdbUsage = data.kdbLimitM2 > 0 ? (data.kdbRencanaM2 / data.kdbLimitM2) * 100 : 0;
  const klbUsage = data.klbLimitM2 > 0 ? (data.klbRencanaM2 / data.klbLimitM2) * 100 : 0;

  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name));
  const displayNames = computeLevelDisplayNames(levels);
  const perLevel = levels.map((lv) => {
    const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
    const sum = ruang.filter((r) => r.levelId === lv.id).reduce((s, l) => s + l.areaM2, 0) * k;
    return { lv, sum, k, name: displayNames[lv.id] ?? lv.name };
  });
  const totalAll = perLevel.reduce((s, r) => s + r.sum, 0) || 1;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24, width: "100%" }}>
      <Panel title="Fungsi Ruang">
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Donut
            size={180}
            thickness={14}
            segments={[
              { value: pctEfektif, color: "#0a0a0a" },
              { value: pctSetengah, color: "#999999" },
              { value: pctSarana, color: "#dddddd" },
            ]}
            centerValue={`${fmt(pctEfektif, 0)}%`}
            centerLabel="Efektif"
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <Legend dotColor="#0a0a0a" label="Efektif" pct={pctEfektif} />
            <Legend dotColor="#999999" label="Semi" pct={pctSetengah} />
            <Legend dotColor="#dddddd" label="Sarana" pct={pctSarana} />
          </div>
        </div>
      </Panel>
      <Panel title="KDB / KLB">
        <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", height: "100%" }}>
          <Ring value={kdbUsage} label="KDB" />
          <Ring value={klbUsage} label="KLB" />
        </div>
      </Panel>
      <Panel title="Distribusi per Level">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {perLevel.map(({ lv, sum, k, name }) => {
            const pct = (sum / totalAll) * 100;
            return (
              <div key={lv.id}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>
                    {name}{k > 1 ? ` · ${k}×` : ""}
                  </span>
                  <span style={{ color: "#888", fontVariantNumeric: "tabular-nums" }}>
                    {fmt(sum)} m² · {fmt(pct, 1)}%
                  </span>
                </div>
                <div style={{ height: 4, width: "100%", background: "#f0f0f0", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: "#0a0a0a", borderRadius: 999 }} />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 22, border: "1px solid #ececec", borderRadius: 4, background: "#fafafa", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#888", fontWeight: 600 }}>{title}</div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

function Legend({ dotColor, label, pct }: { dotColor: string; label: string; pct: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 10, height: 10, borderRadius: 999, background: dotColor, flexShrink: 0 }} />
      <span style={{ color: "#555" }}>{label}</span>
      <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(pct, 1)}%</span>
    </div>
  );
}

// ---- Biaya ----
function BiayaBody({ data, sketch }: { data: Stats; sketch: Sketch }) {
  const rate = loadCostMap()[sketch.id] ?? 0;
  const total = data.totalTerhitungM2 * rate;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 28, width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <GridStat label="Total Luas Terhitung" value={`${fmt(data.totalTerhitungM2)} m²`} hint="tanpa Lahan & Void" />
        <GridStat label="Biaya per m²" value={fmtRp(rate)} hint="diatur di halaman Tabulasi" />
        <GridStat label="Fungsi" value={sketch.fungsi ?? "—"} />
      </div>
      <div style={{
        display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start",
        padding: 36, border: "1px solid #111", borderRadius: 4, background: "#0a0a0a", color: "#fff",
      }}>
        <div style={{ fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: "#bbb", fontWeight: 600 }}>
          Estimasi Total
        </div>
        <div style={{
          fontFamily: "var(--font-display, Sora, sans-serif)",
          fontSize: 72, fontWeight: 600, letterSpacing: "-0.03em",
          marginTop: 12, fontVariantNumeric: "tabular-nums", lineHeight: 1.05,
        }}>
          {fmtRp(total)}
        </div>
        {rate <= 0 && (
          <div style={{ marginTop: 16, fontSize: 13, color: "#bbb" }}>
            Atur biaya per m² di halaman Tabulasi untuk melihat estimasi.
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Charts ----
function Donut({
  segments, size, thickness, centerValue, centerLabel,
}: {
  segments: { value: number; color: string }[];
  size: number; thickness: number;
  centerValue?: string; centerLabel?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f0f0f0" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const dash = `${len} ${c - len}`;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={thickness}
              strokeDasharray={dash} strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {centerValue && (
          <span style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {centerValue}
          </span>
        )}
        {centerLabel && (
          <span style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "#999" }}>
            {centerLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function Ring({ value, label }: { value: number; label: string }) {
  const over = value > 100;
  const pct = Math.max(0, Math.min(100, value));
  const size = 150;
  const thickness = 10;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = over ? "#c0392b" : "#0a0a0a";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f0f0f0" strokeWidth={thickness} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={color} strokeWidth={thickness}
            strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round"
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {fmt(value, 0)}%
          </span>
        </div>
      </div>
      <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#888", fontWeight: 600 }}>
        {label}
      </div>
    </div>
  );
}
