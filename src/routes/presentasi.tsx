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
import {
  type StructuralGrid,
  axisPositions,
  spansForLevel,
  isNodeActive,
  isColumnClipped,
  levelInRange,
  xAxisLabel,
  yAxisLabel,
  computeAllStructuralStats,
  collectGrids,
} from "@/lib/structural-grid";

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
type SectionCut = { p1: Point; p2: Point; label?: string; updatedAt?: number };
type Sketch = {
  id: string; title: string; createdAt: number; updatedAt: number; scale: string;
  lines?: Line[]; layers: Layer[]; levels: Level[];
  kdbPct?: number; klbCoef?: number; kdhPct?: number; ktbPct?: number; fungsi?: string; northRotation?: number;
  geo?: Geo;
  sectionCut?: SectionCut; // legacy
  sectionCuts?: SectionCut[];
  structuralGrid?: StructuralGrid;
  structuralGridExtras?: StructuralGrid[];
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
function isTaman(n: string) { return n.trim().toLowerCase().startsWith("taman"); }
function isBalkon(n: string) { return n.trim().toLowerCase() === "balkon"; }
function isAtapHijau(n: string) { return n.trim().toLowerCase() === "atap hijau"; }
function isAtap(n: string) { return n.trim().toLowerCase() === "atap"; }
function roomFillOverride(name: string, alpha: string): string | null {
  if (isAtapHijau(name)) return `rgba(34,197,94,${alpha})`;
  if (isBalkon(name) || isAtap(name)) return `rgba(190,190,190,${alpha})`;
  if (isTaman(name)) return `rgba(34,197,94,${alpha})`;
  return null;
}
function roomStrokeOverride(name: string): string | null {
  if (isAtapHijau(name)) return "rgb(22,163,74)";
  if (isBalkon(name) || isAtap(name)) return "rgb(140,140,140)";
  if (isTaman(name)) return "rgb(22,163,74)";
  return null;
}
// Match Model 3D extrude rules: override height & base shift for named rooms.
function roomExtrudeOverride(name: string): { height: number; baseDelta: number } | null {
  if (isAtapHijau(name)) return { height: 0.5, baseDelta: 0 };
  if (isBalkon(name)) return { height: 0.1, baseDelta: -0.1 };
  if (isAtap(name)) return { height: 0.2, baseDelta: -0.2 };
  return null;
}

const MDPL_ZERO_EPS = 0.0001;
function findMdplZeroLevel<T extends { mdpl: number }>(levels: T[]): T | undefined {
  return levels.find((lv) => Math.abs(Number(lv.mdpl) || 0) <= MDPL_ZERO_EPS);
}
function bindLahanToMdplZero(sketch: Sketch): Sketch {
  if (!(sketch.layers ?? []).some((ly) => isLahan(ly.name))) return sketch;
  const zero = findMdplZeroLevel(sketch.levels ?? []);
  const zeroLevel = zero ?? {
    id: `LV_${sketch.id}_MDPL0`,
    name: "Level 1",
    mdpl: 0,
    opacity: 0.5,
  };
  const levels = zero ? sketch.levels : [...(sketch.levels ?? []), zeroLevel];
  return {
    ...sketch,
    levels,
    layers: (sketch.layers ?? []).map((ly) => (isLahan(ly.name) ? { ...ly, levelId: zeroLevel.id } : ly)),
  };
}

// Typical floor logic — kept in sync with sketch.tsx
const TYPICAL_FLOOR_H = 3;
function tipH(lv: { typicalHeight?: number }): number {
  const h = Number(lv.typicalHeight);
  return Number.isFinite(h) && h > 0 ? h : TYPICAL_FLOOR_H;
}
function isAutoLevelName(name: string): boolean {
  const n = name.trim();
  if (/^Level\s+\d+(?:\s*[-–]\s*\d+)?$/i.test(n)) return true;
  if (/^B\d+(?:\s*[-–]\s*B?\d+)?$/i.test(n)) return true;
  return false;
}
function computeLevelDisplayNames(
  levels: Level[],
  _layers?: { name: string; levelId?: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const zeroLevel = findMdplZeroLevel(sorted);
  const lahanIdx = zeroLevel ? sorted.findIndex((l) => l.id === zeroLevel.id) : 0;

  if (lahanIdx > 0) {
    let bn = 1;
    for (let i = lahanIdx - 1; i >= 0; i--) {
      const lv = sorted[i];
      out[lv.id] = isAutoLevelName(lv.name) ? `B${bn}` : lv.name;
      bn++;
    }
  }
  let idx = 1;
  for (let i = Math.max(0, lahanIdx); i < sorted.length; i++) {
    const lv = sorted[i];
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
            setSketches((s.sketches as Sketch[]).map(bindLahanToMdplZero));
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
type RincianSection = {
  level: Level;
  items: Layer[];
  k: number;
  partIndex: number;
  partCount: number;
  totalAsliPer: number;
  totalEfPer: number;
};
type Slide =
  | { kind: "title"; id: string; title: string; sketch: Sketch }
  | { kind: "closing"; id: string; title: string; sketch: Sketch }
  | { kind: "level"; id: string; title: string; sketch: Sketch; level: Level; bounds: Bounds }
  | { kind: "section"; id: string; title: string; sketch: Sketch; cut: SectionCut }
  | { kind: "site"; id: string; title: string; sketch: Sketch; bounds: Bounds; view: SiteView }
  | { kind: "konsep"; id: string; title: string; sketch: Sketch; narasi: NarasiItem; index: number; total: number }
  | { kind: "matahari"; id: string; title: string; sketch: Sketch; bounds: Bounds }
  | { kind: "shadow-seasonal"; id: string; title: string; sketch: Sketch; bounds: Bounds }
  | { kind: "facade-zoning"; id: string; title: string; sketch: Sketch; bounds: Bounds }
  | { kind: "stacking"; id: string; title: string; sketch: Sketch }
  | { kind: "rekap"; id: string; title: string; sketch: Sketch; data: Stats }
  | { kind: "rincian"; id: string; title: string; sketch: Sketch; sections: RincianSection[]; pageIndex: number; pageCount: number }
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
  const displayNames = computeLevelDisplayNames(levels, sk.layers ?? []);
  const out: Slide[] = [];
  // Slide judul (paling awal)
  out.push({ kind: "title", id: "title-slide", title: sk.title || "Proyek", sketch: sk });
  // 4 slide analisa site — selalu ada (pakai koordinat default jika belum dikunci).
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
  // Slide Potongan Prinsip (A-A, B-B, …) — otomatis muncul setelah slide denah
  // ketika user menarik garis potong di kanvas sketsa.
  {
    const cuts: SectionCut[] = Array.isArray(sk.sectionCuts) && sk.sectionCuts.length > 0
      ? sk.sectionCuts
      : (sk.sectionCut ? [sk.sectionCut] : []);
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i];
      if (!c?.p1 || !c?.p2) continue;
      const lbl = c.label || `Potongan ${i + 1}`;
      out.push({
        kind: "section",
        id: `section-cut-${i}-${lbl}`,
        title: `Potongan Prinsip Skematik ${lbl}`,
        sketch: sk,
        cut: c,
      });
    }
  }
  out.push({ kind: "matahari", id: "matahari", title: "Analisa Matahari & Bukaan", sketch: sk, bounds });
  out.push({ kind: "shadow-seasonal", id: "shadow-seasonal", title: "Studi Bayangan Tahunan · 15.00 WIB", sketch: sk, bounds });
  out.push({ kind: "facade-zoning", id: "facade-zoning", title: "Zonasi Fasad · Masif vs Bukaan", sketch: sk, bounds });
  out.push({ kind: "stacking", id: "stacking", title: "Stacking Diagram", sketch: sk });
  out.push({ kind: "rekap", id: "rekap", title: "Rekapitulasi", sketch: sk, data });
  // Rincian per Level — paginated jika tidak muat satu slide.
  {
    const ruangAll = (sk.layers ?? []).filter((l) => !isLahan(l.name));
    const MAX_ROWS_PER_CHUNK = 18;
    const SECTION_OVERHEAD = 130; // px (header + thead + total row + margin)
    const ROW_HEIGHT = 28;
    const BUDGET = 700;
    const allSections: RincianSection[] = [];
    for (const lv of levels) {
      const items = ruangAll.filter((l) => l.levelId === lv.id);
      const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
      const totalAsliPer = items.reduce((s, l) => s + l.areaM2, 0);
      const totalEfPer = items.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);
      if (items.length === 0) {
        allSections.push({ level: lv, items, k, partIndex: 1, partCount: 1, totalAsliPer, totalEfPer });
        continue;
      }
      const partCount = Math.max(1, Math.ceil(items.length / MAX_ROWS_PER_CHUNK));
      for (let p = 0; p < partCount; p++) {
        const chunk = items.slice(p * MAX_ROWS_PER_CHUNK, (p + 1) * MAX_ROWS_PER_CHUNK);
        allSections.push({ level: lv, items: chunk, k, partIndex: p + 1, partCount, totalAsliPer, totalEfPer });
      }
    }
    // Pack sections into pages by height budget
    const pages: RincianSection[][] = [];
    let cur: RincianSection[] = [];
    let curH = 0;
    for (const s of allSections) {
      const h = SECTION_OVERHEAD + ROW_HEIGHT * Math.max(1, s.items.length);
      if (cur.length > 0 && curH + h > BUDGET) {
        pages.push(cur); cur = []; curH = 0;
      }
      cur.push(s); curH += h;
    }
    if (cur.length > 0) pages.push(cur);
    const pageCount = Math.max(1, pages.length);
    pages.forEach((sections, i) => {
      out.push({
        kind: "rincian",
        id: pageCount > 1 ? `rincian-${i + 1}` : "rincian",
        title: pageCount > 1 ? `Rincian per Level (${i + 1}/${pageCount})` : "Rincian per Level",
        sketch: sk,
        sections,
        pageIndex: i + 1,
        pageCount,
      });
    });
    if (pages.length === 0) {
      out.push({ kind: "rincian", id: "rincian", title: "Rincian per Level", sketch: sk, sections: [], pageIndex: 1, pageCount: 1 });
    }
  }
  out.push({ kind: "infografis", id: "info", title: "Infografis", sketch: sk, data });
  out.push({ kind: "biaya", id: "biaya", title: "Estimasi Biaya", sketch: sk, data });
  // Slide penutup
  out.push({ kind: "closing", id: "closing-slide", title: "Terima Kasih", sketch: sk });
  return out;
}

// ---------- Stats ----------
type Stats = {
  totalLahanM2: number; totalRuangM2: number;
  totalEfektifM2: number; totalSaranaM2: number; totalSetengahM2: number;
  kdbPct?: number; klbCoef?: number; kdhPct?: number; ktbPct?: number;
  kdbLimitM2: number; klbLimitM2: number; kdhLimitM2: number; ktbLimitM2: number;
  kdbRencanaM2: number; klbRencanaM2: number; kdhRencanaM2: number; ktbRencanaM2: number;
  jumlahLapis: number; ketinggianM: number;
  totalTerhitungM2: number;
  totalKolom: number; volumeBetonM3: number;
};

function computeStats(sk: Sketch): Stats {
  const layers = sk.layers ?? [];
  const levels = sk.levels ?? [];
  const sortedLv = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const groundLevel = findMdplZeroLevel(sortedLv) ?? sortedLv[0];
  const groundIdx = groundLevel ? sortedLv.findIndex((l) => l.id === groundLevel.id) : -1;
  const b1Level = groundIdx > 0 ? sortedLv[groundIdx - 1] : undefined;

  // Lahan = hanya layer "Lahan" di level dasar
  const lahan = layers.filter(
    (l) => isLahan(l.name) && groundLevel && l.levelId === groundLevel.id,
  );
  // Ruang utk KDB/KLB: bukan lahan, bukan void, bukan taman
  const ruang = layers.filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name));
  const tamanGround = layers.filter(
    (l) => isTaman(l.name) && groundLevel && l.levelId === groundLevel.id,
  );
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
  const kdhLimitM2 = (sk.kdhPct ?? 0) > 0 && totalLahanM2 > 0 ? (sk.kdhPct! / 100) * totalLahanM2 : 0;
  const ktbLimitM2 = (sk.ktbPct ?? 0) > 0 && totalLahanM2 > 0 ? (sk.ktbPct! / 100) * totalLahanM2 : 0;
  // KDB = footprint at ground only (no multiplier — ground floor is a single footprint)
  const kdbRencanaM2 = groundLevel
    ? ruang.filter((l) => l.levelId === groundLevel.id).reduce((s, l) => s + l.areaM2, 0)
    : 0;
  const klbRencanaM2 = ruang.reduce(
    (s, l) => s + l.areaM2 * (l.coefficient ?? 1) * kOf(l.levelId),
    0,
  );
  const kdhRencanaM2 = tamanGround.reduce((s, l) => s + l.areaM2, 0);
  const ktbRencanaM2 = b1Level
    ? layers
        .filter((l) => l.levelId === b1Level.id && !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name))
        .reduce((s, l) => s + l.areaM2, 0)
    : 0;
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
  const struct = computeAllStructuralStats(sk.structuralGrid, sk.structuralGridExtras, levels);
  return {
    totalLahanM2, totalRuangM2, totalEfektifM2, totalSaranaM2, totalSetengahM2,
    kdbPct: sk.kdbPct, klbCoef: sk.klbCoef, kdhPct: sk.kdhPct, ktbPct: sk.ktbPct,
    kdbLimitM2, klbLimitM2, kdhLimitM2, ktbLimitM2,
    kdbRencanaM2, klbRencanaM2, kdhRencanaM2, ktbRencanaM2,
    jumlahLapis, ketinggianM, totalTerhitungM2,
    totalKolom: struct.totalColumns, volumeBetonM3: struct.concreteVolumeM3,
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
  const isSpecial = slide.kind === "title" || slide.kind === "closing";
  const body = (
    <>
      {slide.kind === "title" && <TitleBody slide={slide} />}
      {slide.kind === "closing" && <ClosingBody slide={slide} />}
      {slide.kind === "level" && <LevelBody slide={slide} />}
      {slide.kind === "section" && <SectionBody slide={slide} />}
      {slide.kind === "site" && <SiteAnalysisBody slide={slide} />}
      {slide.kind === "konsep" && <KonsepBody slide={slide} />}
      {slide.kind === "matahari" && <MatahariBody slide={slide} />}
      {slide.kind === "shadow-seasonal" && <ShadowSeasonalBody slide={slide} />}
      {slide.kind === "facade-zoning" && <FacadeZoningBody slide={slide} />}
      {slide.kind === "stacking" && <StackingBody sketch={slide.sketch} />}
      {slide.kind === "rekap" && <RekapBody data={slide.data} sketch={slide.sketch} />}
      {slide.kind === "rincian" && <RincianBody slide={slide} />}
      {slide.kind === "infografis" && <InfografisBody data={slide.data} sketch={slide.sketch} />}
      {slide.kind === "biaya" && <BiayaBody data={slide.data} sketch={slide.sketch} />}
    </>
  );
  const fixedLayout =
    slide.kind === "title" ||
    slide.kind === "closing" ||
    slide.kind === "level" ||
    slide.kind === "section" ||
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
        padding: isSpecial ? 0 : PAD,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {!isSpecial && <SlideHeader slide={slide} />}
      {fixedLayout ? (
        <div style={{ flex: 1, minHeight: 0, marginTop: isSpecial ? 0 : 28, marginBottom: isSpecial ? 0 : 28, overflow: "hidden" }}>
          {body}
        </div>
      ) : (
        <ManualScaleBox slideId={slide.id} style={{ flex: 1, minHeight: 0, marginTop: 28, marginBottom: 28 }}>
          {body}
        </ManualScaleBox>
      )}
      {!isSpecial && <SlideFooter slide={slide} />}
    </div>
  );
}

function SlideHeader({ slide }: { slide: Slide }) {
  const kicker =
    slide.kind === "level" ? "Sketsa · Level"
    : slide.kind === "section" ? "Sketsa · Potongan Prinsip"
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
    <div style={{ position: "absolute", right: 10, bottom: 10, width: size, height: size, pointerEvents: "none", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.18))" }}>
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block" }}>
        <defs>
          <linearGradient id="compassBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f1f1ef" />
          </linearGradient>
          <linearGradient id="compassN" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff7a55" />
            <stop offset="100%" stopColor="#e85d3a" />
          </linearGradient>
        </defs>
        {/* Outer ring */}
        <circle cx="50" cy="50" r="47" fill="url(#compassBg)" stroke="#0a0a0a" strokeWidth="0.8" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(10,10,10,0.18)" strokeWidth="0.4" />
        {/* Rotating dial */}
        <g transform={`rotate(${r} 50 50)`}>
          {/* Cardinal & intercardinal tick marks */}
          {Array.from({ length: 16 }).map((_, i) => {
            const angle = (i * 22.5) * Math.PI / 180;
            const isCardinal = i % 4 === 0;
            const r1 = isCardinal ? 38 : 41;
            const r2 = 45;
            const x1 = 50 + Math.sin(angle) * r1;
            const y1 = 50 - Math.cos(angle) * r1;
            const x2 = 50 + Math.sin(angle) * r2;
            const y2 = 50 - Math.cos(angle) * r2;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0a0a0a" strokeWidth={isCardinal ? 0.8 : 0.35} strokeLinecap="round" opacity={isCardinal ? 1 : 0.45} />;
          })}
          {/* North needle (filled, accent) */}
          <polygon points="50,10 45,50 50,46 55,50" fill="url(#compassN)" stroke="#7a2a18" strokeWidth="0.35" strokeLinejoin="round" />
          {/* South needle (outline) */}
          <polygon points="50,90 46,50 50,54 54,50" fill="#ffffff" stroke="#0a0a0a" strokeWidth="0.5" strokeLinejoin="round" />
          {/* Cardinal letters (rotate with dial so U follows north) */}
          <text x="50" y="26" textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="800" fill="#0a0a0a" fontFamily="Sora, sans-serif" letterSpacing="0.5">U</text>
          <text x="50" y="76" textAnchor="middle" dominantBaseline="central" fontSize="6" fontWeight="700" fill="#888" fontFamily="Sora, sans-serif">S</text>
          <text x="74" y="50" textAnchor="middle" dominantBaseline="central" fontSize="6" fontWeight="700" fill="#888" fontFamily="Sora, sans-serif">T</text>
          <text x="26" y="50" textAnchor="middle" dominantBaseline="central" fontSize="6" fontWeight="700" fill="#888" fontFamily="Sora, sans-serif">B</text>
        </g>
        {/* Center cap */}
        <circle cx="50" cy="50" r="3" fill="#0a0a0a" />
        <circle cx="50" cy="50" r="1.2" fill="#ff7a55" />
      </svg>
    </div>
  );
}
// ---- Title body ----
function TitleBody({ slide }: { slide: Extract<Slide, { kind: "title" }> }) {
  const dateStr = new Date(slide.sketch.createdAt || Date.now()).toLocaleDateString("id-ID", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: PAD,
        background: "#ffffff",
        position: "relative",
      }}
    >
      <div style={{ fontSize: 13, letterSpacing: "0.28em", textTransform: "uppercase", color: "#888", fontWeight: 600, marginBottom: 28 }}>
        Presentasi Proyek
      </div>
      <div
        style={{
          fontFamily: "var(--font-display, Sora, sans-serif)",
          fontSize: 92,
          lineHeight: 1.05,
          letterSpacing: "-0.04em",
          fontWeight: 700,
          color: "#0a0a0a",
          maxWidth: 1100,
        }}
      >
        {slide.sketch.title || "Proyek"}
      </div>
      <div style={{ width: 120, height: 4, background: "#e85d3a", marginTop: 36, marginBottom: 36 }} />
      <div style={{ fontSize: 22, color: "#555", letterSpacing: "0.02em" }}>
        {dateStr}
      </div>
      <div style={{ position: "absolute", bottom: PAD, left: PAD, right: PAD, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#888" }}>
        <span style={{ fontWeight: 700, color: "#111" }}>Dabidabi's</span>
        <span>Skala {slide.sketch.scale}{slide.sketch.fungsi ? ` · ${slide.sketch.fungsi}` : ""}</span>
        <span>A3 · 420 × 297 mm</span>
      </div>
    </div>
  );
}

// ---- Closing body ----
function ClosingBody({ slide }: { slide: Extract<Slide, { kind: "closing" }> }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: PAD,
        background: "#0a0a0a",
        color: "#ffffff",
        position: "relative",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display, Sora, sans-serif)",
          fontSize: 104,
          lineHeight: 1.05,
          letterSpacing: "-0.03em",
          fontWeight: 700,
        }}
      >
        Terima Kasih
      </div>
      <div style={{ width: 120, height: 4, background: "#e85d3a", marginTop: 40, marginBottom: 40 }} />
      <div style={{ fontSize: 24, color: "#aaa", letterSpacing: "0.02em", maxWidth: 800 }}>
        Atas perhatian dan kerja samanya dalam pembahasan desain proyek ini.
      </div>
      <div style={{ position: "absolute", bottom: PAD, left: PAD, right: PAD, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#888" }}>
        <span style={{ fontWeight: 700, color: "#fff" }}>Dabidabi's</span>
        <span style={{ color: "#888" }}>Skala {slide.sketch.scale}{slide.sketch.fungsi ? ` · ${slide.sketch.fungsi}` : ""}</span>
        <span style={{ color: "#888" }}>A3 · 420 × 297 mm</span>
      </div>
    </div>
  );
}

// ---- Section body (Potongan Prinsip A-A, dinamis dari sketch.sectionCut) ----
const SECTION_METERS_PER_MAJOR: Record<string, number> = {
  "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10,
};
function sectionPointInPolygon(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit = (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
function cutSegmentIntersectParam(p1: Point, p2: Point, a: Point, b: Point): number | null {
  const rx = p2.x - p1.x, ry = p2.y - p1.y;
  const sx = b.x - a.x, sy = b.y - a.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - p1.x) * sy - (a.y - p1.y) * sx) / denom;
  const u = ((a.x - p1.x) * ry - (a.y - p1.y) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}
function cutPolygonIntervals(p1: Point, p2: Point, poly: Point[]): Array<[number, number]> {
  if (poly.length < 3) return [];
  const tsSet = new Set<number>();
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const t = cutSegmentIntersectParam(p1, p2, a, b);
    if (t != null) {
      const q = Math.round(t * 1e6) / 1e6;
      if (q > 1e-6 && q < 1 - 1e-6) tsSet.add(q);
    }
  }
  const ts = [...tsSet].sort((a, b) => a - b);
  const breaks = [0, ...ts, 1];
  const startInside = sectionPointInPolygon(p1, poly);
  const out: Array<[number, number]> = [];
  let inside = startInside;
  for (let i = 0; i < breaks.length - 1; i++) {
    if (inside && breaks[i + 1] - breaks[i] > 1e-5) out.push([breaks[i], breaks[i + 1]]);
    inside = !inside;
  }
  return out;
}
function isLahanSec(n: string) { return n.trim().toLowerCase().startsWith("lahan"); }
function isVoidSec(n: string) { return n.trim().toLowerCase() === "void"; }

function SectionBody({ slide }: { slide: Extract<Slide, { kind: "section" }> }) {
  const { sketch, cut } = slide;
  const pxPerMeter = (8 * 10) / (SECTION_METERS_PER_MAJOR[sketch.scale] ?? 1);
  const cutLenPx = Math.hypot(cut.p2.x - cut.p1.x, cut.p2.y - cut.p1.y);
  const cutLenM = cutLenPx / pxPerMeter;

  // Sort levels by mdpl ascending. Compute per-level base & top dari MDPL gap
  // (selaras dengan expandLevelsForView + model 3D), bukan dipaksa 3 m.
  const lvls = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const TYPICAL_H = 3;
  type LvlBox = {
    id: string; name: string; baseM: number; topM: number; count: number; floorH: number;
    slices: Array<{ x0: number; x1: number; name: string; color: string; heightOverride?: number; baseDelta?: number }>;
  };
  // Gunakan expand untuk turunkan tinggi tiap lantai sesuai MDPL gap (k=1) atau
  // typicalHeight (k>1). Lalu group balik per sourceId untuk gambar 1 box per level.
  const floorsExp = expandLevelsForView(lvls);
  const groupBySource = new Map<string, typeof floorsExp>();
  for (const f of floorsExp) {
    const arr = groupBySource.get(f.sourceId) ?? [];
    arr.push(f);
    groupBySource.set(f.sourceId, arr);
  }
  const boxes: LvlBox[] = lvls.map((lv) => {
    const group = groupBySource.get(lv.id) ?? [];
    const count = group.length || 1;
    const baseM = group.length ? group[0].mdpl : lv.mdpl;
    const topM = group.length
      ? group[group.length - 1].mdpl + group[group.length - 1].height
      : lv.mdpl + TYPICAL_H;
    const floorH = group.length ? group[0].height : TYPICAL_H;
    return { id: lv.id, name: lv.name, baseM, topM, count, floorH, slices: [] };
  });

  // Compute slices per layer (rooms only) intersecting the cut line.
  // Also collect Void intervals separately — used to suppress floor lines below them.
  const voidIntervalsByBox = new Map<string, Array<[number, number]>>();
  for (const layer of sketch.layers ?? []) {
    if (isLahanSec(layer.name)) continue;
    if (!layer.levelId) continue;
    const box = boxes.find((b) => b.id === layer.levelId);
    if (!box) continue;
    const intervals = cutPolygonIntervals(cut.p1, cut.p2, layer.points);
    if (isVoidSec(layer.name)) {
      const arr = voidIntervalsByBox.get(box.id) ?? [];
      for (const [t0, t1] of intervals) arr.push([t0 * cutLenM, t1 * cutLenM]);
      voidIntervalsByBox.set(box.id, arr);
      continue;
    }
    // Match 3D extrude rules for special rooms.
    let heightOverride: number | undefined;
    let baseDelta: number | undefined;
    const ov = roomExtrudeOverride(layer.name);
    if (ov) { heightOverride = ov.height; baseDelta = ov.baseDelta; }
    for (const [t0, t1] of intervals) {
      box.slices.push({
        x0: t0 * cutLenM,
        x1: t1 * cutLenM,
        name: layer.name,
        color: roomFillOverride(layer.name, "0.55") ?? (layer.color ? layer.color.replace("ALPHA", "0.55") : "rgba(232,93,58,0.5)"),
        heightOverride,
        baseDelta,
      });
    }
  }

  const minMdpl = boxes.length ? Math.min(...boxes.map((b) => b.baseM)) : 0;
  const maxMdpl = boxes.length ? Math.max(...boxes.map((b) => b.topM)) : Math.max(3, TYPICAL_H);
  const groundMdpl = findMdplZeroLevel(lvls) ? 0 : minMdpl;
  // Drawing area extents in meters:
  const padTopM = Math.max(0.5, (maxMdpl - minMdpl) * 0.08);
  const padBotM = Math.max(0.5, (maxMdpl - minMdpl) * 0.05);
  const totalHM = (maxMdpl - minMdpl) + padTopM + padBotM;

  // SVG viewport in mm-like units (1 unit = 1mm in section world);
  // we then scale to fit a render box. Use cm-mapped scale: pick a uniform
  // scale that fits both width and height into the available pixel area.
  const AREA_W = A3_W - 2 * PAD;   // ~1246
  const AREA_H = A3_H - 2 * PAD - 130; // header+footer reserve
  // Reserve ruang bawah utk grid bubble + skala panjang potongan agar tidak terpotong.
  const hasGrid = !!sketch.structuralGrid?.enabled;
  const BUBBLE_PAD = hasGrid ? 90 : 50;
  const AREA_H_DRAW = Math.max(100, AREA_H - BUBBLE_PAD);
  const scalePxPerM = Math.min(AREA_W / Math.max(1, cutLenM), AREA_H_DRAW / Math.max(1, totalHM));
  const drawW = cutLenM * scalePxPerM;
  const drawH = totalHM * scalePxPerM;
  const offsetX = (AREA_W - drawW) / 2;
  const offsetY = Math.max(8, (AREA_H_DRAW - drawH) / 2);

  // Map meter X (0..cutLenM) to svg px.
  const mx = (m: number) => offsetX + m * scalePxPerM;
  // Map meter elevation (mdpl) to svg px (y down). Drawing is centered vertically.
  const topMdpl = maxMdpl + padTopM;
  const my = (mdpl: number) => offsetY + (topMdpl - mdpl) * scalePxPerM;

  // mm grid: 1cm major, 1mm minor — drawn over the entire AREA, light.
  const gridMajor = scalePxPerM * 1; // 1 m grid major (looks like cm at print)
  const gridMinor = gridMajor / 10;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <svg
          width="100%" height="100%"
          viewBox={`0 0 ${AREA_W} ${AREA_H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block", background: "#fcfcfa" }}
        >
          <defs>
            <pattern id={`mm-minor-${slide.id}`} width={gridMinor} height={gridMinor} patternUnits="userSpaceOnUse">
              <path d={`M ${gridMinor} 0 L 0 0 0 ${gridMinor}`} fill="none" stroke="#e7e2d4" strokeWidth={0.5} />
            </pattern>
            <pattern id={`mm-major-${slide.id}`} width={gridMajor} height={gridMajor} patternUnits="userSpaceOnUse">
              <rect width={gridMajor} height={gridMajor} fill={`url(#mm-minor-${slide.id})`} />
              <path d={`M ${gridMajor} 0 L 0 0 0 ${gridMajor}`} fill="none" stroke="#d6cfb8" strokeWidth={0.8} />
            </pattern>
          </defs>
          <rect x={0} y={0} width={AREA_W} height={AREA_H} fill={`url(#mm-major-${slide.id})`} />

          {/* Lahan / ground line — terikat MDPL 0 */}
          <line x1={mx(0) - 30} y1={my(groundMdpl)} x2={mx(cutLenM) + 30} y2={my(groundMdpl)} stroke="#111" strokeWidth={1.6} />
          <text x={mx(0) - 36} y={my(groundMdpl) - 5} fontSize={10} textAnchor="end" fill="#111" style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700 }}>
            Lahan ±0 mdpl
          </text>
          {/* Hatching lahan */}
          {Array.from({ length: 18 }).map((_, i) => {
            const x = mx(0) - 20 + i * ((cutLenM * scalePxPerM + 40) / 18);
            return (
              <line key={i} x1={x} y1={my(groundMdpl)} x2={x - 8} y2={my(groundMdpl) + 10}
                stroke="#111" strokeWidth={0.7} />
            );
          })}

          {/* Level boxes — pelat lantai tebal HANYA di bawah ruang;
              di luar ruang berupa garis putus-putus tipis.
              Dinding luar level basement (di bawah MDPL 0) dan lantai paling bawah
              dibuat 2x lebih tebal dari garis lantai. */}
          {(() => {
            const roomIntervalsByBox = new Map<string, Array<[number, number]>>();
            for (const b of boxes) {
              const arr: Array<[number, number]> = b.slices.map((s) => [s.x0, s.x1]);
              arr.sort((a, c) => a[0] - c[0]);
              const merged: Array<[number, number]> = [];
              for (const iv of arr) {
                if (merged.length && iv[0] <= merged[merged.length - 1][1]) {
                  merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
                } else merged.push([iv[0], iv[1]]);
              }
              roomIntervalsByBox.set(b.id, merged);
            }
            const FLOOR_THICK = 2.4;
            const FLOOR_THICK_HEAVY = 4.8; // 2x lebih tebal dari garis lantai
            const bottomBoxId = boxes.length
              ? boxes.reduce((a, b) => (a.baseM <= b.baseM ? a : b)).id
              : null;
            const renderFloorLine = (
              key: string,
              yy: number,
              underBoxId: string | null,
              heavy = false,
            ) => {
              const rooms = underBoxId ? (roomIntervalsByBox.get(underBoxId) ?? []) : [];
              const voids = underBoxId ? (voidIntervalsByBox.get(underBoxId) ?? []) : [];
              let segs: Array<{ a: number; b: number; thick: boolean }> = [];
              let cursor = 0;
              for (const [r0, r1] of rooms) {
                const a = Math.max(0, r0);
                const b2 = Math.min(cutLenM, r1);
                if (b2 <= a) continue;
                if (a > cursor) segs.push({ a: cursor, b: a, thick: false });
                segs.push({ a, b: b2, thick: true });
                cursor = b2;
              }
              if (cursor < cutLenM) segs.push({ a: cursor, b: cutLenM, thick: false });
              // Cut out segments that fall under Void rooms — no floor line below void.
              for (const [v0, v1] of voids) {
                const va = Math.max(0, v0), vb = Math.min(cutLenM, v1);
                if (vb <= va) continue;
                const next: typeof segs = [];
                for (const s of segs) {
                  if (vb <= s.a || va >= s.b) { next.push(s); continue; }
                  if (va > s.a) next.push({ a: s.a, b: va, thick: s.thick });
                  if (vb < s.b) next.push({ a: vb, b: s.b, thick: s.thick });
                }
                segs = next;
              }
              const thickW = heavy ? FLOOR_THICK_HEAVY : FLOOR_THICK;
              return (
                <g key={key}>
                  {segs.map((s, i) =>
                    s.thick ? (
                      <line key={i} x1={mx(s.a)} y1={yy} x2={mx(s.b)} y2={yy}
                        stroke="#111" strokeWidth={thickW} strokeLinecap="square" />
                    ) : (
                      <line key={i} x1={mx(s.a)} y1={yy} x2={mx(s.b)} y2={yy}
                        stroke="#111" strokeWidth={0.6} strokeDasharray="3 3" />
                    )
                  )}
                </g>
              );
            };
            return boxes.map((b) => {
              const x = mx(0);
              const y = my(b.topM);
              const w = cutLenM * scalePxPerM;
              const h = (b.topM - b.baseM) * scalePxPerM;
              const upper = boxes.find((o) => Math.abs(o.baseM - b.topM) < 1e-3);
              const isBasement = b.topM <= groundMdpl + 1e-3;
              const isBottom = b.id === bottomBoxId;
              const rooms = roomIntervalsByBox.get(b.id) ?? [];
              const roomMin = rooms.length ? Math.max(0, rooms[0][0]) : null;
              const roomMax = rooms.length ? Math.min(cutLenM, rooms[rooms.length - 1][1]) : null;
              return (
                <g key={b.id}>
                  <rect x={x} y={y} width={w} height={h} fill="#ffffff" fillOpacity={0.65} stroke="none" />
                  {/* Batas luar potongan — garis tipis */}
                  <line x1={x} y1={y} x2={x} y2={y + h} stroke="#111" strokeWidth={0.5} strokeLinecap="square" />
                  <line x1={x + w} y1={y} x2={x + w} y2={y + h} stroke="#111" strokeWidth={0.5} strokeLinecap="square" />
                  {/* Dinding terluar ruang pada level basement — tebal 2x */}
                  {isBasement && roomMin !== null && roomMax !== null && (
                    <>
                      <line x1={mx(roomMin)} y1={y} x2={mx(roomMin)} y2={y + h}
                        stroke="#111" strokeWidth={FLOOR_THICK_HEAVY} strokeLinecap="square" />
                      <line x1={mx(roomMax)} y1={y} x2={mx(roomMax)} y2={y + h}
                        stroke="#111" strokeWidth={FLOOR_THICK_HEAVY} strokeLinecap="square" />
                    </>
                  )}
                  {renderFloorLine(`${b.id}-top`, y, upper ? upper.id : null)}
                  {renderFloorLine(`${b.id}-bot`, y + h, b.id, isBottom)}
                  {Array.from({ length: b.count - 1 }).map((_, i) => {
                    const yy = my(b.baseM + (i + 1) * b.floorH);
                    return renderFloorLine(`${b.id}-mid-${i}`, yy, b.id);
                  })}
                </g>
              );
            });
          })()}

          {/* Room slices per level */}
          {boxes.map((b) =>
            b.slices.map((sl, i) => {
              const x = mx(sl.x0);
              const w = (sl.x1 - sl.x0) * scalePxPerM;
              const sliceHM = sl.heightOverride ?? (b.topM - b.baseM);
              // baseM is the floor level mdpl; baseDelta shifts the slab (e.g. balkon -0.1m).
              const sliceBaseM = b.baseM + (sl.baseDelta ?? 0);
              const sliceTopM = sliceBaseM + sliceHM;
              const y = my(sliceTopM);
              const h = sliceHM * scalePxPerM;
              const cx = x + w / 2, cy = y + h / 2;
              const labelFs = Math.max(8, Math.min(13, w / Math.max(8, sl.name.length) * 1.4));
              return (
                <g key={`${b.id}-${i}`}>
                  <rect x={x} y={y} width={w} height={h} fill={sl.color} stroke="#222" strokeWidth={0.5} />
                  {w > 28 && h > 18 && (
                    <text x={cx} y={cy} fontSize={labelFs} fill="#111" textAnchor="middle" dominantBaseline="middle"
                      style={{ fontFamily: "Manrope, sans-serif", fontWeight: 500 }}>
                      {sl.name}
                    </text>
                  )}
                </g>
              );
            })
          )}

          {/* Elevation labels (kiri) — MDPL per level */}
          {boxes.map((b) => {
            const yBase = my(b.baseM);
            const yTop = my(b.topM);
            const xLabel = mx(0) - 8;
            return (
              <g key={`elev-${b.id}`}>
                <line x1={mx(0) - 36} y1={yTop} x2={mx(0)} y2={yTop} stroke="#111" strokeWidth={0.6} />
                <text x={xLabel} y={yTop - 3} fontSize={9} textAnchor="end" fill="#111"
                  style={{ fontFamily: "Manrope, sans-serif" }}>
                  +{b.topM.toFixed(2)} mdpl
                </text>
                <text x={xLabel} y={yBase - 3} fontSize={9} textAnchor="end" fill="#444"
                  style={{ fontFamily: "Manrope, sans-serif" }}>
                  +{b.baseM.toFixed(2)} mdpl
                </text>
              </g>
            );
          })}

          {/* Dimensi tinggi bersih antar level (kanan) */}
          {boxes.map((b) => {
            const x = mx(cutLenM) + 8;
            const y1 = my(b.topM);
            const y2 = my(b.baseM);
            const cy = (y1 + y2) / 2;
            const dim = Math.round((b.topM - b.baseM) * 1000);
            return (
              <g key={`dim-${b.id}`}>
                <line x1={x} y1={y1} x2={x} y2={y2} stroke="#111" strokeWidth={0.8} />
                <line x1={x - 4} y1={y1} x2={x + 4} y2={y1} stroke="#111" strokeWidth={0.8} />
                <line x1={x - 4} y1={y2} x2={x + 4} y2={y2} stroke="#111" strokeWidth={0.8} />
                <text x={x + 8} y={cy + 3} fontSize={9} fill="#111"
                  style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}>
                  {dim} mm
                </text>
              </g>
            );
          })}

          {/* Nama Level di sisi paling kanan potongan */}
          {boxes.map((b) => {
            const cy = (my(b.topM) + my(b.baseM)) / 2;
            const xName = AREA_W - 8;
            return (
              <text key={`name-${b.id}`} x={xName} y={cy} fontSize={10} textAnchor="end"
                dominantBaseline="middle" fill="#111"
                style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, letterSpacing: 0.3 }}>
                {b.name}
              </text>
            );
          })}


          {/* Penanda A dan A' di ujung area gambar */}
          <g>
            <circle cx={mx(0)} cy={my(maxMdpl) - 18} r={10} fill="#111" />
            <text x={mx(0)} y={my(maxMdpl) - 18} fontSize={11} fill="#fff" textAnchor="middle" dominantBaseline="middle" fontWeight={700}>A</text>
            <circle cx={mx(cutLenM)} cy={my(maxMdpl) - 18} r={10} fill="#111" />
            <text x={mx(cutLenM)} y={my(maxMdpl) - 18} fontSize={11} fill="#fff" textAnchor="middle" dominantBaseline="middle" fontWeight={700}>A'</text>
          </g>

          {/* Skala panjang potongan */}
          <g>
            <line x1={mx(0)} y1={my(minMdpl) + 28} x2={mx(cutLenM)} y2={my(minMdpl) + 28} stroke="#111" strokeWidth={0.8} />
            <line x1={mx(0)} y1={my(minMdpl) + 24} x2={mx(0)} y2={my(minMdpl) + 32} stroke="#111" strokeWidth={0.8} />
            <line x1={mx(cutLenM)} y1={my(minMdpl) + 24} x2={mx(cutLenM)} y2={my(minMdpl) + 32} stroke="#111" strokeWidth={0.8} />
            <text x={(mx(0) + mx(cutLenM)) / 2} y={my(minMdpl) + 44} fontSize={10} textAnchor="middle" fill="#111"
              style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}>
              Panjang potongan: {cutLenM.toFixed(2)} m
            </text>
          </g>

          {/* Grid struktur vertikal — diproyeksikan ke garis potongan (semua grid aktif) */}
          {collectGrids(sketch.structuralGrid, sketch.structuralGridExtras).map((grid, gIdx) => {
            const ppm = pxPerMeter;
            const ox = grid.origin.x, oy = grid.origin.y;
            const ddx = cut.p2.x - cut.p1.x;
            const ddy = cut.p2.y - cut.p1.y;
            type Hit = { t: number; label: string; key: string };
            const hits: Hit[] = [];
            const axX = axisPositions(grid.spansX);
            for (let i = 0; i < axX.length; i++) {
              const planX = ox + axX[i] * ppm;
              if (Math.abs(ddx) < 1e-6) continue;
              const t = (planX - cut.p1.x) / ddx;
              if (t < -0.001 || t > 1.001) continue;
              hits.push({ t: Math.max(0, Math.min(1, t)), label: xAxisLabel(i), key: `g${gIdx}x${i}` });
            }
            const axY = axisPositions(grid.spansY);
            for (let j = 0; j < axY.length; j++) {
              const planY = oy + axY[j] * ppm;
              if (Math.abs(ddy) < 1e-6) continue;
              const t = (planY - cut.p1.y) / ddy;
              if (t < -0.001 || t > 1.001) continue;
              hits.push({ t: Math.max(0, Math.min(1, t)), label: yAxisLabel(j), key: `g${gIdx}y${j}` });
            }
            if (!hits.length) return null;
            const yTopPx = my(maxMdpl);
            const yBub = my(minMdpl) + 64;
            const rBub = 7;
            return (
              <g key={`sg-${gIdx}`} pointerEvents="none">
                {hits.map((h) => {
                  const sx = mx(h.t * cutLenM);
                  return (
                    <g key={h.key}>
                      <line x1={sx} y1={yTopPx} x2={sx} y2={yBub - rBub}
                        stroke="#0a0a0a" strokeWidth={0.3}
                        strokeDasharray="6 3 1 3" />
                      <circle cx={sx} cy={yBub} r={rBub}
                        fill="#ffffff" stroke="#0a0a0a" strokeWidth={0.4} />
                      <text x={sx} y={yBub} textAnchor="middle" dominantBaseline="central"
                        fontSize={7} fontWeight={700} fill="#0a0a0a"
                        style={{ fontFamily: "Sora, sans-serif" }}>
                        {h.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ fontSize: 11, color: "#444", textAlign: "center", fontFamily: "Manrope, sans-serif" }}>
        Potongan dihasilkan otomatis dari garis irisan {cut.label || "A-A"} pada kanvas sketsa ·
        Skala {sketch.scale} · {boxes.length} level
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
  const displayNames = computeLevelDisplayNames(sketch.levels ?? [], sketch.layers ?? []);
  const displayName = displayNames[level.id] ?? level.name;
  // Lahan & GSB hanya terikat pada level MDPL 0, bukan level terendah/basement.
  const groundLevel = findMdplZeroLevel(sketch.levels ?? []);
  const isGround = groundLevel ? level.id === groundLevel.id : Math.abs(level.mdpl) <= MDPL_ZERO_EPS;
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
          {isGround && lahanAll.map((l) => (
            <g key={`lhn-${l.id}`}>
              <polygon
                points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="rgba(0,0,0,0.04)"
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={sw * 0.0015}
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
          {layers.filter((l) => !isLahan(l.name)).map((l, i) => {
            if (isVoid(l.name)) {
              let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
              for (const p of l.points) {
                if (p.x < mnx) mnx = p.x;
                if (p.y < mny) mny = p.y;
                if (p.x > mxx) mxx = p.x;
                if (p.y > mxy) mxy = p.y;
              }
              const clipId = `void-clip-${slide.id}-${l.id}`;
              const ptsStr = l.points.map((p) => `${p.x},${p.y}`).join(" ");
              return (
                <g key={l.id}>
                  <defs>
                    <clipPath id={clipId}>
                      <polygon points={ptsStr} />
                    </clipPath>
                  </defs>
                  <polygon points={ptsStr}
                    fill="#ffffff"
                    stroke="#0a0a0a"
                    strokeWidth={sw * 0.0015} />
                  <g clipPath={`url(#${clipId})`}>
                    <line x1={mnx} y1={mny} x2={mxx} y2={mxy}
                      stroke="#0a0a0a" strokeWidth={sw * 0.0008} />
                    <line x1={mxx} y1={mny} x2={mnx} y2={mxy}
                      stroke="#0a0a0a" strokeWidth={sw * 0.0008} />
                  </g>
                </g>
              );
            }
            const overrideFill = roomFillOverride(l.name, "0.45");
            const overrideStroke = roomStrokeOverride(l.name);
            const fillCol = overrideFill ?? l.color.replace("ALPHA", "0.28");
            const strokeCol = overrideStroke ?? l.color.replace("ALPHA", "1");
            return (
              <g key={l.id}>
                <polygon
                  points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={fillCol}
                  stroke={strokeCol}
                  strokeWidth={sw * 0.002}
                />
                <text
                  x={centroid(l.points).x}
                  y={centroid(l.points).y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={sw * 0.014}
                  fontWeight={700}
                  fill="#000000"
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
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
          {collectGrids(sketch.structuralGrid, sketch.structuralGridExtras).map((grid, gIdx) => {
            void gIdx;
            const allLv = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
            if (!levelInRange(grid, level, allLv)) return null;
            const { spansX, spansY } = spansForLevel(grid, level.id);
            const xsM = axisPositions(spansX);
            const zsM = axisPositions(spansY);
            const ox = grid.origin.x;
            const oy = grid.origin.y;
            const xs = xsM.map((m) => ox + m * pxPerM);
            const ys = zsM.map((m) => oy + m * pxPerM);
            const x0 = xs[0], x1 = xs[xs.length - 1];
            const y0 = ys[0], y1 = ys[ys.length - 1];
            const ext = sw * 0.04;
            const rBub = sw * 0.009;
            const gridSW = sw * 0.0006; // lebih tipis 50% dari sebelumnya
            const dash = `${sw * 0.01} ${sw * 0.004} ${sw * 0.002} ${sw * 0.004}`;
            const colPx = (grid.colSizeCm / 100) * pxPerM;
            const bubFs = sw * 0.008;
            const dimFs = sw * 0.0085;
            const dimGap = sw * 0.006;
            return (
              <g key={`grid-${gIdx}`} pointerEvents="none">
                {/* Vertikal (sumbu X) */}
                {xs.map((x, i) => (
                  <g key={`gx-${i}`}>
                    <line x1={x} y1={y0 - ext} x2={x} y2={y1 + ext}
                      stroke="#0a0a0a" strokeWidth={gridSW} strokeDasharray={dash} />
                    <circle cx={x} cy={y0 - ext - rBub} r={rBub}
                      fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                    <text x={x} y={y0 - ext - rBub} textAnchor="middle" dominantBaseline="central"
                      fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                      {xAxisLabel(i)}
                    </text>
                    <circle cx={x} cy={y1 + ext + rBub} r={rBub}
                      fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                    <text x={x} y={y1 + ext + rBub} textAnchor="middle" dominantBaseline="central"
                      fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                      {xAxisLabel(i)}
                    </text>
                  </g>
                ))}
                {/* Horizontal (sumbu Y) */}
                {ys.map((y, j) => (
                  <g key={`gy-${j}`}>
                    <line x1={x0 - ext} y1={y} x2={x1 + ext} y2={y}
                      stroke="#0a0a0a" strokeWidth={gridSW} strokeDasharray={dash} />
                    <circle cx={x0 - ext - rBub} cy={y} r={rBub}
                      fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                    <text x={x0 - ext - rBub} y={y} textAnchor="middle" dominantBaseline="central"
                      fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                      {yAxisLabel(j)}
                    </text>
                    <circle cx={x1 + ext + rBub} cy={y} r={rBub}
                      fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                    <text x={x1 + ext + rBub} y={y} textAnchor="middle" dominantBaseline="central"
                      fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                      {yAxisLabel(j)}
                    </text>
                  </g>
                ))}
                {/* Dimensi bentang grid terluar — diletakkan di sisi dalam antara garis grid terluar dan buble */}
                {spansX.map((sM, i) => {
                  const xa = xs[i];
                  const xb = xs[i + 1];
                  const cx = (xa + xb) / 2;
                  // antara y0 (grid line) dan (y0 - ext - rBub) (buble)
                  const yTop = (y0 + (y0 - ext - rBub)) / 2;
                  const yBot = (y1 + (y1 + ext + rBub)) / 2;
                  const mm = Math.round(sM * 1000);
                  return (
                    <g key={`dx-${i}`}>
                      <text x={cx} y={yTop} textAnchor="middle" dominantBaseline="central"
                        fontSize={dimFs} fontWeight={600} fill="#0a0a0a" fontFamily="Manrope, sans-serif"
                        style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.92)", strokeWidth: sw * 0.003 } as React.CSSProperties}>
                        {mm}
                      </text>
                      <text x={cx} y={yBot} textAnchor="middle" dominantBaseline="central"
                        fontSize={dimFs} fontWeight={600} fill="#0a0a0a" fontFamily="Manrope, sans-serif"
                        style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.92)", strokeWidth: sw * 0.003 } as React.CSSProperties}>
                        {mm}
                      </text>
                    </g>
                  );
                })}
                {spansY.map((sM, j) => {
                  const ya = ys[j];
                  const yb = ys[j + 1];
                  const cy = (ya + yb) / 2;
                  const xLeft = (x0 + (x0 - ext - rBub)) / 2;
                  const xRight = (x1 + (x1 + ext + rBub)) / 2;
                  const mm = Math.round(sM * 1000);
                  return (
                    <g key={`dy-${j}`}>
                      <text x={xLeft} y={cy} textAnchor="middle" dominantBaseline="central"
                        transform={`rotate(-90 ${xLeft} ${cy})`}
                        fontSize={dimFs} fontWeight={600} fill="#0a0a0a" fontFamily="Manrope, sans-serif"
                        style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.92)", strokeWidth: sw * 0.003 } as React.CSSProperties}>
                        {mm}
                      </text>
                      <text x={xRight} y={cy} textAnchor="middle" dominantBaseline="central"
                        transform={`rotate(-90 ${xRight} ${cy})`}
                        fontSize={dimFs} fontWeight={600} fill="#0a0a0a" fontFamily="Manrope, sans-serif"
                        style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.92)", strokeWidth: sw * 0.003 } as React.CSSProperties}>
                        {mm}
                      </text>
                    </g>
                  );
                })}

                {/* Kolom hitam pada tiap titik temu (skip area clip) */}
                {xs.flatMap((x, i) => ys.map((y, j) => {
                  if (!isNodeActive(grid, level.id, i, j)) return null;
                  if (isColumnClipped(grid, xsM[i], zsM[j])) return null;
                  return (
                    <rect key={`col-${i}-${j}`}
                      x={x - colPx / 2} y={y - colPx / 2}
                      width={colPx} height={colPx}
                      fill="#0a0a0a" stroke="#0a0a0a" strokeWidth={gridSW} />
                  );
                }))}
              </g>
            );
          })}
          {null /* dimensi ruang dihapus — diganti dimensi bentang grid */}
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
                  fontSize={sw * 0.0075} fontWeight={700} fill="#0a0a0a"
                  style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.9)", strokeWidth: sw * 0.003 } as React.CSSProperties}
                >
                  38000 mm
                </text>
              </g>
            );
          })}
          {(() => {
            const cuts = Array.isArray(sketch.sectionCuts) && sketch.sectionCuts.length > 0
              ? sketch.sectionCuts
              : (sketch.sectionCut ? [sketch.sectionCut] : []);
            if (cuts.length === 0) return null;
            return cuts.map((cut, idx) => {
              const label = cut.label || "A-A";
              const tag = (label.split("-")[0] || "A").trim();
              const { p1, p2 } = cut;
              const dx = p2.x - p1.x, dy = p2.y - p1.y;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len, uy = dy / len;
              // Perpendicular (rotated +90° CW in screen frame) = viewing direction
              const px = -uy, py = ux;
              const rBub = sw * 0.018;
              const arrowLen = sw * 0.028;
              const arrowHead = sw * 0.008;
              const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
              // Bubble positions extend beyond each endpoint along the line
              const bA = { x: p1.x - ux * (rBub + sw * 0.004), y: p1.y - uy * (rBub + sw * 0.004) };
              const bB = { x: p2.x + ux * (rBub + sw * 0.004), y: p2.y + uy * (rBub + sw * 0.004) };
              const tipX = mid.x + px * arrowLen;
              const tipY = mid.y + py * arrowLen;
              return (
                <g key={`cut-${idx}`} pointerEvents="none">
                  {/* Dashed section line — tipis, hitam */}
                  <line
                    x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke="#0a0a0a"
                    strokeWidth={sw * 0.0014}
                    strokeDasharray={`${sw * 0.012} ${sw * 0.006} ${sw * 0.0025} ${sw * 0.006}`}
                    strokeLinecap="round"
                  />
                  {/* Viewing-direction arrow at mid */}
                  <line
                    x1={mid.x} y1={mid.y} x2={tipX} y2={tipY}
                    stroke="#0a0a0a" strokeWidth={sw * 0.0014} strokeLinecap="round"
                  />
                  <polygon
                    points={`${tipX},${tipY} ${tipX - px * arrowHead + py * arrowHead * 0.7},${tipY - py * arrowHead - px * arrowHead * 0.7} ${tipX - px * arrowHead - py * arrowHead * 0.7},${tipY - py * arrowHead + px * arrowHead * 0.7}`}
                    fill="#0a0a0a"
                  />
                  {/* Endpoint label bubbles */}
                  {[{ pt: bA, txt: tag }, { pt: bB, txt: `${tag}'` }].map((b, j) => (
                    <g key={j}>
                      <circle cx={b.pt.x} cy={b.pt.y} r={rBub}
                        fill="#ffffff" stroke="#0a0a0a" strokeWidth={sw * 0.0016} />
                      <text x={b.pt.x} y={b.pt.y}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize={sw * 0.018} fontWeight={800} fill="#0a0a0a"
                        fontFamily="Sora, sans-serif">
                        {b.txt}
                      </text>
                    </g>
                  ))}
                </g>
              );
            });
          })()}
        </svg>
        <SlideCompass rotation={effectiveNorthDeg(sketch)} />
      </div>
      <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 14, overflow: "hidden" }}>
        <BigStat
          compact
          label="Level"
          value={displayName}
          hint={k > 1
            ? `${fmt(level.mdpl, 1)} mdpl · tipikal ${k}×`
            : `${fmt(level.mdpl, 1)} mdpl`}
        />
        <BigStat compact label="Jumlah Ruang" value={String(layers.filter((l) => !isLahan(l.name)).length)} />
        <BigStat
          compact
          label="Total Luas"
          value={`${fmt(totalLuas)} m²`}
          hint={k > 1 ? `${fmt(luasPerLantai)} m² × ${k} lantai` : undefined}
        />
        {sketch.fungsi && <BigStat compact label="Fungsi" value={sketch.fungsi} />}
        {(() => {
          const roomList = layers.filter((l) => !isLahan(l.name));
          if (roomList.length === 0) return null;
          const n = roomList.length;
          const cols = n > 24 ? 3 : n > 10 ? 2 : 1;
          const fontPx = n > 36 ? 9 : n > 20 ? 10 : 11;
          const gapPx = n > 24 ? 2 : 3;
          return (
            <div style={{ marginTop: 6, borderTop: "1px solid #111", paddingTop: 10, minHeight: 0, flex: "1 1 auto", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "#666", fontWeight: 600, marginBottom: 8, flexShrink: 0 }}>
                Legenda Ruang
              </div>
              <ol style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                columnCount: cols,
                columnGap: 10,
                fontSize: fontPx,
                lineHeight: 1.35,
                flex: "1 1 auto",
                overflow: "hidden",
              }}>
                {roomList.map((r, i) => (
                  <li key={r.id} style={{ display: "flex", gap: 5, breakInside: "avoid", marginBottom: gapPx }}>
                    <span style={{
                      flexShrink: 0,
                      minWidth: 16,
                      fontWeight: 700,
                      color: r.color.replace("ALPHA", "1"),
                      fontVariantNumeric: "tabular-nums",
                    }}>{i + 1}.</span>
                    <span style={{ flex: 1, minWidth: 0, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.name}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })()}
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

// POI category palette + queries + SVG glyph (path within a 24x24 viewBox).
type PoiCat = { key: string; label: string; color: string; q: string; glyph: string };
const POI_CATS: Array<PoiCat> = [
  { key: "edu",   label: "Pendidikan",  color: "#1f9d55",
    q: 'node["amenity"~"school|university|college|kindergarten"]',
    glyph: "M12 3 2 8l10 5 8-4v6h2V8L12 3zm-6 9.2V16c0 2 3 4 6 4s6-2 6-4v-3.8l-6 3-6-3z" },
  { key: "med",   label: "Kesehatan",   color: "#c0392b",
    q: 'node["amenity"~"hospital|clinic|doctors|pharmacy"]',
    glyph: "M10 3h4v6h6v4h-6v8h-4v-8H4V9h6V3z" },
  { key: "shop",  label: "Komersial",   color: "#d6a423",
    q: 'node["shop"];node["amenity"~"marketplace|mall"]',
    glyph: "M6 7V6a4 4 0 1 1 8 0v1h3l1 13H2L3 7h3zm2 0h4V6a2 2 0 1 0-4 0v1z" },
  { key: "food",  label: "Kuliner",     color: "#e85d3a",
    q: 'node["amenity"~"restaurant|cafe|fast_food|food_court"]',
    glyph: "M7 2v8a2 2 0 0 0 2 2v10h2V12a2 2 0 0 0 2-2V2h-1v7h-1V2h-1v7H9V2H7zm10 0c-2 0-3 3-3 6 0 2 1 3 2 3v11h2V2h-1z" },
  { key: "trans", label: "Transportasi",color: "#2d6cdf",
    q: 'node["highway"="bus_stop"];node["railway"~"station|halt"];node["amenity"="bus_station"]',
    glyph: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2v2h-2v-2H7v2H5v-2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 4v5h14V8H5zm2 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" },
  { key: "wor",   label: "Ibadah",      color: "#8b5cf6",
    q: 'node["amenity"="place_of_worship"]',
    glyph: "M11 2h2v3h3v2h-3v3h-2V7H8V5h3V2zm-7 9 8-4 8 4v11h-5v-5h-6v5H4V11z" },
  { key: "park",  label: "Parkir",      color: "#555f6b",
    q: 'node["amenity"="parking"];way["amenity"="parking"]',
    glyph: "M5 3h8a6 6 0 0 1 0 12h-4v6H5V3zm4 4v4h4a2 2 0 1 0 0-4H9z" },
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
          (c.key === "wor" && tags.amenity === "place_of_worship") ||
          (c.key === "park" && tags.amenity === "parking");
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

              {/* Fasilitas: custom SVG marker per kategori (pin + ikon) */}
              {view === "fasilitas" && facsByCat.flatMap(({ cat, items }) =>
                items.map((it) => {
                  const p = projectM(lat, lon, it.ll.lat, it.ll.lon);
                  const cx = p.x * pxPerM;
                  const cy = p.y * pxPerM;
                  const size = 22;
                  const within = it.dist <= 500;
                  return (
                    <g key={`${cat.key}-${it.ll.lat}-${it.ll.lon}`}
                       transform={`translate(${cx} ${cy})`}
                       opacity={within ? 1 : 0.55}>
                      <title>{`${cat.label} — ${it.name} (${Math.round(it.dist)} m)`}</title>
                      {/* Pin teardrop */}
                      <path d="M0 -22 C 10 -22 14 -14 14 -8 C 14 0 6 6 0 14 C -6 6 -14 0 -14 -8 C -14 -14 -10 -22 0 -22 Z"
                        fill={cat.color} stroke="#0a0a0a" strokeWidth={1.2} />
                      {/* Glyph */}
                      <g transform={`translate(${-size / 2} ${-size / 2 - 4}) scale(${size / 24})`}>
                        <path d={cat.glyph} fill="#fff" />
                      </g>
                      {/* Dot ground */}
                      <circle cx={0} cy={14} r={1.6} fill="#0a0a0a" />
                    </g>
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
  // Narasi otomatis: hitung jumlah fasilitas per kategori dalam radius 500 m (walkable).
  const WALK = 500;
  const counts = facsByCat
    .map(({ cat, items }) => ({ cat, n: items.filter((i) => i.dist <= WALK).length }))
    .filter((c) => c.n > 0);
  const phraseMap: Record<string, (n: number) => string> = {
    edu:   (n) => `${n} fasilitas pendidikan`,
    med:   (n) => `${n} fasilitas kesehatan`,
    shop:  (n) => `${n} ${n === 1 ? "area komersial" : "area komersial"}`,
    food:  (n) => `${n} titik kuliner`,
    trans: (n) => `${n} titik transportasi publik`,
    wor:   (n) => `${n} tempat ibadah`,
    park:  (n) => `${n} area parkir`,
  };
  const phrases = counts.map(({ cat, n }) => (phraseMap[cat.key]?.(n) ?? `${n} ${cat.label.toLowerCase()}`));
  let narrative = `Dalam radius berjalan kaki (${WALK} m) belum terdeteksi fasilitas signifikan dari data OpenStreetMap.`;
  if (phrases.length === 1) narrative = `Dalam radius berjalan kaki (${WALK} m), terdapat ${phrases[0]}.`;
  else if (phrases.length === 2) narrative = `Dalam radius berjalan kaki (${WALK} m), terdapat ${phrases[0]} dan ${phrases[1]}.`;
  else if (phrases.length > 2) {
    const head = phrases.slice(0, -1).join(", ");
    narrative = `Dalam radius berjalan kaki (${WALK} m), terdapat ${head}, dan ${phrases[phrases.length - 1]}.`;
  }
  const totalWalk = counts.reduce((s, c) => s + c.n, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Narasi otomatis dari Overpass (≤500 m) */}
      <div style={{ border: "1px solid #0a0a0a", background: "#0a0a0a", color: "#fff", padding: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#e85d3a", fontWeight: 800, marginBottom: 6 }}>
          Pencapaian Pejalan Kaki · {totalWalk} POI ≤ {WALK} m
        </div>
        <div style={{ fontFamily: "var(--font-body, Manrope, sans-serif)", fontSize: 13.5, lineHeight: 1.55, color: "#f1f1f1" }}>
          {narrative}
        </div>
        <div style={{ fontSize: 10, color: "#888", marginTop: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Sumber: Overpass API · OpenStreetMap
        </div>
      </div>

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
  // Use absolute MDPL so Lahan (drawn at y=0) sits at MDPL 0,
  // basement levels go below, upper levels above — matching Model 3D.
  const withH = expanded.map((f) => ({
    id: f.id,
    sourceId: f.sourceId,
    base: f.mdpl,
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
  const taman = (sketch.layers ?? []).filter((l) => isTaman(l.name));
  const build = (sketch.layers ?? []).filter(
    (l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name),
  );

  // Flip view to the diagonally opposite corner (rotate plan 180° about Y).
  const toPm = (l: { points: { x: number; y: number }[] }) =>
    l.points.map((p) => ({ x: -(p.x - ox) * mPerPx, z: -(p.y - oy) * mPerPx }));

  // Ground plane (lahan) at MDPL 0
  for (const ly of lahan) {
    const pm = toPm(ly);
    const top = pm.map((p) => project(p.x, p.z, 0));
    const avg = pm.reduce((s, p) => s + p.x + p.z, 0) / Math.max(1, pm.length);
    faces.push({ pts: top, fill: "#efeae1", stroke: "#a8a195", depth: avg - 100000, sw: 0.4 });
  }

  // Taman: thin green slab at MDPL 0, 0.1 m tall (matches Model 3D)
  const TAMAN_GREEN = "#22c55e";
  const TAMAN_SIDE = "#16a34a";
  for (const ly of taman) {
    const pm = toPm(ly);
    if (pm.length < 3) continue;
    const yBot = 0;
    const yTop = 0.1;
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
      faces.push({ pts: quad, fill: TAMAN_SIDE, stroke: "rgba(0,0,0,0.35)", depth, sw: 0.4 });
    }
    const topPts = pm.map((p) => project(p.x, p.z, yTop));
    const avg = pm.reduce((s, p) => s + p.x + p.z, 0) / pm.length;
    faces.push({
      pts: topPts,
      fill: TAMAN_GREEN,
      stroke: "rgba(0,0,0,0.4)",
      depth: avg + yTop * 100 + 0.5,
      sw: 0.5,
    });
  }

  // Floors (build layers only — Taman handled above, Lahan/Void excluded)
  for (const lv of withH) {
    const top = colorOf(lv.sourceId);
    const side = shadeHsl(top, -18);
    const layers = build.filter((l) => l.levelId === lv.sourceId);
    for (const ly of layers) {
      const pm = toPm(ly);
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

  // Kolom struktur sengaja tidak dirender di stacking diagram (Aksonometrik).

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
  const displayNames = computeLevelDisplayNames(levelsAsc, sketch.layers ?? []);

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
    <div style={{ display: "flex", gap: 20, width: "100%", height: "100%", alignItems: "stretch", minHeight: 0, overflow: "hidden" }}>
      {/* Aksonometrik 3D */}
      <div style={{ width: 620, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: "#777", fontWeight: 600, marginBottom: 8 }}>
          Aksonometrik · Model 3D
        </div>
        <div style={{ flex: 1, minHeight: 0, border: "1px solid #ececec", background: "#fafafa", padding: 10, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <AxonometricView sketch={sketch} colorOf={colorOf} />
        </div>
        <div style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#999", marginTop: 6 }}>
          Proyeksi isometrik 30° · skala {sketch.scale}
        </div>
      </div>

      {/* Stack visual */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, overflow: "hidden" }}>
        {rows.length === 0 && (
          <div style={{ color: "#999", fontSize: 14 }}>Belum ada level untuk ditampilkan.</div>
        )}
        {rows.map((r) => {
          const widthPct = 14 + (r.area / maxArea) * 86;
          return (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 1 30px", minHeight: 22 }}>
              <div style={{ width: 58, textAlign: "right", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#777", fontVariantNumeric: "tabular-nums" }}>
                {fmt(r.mdpl, 1)} m
              </div>
              <div style={{ flex: 1, position: "relative", height: "100%", minHeight: 22 }}>
                <div
                  style={{
                    width: `${widthPct}%`,
                    height: "100%",
                    background: r.color,
                    border: "1px solid rgba(0,0,0,0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 10px",
                    color: "#fff",
                    fontSize: 11,
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <div style={{ width: 58 }} />
          <div style={{ flex: 1, borderTop: "1px solid #111" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 58, textAlign: "right", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#888" }}>
            MDPL
          </div>
          <div style={{ flex: 1, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#888" }}>
            Tanah · MDPL 0
          </div>
        </div>
      </div>

      {/* Legend & summary */}
      <div style={{ width: 230, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "hidden" }}>
        <div style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: "#777", fontWeight: 600, marginBottom: 6 }}>
            Legenda Level
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 0, overflow: "hidden" }}>
            {levelsAsc.slice().reverse().map((lv) => {
              const baseArea = build
                .filter((l) => l.levelId === lv.id)
                .reduce((s, l) => s + (l.areaM2 || 0), 0);
              const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
              const total = baseArea * k;
              const pct = totalArea > 0 ? (total / totalArea) * 100 : 0;
              const name = displayNames[lv.id] ?? lv.name;
              return (
                <div key={lv.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <span style={{ width: 10, height: 10, background: colorOf(lv.id), border: "1px solid rgba(0,0,0,0.25)", flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}{k > 1 ? ` · ${k}×` : ""}
                  </span>
                  <span style={{ color: "#888", fontSize: 9, fontVariantNumeric: "tabular-nums" }}>
                    {fmt(pct, 1)}%
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 56, textAlign: "right", fontSize: 10 }}>
                    {fmt(total)} m²
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <BigStat label="Jumlah Lapis" value={String(totalFloors)} compact />
        <BigStat label="Total Luas" value={`${fmt(totalArea)} m²`} hint="tanpa Lahan & Void" compact />
        <BigStat label="Ketinggian" value={`${fmt(ketinggian, 1)} m`} hint="termasuk tipikal" compact />
      </div>
    </div>
  );
}


// ---- Modern tiles ----
function BigStat({ label, value, hint, compact }: { label: string; value: string; hint?: string; compact?: boolean }) {
  const pad = compact ? "10px 14px" : "18px 20px";
  const gap = compact ? 3 : 6;
  const labelSize = compact ? 9 : 11;
  const valueSize = compact ? 18 : 28;
  const hintSize = compact ? 10 : 12;
  return (
    <div style={{ padding: pad, borderTop: "1px solid #111", display: "flex", flexDirection: "column", gap }}>
      <div style={{ fontSize: labelSize, letterSpacing: "0.24em", textTransform: "uppercase", color: "#777", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: valueSize, fontWeight: 600, letterSpacing: "-0.02em", color: "#0a0a0a", lineHeight: 1.15 }}>{value}</div>
      {hint && <div style={{ fontSize: hintSize, color: "#888" }}>{hint}</div>}
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
      <GridStat
        label={`KDH${data.kdhPct ? ` (min ${data.kdhPct}%)` : ""}`}
        value={`${fmt(data.kdhRencanaM2)} m²`}
        hint={data.kdhLimitM2 > 0 ? `target min ${fmt(data.kdhLimitM2)} m²` : "target belum diatur"}
      />
      <GridStat
        label={`KTB${data.ktbPct ? ` (maks ${data.ktbPct}%)` : ""}`}
        value={`${fmt(data.ktbRencanaM2)} m²`}
        hint={data.ktbLimitM2 > 0 ? `dari batas ${fmt(data.ktbLimitM2)} m²` : "batas belum diatur"}
      />

      <GridStat label="Total Luas Ruang" value={`${fmt(data.totalRuangM2)} m²`} />
      <GridStat label="Total Terhitung" value={`${fmt(data.totalTerhitungM2)} m²`} hint="tanpa Lahan & Void" />
      <GridStat label="Luas Efektif" value={`${fmt(data.totalEfektifM2)} m²`} />
      <GridStat label="Luas Semi" value={`${fmt(data.totalSetengahM2)} m²`} />
      <GridStat label="Luas Sarana" value={`${fmt(data.totalSaranaM2)} m²`} />
      <GridStat label="KLB Rencana" value={`${fmt(data.klbRencanaM2)} m²`} />
      {data.totalKolom > 0 && (
        <GridStat label="Modul Struktur" value={`${data.totalKolom} kolom`} hint={`Volume beton ${fmt(data.volumeBetonM3, 2)} m³`} />
      )}
    </div>
  );
}

// ---- Rincian ----
function RincianBody({ slide }: { slide: Extract<Slide, { kind: "rincian" }> }) {
  const { sketch, sections } = slide;
  const displayNames = computeLevelDisplayNames(sketch.levels ?? [], sketch.layers ?? []);
  if (sections.length === 0) {
    return (
      <div style={{ fontSize: 14, color: "#999", padding: "8px 0" }}>Belum ada ruang.</div>
    );
  }
  return (
    <div style={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ width: "100%" }}>
        {sections.map((sec, idx) => {
          const { level: lv, items, k, partIndex, partCount, totalAsliPer, totalEfPer } = sec;
          const totalAsli = totalAsliPer * k;
          const totalEf = totalEfPer * k;
          const name = displayNames[lv.id] ?? lv.name;
          return (
            <div key={`${lv.id}-${partIndex}-${idx}`} style={{ breakInside: "avoid", marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #111", paddingBottom: 6, marginBottom: 8 }}>
                <span style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {name}
                  {k > 1 && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", color: "#e85d3a", textTransform: "uppercase" }}>
                      tipikal {k}×
                    </span>
                  )}
                  {partCount > 1 && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", color: "#888", textTransform: "uppercase" }}>
                      bag. {partIndex}/{partCount}
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
                    {partIndex === partCount && (
                      <tr style={{ borderTop: "1px solid #111", fontWeight: 600 }}>
                        <td style={{ padding: "8px 0" }} colSpan={2}>Total</td>
                        <td style={{ padding: "8px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(totalAsli)}</td>
                        <td style={{ padding: "8px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(totalEf)}</td>
                      </tr>
                    )}
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
  const kdhUsage = data.kdhLimitM2 > 0 ? (data.kdhRencanaM2 / data.kdhLimitM2) * 100 : 0;
  const ktbUsage = data.ktbLimitM2 > 0 ? (data.ktbRencanaM2 / data.ktbLimitM2) * 100 : 0;


  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name));
  const displayNames = computeLevelDisplayNames(levels, sketch.layers ?? []);
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
      <Panel title="KDB / KLB / KDH / KTB">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center", justifyItems: "center", height: "100%" }}>
          <Ring value={kdbUsage} label="KDB" />
          <Ring value={klbUsage} label="KLB" />
          <Ring value={kdhUsage} label="KDH" />
          <Ring value={ktbUsage} label="KTB" />
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
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{
          display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start",
          padding: 36, border: "1px solid #111", borderRadius: 4, background: "#0a0a0a", color: "#fff",
        }}>
          <div style={{ fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: "#bbb", fontWeight: 600 }}>
            Estimasi Total
          </div>
          <div style={{
            fontFamily: "var(--font-display, Sora, sans-serif)",
            fontSize: 64, fontWeight: 600, letterSpacing: "-0.03em",
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
        <div style={{ border: "1px solid #ececec", borderRadius: 4, background: "#fafafa", padding: 18 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: "#888", fontWeight: 700, marginBottom: 10 }}>
            Pareto Biaya
          </div>
          {[
            { label: "Arsitektur", pct: 0.25, color: "#1e3a8a" },
            { label: "Struktur", pct: 0.35, color: "#0a0a0a" },
            { label: "MEP", pct: 0.40, color: "#e85d3a" },
          ].map((p) => (
            <div key={p.label} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "#444" }}>
                  {p.label} <span style={{ color: "#888", fontVariantNumeric: "tabular-nums" }}>({(p.pct * 100).toFixed(0)}%)</span>
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtRp(total * p.pct)}</span>
              </div>
              <div style={{ height: 6, background: "#eee", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${p.pct * 100}%`, height: "100%", background: p.color }} />
              </div>
            </div>
          ))}
        </div>
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

// ============================================================
// Analisa Bayangan Tahunan & Zonasi Fasad (lokal, tanpa AI)
// ============================================================

// pxPerMeter — mirror dari sketch.tsx
const METERS_PER_MAJOR_SCALE: Record<string, number> = {
  "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10,
};
function pxPerMeterFor(scale: string): number {
  return 80 / (METERS_PER_MAJOR_SCALE[scale] ?? 1);
}

// Posisi matahari dalam frame sketsa (az: 0=sketsa-atas, CW; alt: derajat di atas horizon)
function sunPosSketch(date: Date, lat: number, lon: number, northDeg: number) {
  const p = SunCalc.getPosition(date, lat, lon);
  const azNorthCW = (p.azimuth + Math.PI) * (180 / Math.PI);
  const az = ((azNorthCW + northDeg) % 360 + 360) % 360;
  const alt = (p.altitude * 180) / Math.PI;
  return { az, alt };
}

// Pukul 15.00 WIB (UTC+7) → 08.00 UTC
function critDate(year: number, monthIdx0: number, day: number): Date {
  return new Date(Date.UTC(year, monthIdx0, day, 8, 0, 0));
}

// Tinggi tumpukan bangunan di atas footprint sebuah layer.
// Asumsi: layer berdiri pada level-nya (mdpl) — tinggi total volume yang dibayangi
// adalah penjumlahan tinggi semua expanded floor mulai dari level layer ke atas
// yang ber-sourceId sama (typical floors). Bila tidak ditemukan, fallback 3 m.
function layerStackHeight(layer: Layer, expanded: ExpandedFloor[]): number {
  if (!layer.levelId) return 3;
  const own = expanded.filter((e) => e.sourceId === layer.levelId);
  if (own.length === 0) return 3;
  // Tinggi total dari base layer-nya sampai top stack typical floor-nya.
  const base = Math.min(...own.map((e) => e.mdpl));
  const top = Math.max(...own.map((e) => e.mdpl + e.height));
  return Math.max(0.5, top - base);
}

// Convex hull (Andrew's monotone chain) untuk membentuk bayangan
// gabungan footprint + footprint-yang-digeser-oleh-vektor-bayangan.
// (convexHull sudah didefinisikan di atas — reuse)


// Bayangan satu layer (top-down) — gabungan footprint + footprint digeser
// sejauh (h / tan(alt)) ke arah berlawanan matahari.
function shadowPolygonFor(
  layer: Layer,
  sun: { az: number; alt: number },
  height: number,
  pxPerM: number,
): Point[] | null {
  if (sun.alt <= 2) return null; // matahari sangat rendah → bayangan tak terhingga
  const altRad = (sun.alt * Math.PI) / 180;
  const lenM = height / Math.tan(altRad);
  // Cap panjang bayangan agar tidak meledak saat matahari rendah.
  const capM = Math.max(height * 12, 60);
  const lenMc = Math.min(lenM, capM);
  const lenPx = lenMc * pxPerM;
  // Arah matahari (di mana matahari berada) pada frame sketsa: az diukur CW dari sketsa-atas.
  // Posisi matahari: (sin az, -cos az). Vektor bayangan = berlawanan = (-sin az, cos az).
  const ar = (sun.az * Math.PI) / 180;
  const dx = -Math.sin(ar) * lenPx;
  const dy = Math.cos(ar) * lenPx;
  const shifted = layer.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  return convexHull([...layer.points, ...shifted]);
}

function ShadowSeasonalBody({ slide }: { slide: Extract<Slide, { kind: "shadow-seasonal" }> }) {
  const { sketch, bounds } = slide;
  const geo = sketch.geo;
  const lat = geo?.lat ?? -6.2;
  const lon = geo?.lon ?? 106.816666;
  const northDeg = effectiveNorthDeg(sketch);
  const year = new Date().getFullYear();
  const dates = [
    { label: "21 Maret", sub: "Equinox musim semi", date: critDate(year, 2, 21) },
    { label: "22 Juni", sub: "Solstice utara (winter di selatan)", date: critDate(year, 5, 22) },
    { label: "23 September", sub: "Equinox musim gugur", date: critDate(year, 8, 23) },
    { label: "22 Desember", sub: "Solstice selatan (summer di selatan)", date: critDate(year, 11, 22) },
  ];
  const pxPerM = pxPerMeterFor(sketch.scale);
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const expanded = expandLevelsForView(levels);
  const lahanAll = (sketch.layers ?? []).filter((l) => isLahan(l.name));
  const buildLayers = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name));

  // Perluas viewBox untuk menampung bayangan terpanjang.
  const margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.55;
  const vbX = bounds.minX - margin;
  const vbY = bounds.minY - margin;
  const vbW = (bounds.maxX - bounds.minX) + margin * 2;
  const vbH = (bounds.maxY - bounds.minY) + margin * 2;
  const strokeBase = Math.max(vbW, vbH);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", height: "100%" }}>
      <div style={{ fontSize: 13, color: "#444", lineHeight: 1.5, maxWidth: 1100 }}>
        Matriks pergerakan bayangan empat titik balik matahari tahunan pada pukul <strong>15.00 WIB</strong>.
        Dihitung lokal dengan SunCalc dari koordinat {lat.toFixed(3)}°, {lon.toFixed(3)}° · arah Utara {northDeg.toFixed(0)}° dari atas sketsa.
        Geometri bayangan = gabungan footprint dengan proyeksi puncak masa pada bidang tanah.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, flex: 1, minHeight: 0 }}>
        {dates.map((d) => {
          const sun = sunPosSketch(d.date, lat, lon, northDeg);
          const shadows = buildLayers
            .map((l) => ({ l, poly: shadowPolygonFor(l, sun, layerStackHeight(l, expanded), pxPerM) }))
            .filter((s) => s.poly && s.poly.length >= 3);
          return (
            <div key={d.label} style={{ border: "1px solid #111", padding: 10, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>
                  {d.label}
                </div>
                <div style={{ fontSize: 10, color: "#888", letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 700 }}>
                  15.00
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: "#666", marginBottom: 6, lineHeight: 1.25 }}>{d.sub}</div>
              <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#fafafa", border: "1px solid #eee" }}>
                <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", display: "block" }}>
                  {/* lahan */}
                  {lahanAll.map((l) => (
                    <polygon key={l.id} points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="rgba(0,0,0,0.03)" stroke="rgba(0,0,0,0.45)"
                      strokeWidth={strokeBase * 0.0014}
                      strokeDasharray={`${strokeBase * 0.006} ${strokeBase * 0.004}`} />
                  ))}
                  {/* shadows */}
                  {shadows.map((s, i) => (
                    <polygon key={`sh-${i}`}
                      points={s.poly!.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="rgba(20,20,30,0.32)" stroke="none" />
                  ))}
                  {/* buildings */}
                  {buildLayers.map((l) => (
                    <polygon key={l.id} points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="rgba(232,93,58,0.85)" stroke="#0a0a0a"
                      strokeWidth={strokeBase * 0.0018} />
                  ))}
                  {/* sun arrow */}
                  {sun.alt > 0 && (() => {
                    const cxw = (bounds.minX + bounds.maxX) / 2;
                    const cyw = (bounds.minY + bounds.maxY) / 2;
                    const len = Math.max(vbW, vbH) * 0.32;
                    const ar = (sun.az * Math.PI) / 180;
                    const sx = cxw + Math.sin(ar) * len;
                    const sy = cyw - Math.cos(ar) * len;
                    return (
                      <g>
                        <circle cx={sx} cy={sy} r={strokeBase * 0.012} fill="#f5b400" stroke="#0a0a0a" strokeWidth={strokeBase * 0.002} />
                        <line x1={sx} y1={sy} x2={cxw} y2={cyw} stroke="#f5b400" strokeWidth={strokeBase * 0.0025} strokeDasharray={`${strokeBase * 0.008} ${strokeBase * 0.005}`} />
                      </g>
                    );
                  })()}
                </svg>
                <SlideCompass rotation={northDeg} size={48} />
              </div>
              <div style={{ marginTop: 6, fontSize: 10.5, color: "#333", display: "flex", justifyContent: "space-between" }}>
                <span>Azimut <strong>{sun.alt > 0 ? sun.az.toFixed(0) + "°" : "—"}</strong></span>
                <span>Altitud <strong>{sun.alt.toFixed(0)}°</strong></span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#444", alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, background: "rgba(232,93,58,0.85)", border: "1px solid #0a0a0a" }} /> Footprint massa
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, background: "rgba(20,20,30,0.32)" }} /> Bayangan 15.00 WIB
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, background: "#f5b400", border: "1px solid #0a0a0a", borderRadius: 999 }} /> Posisi matahari
        </span>
        <span style={{ color: "#888" }}>Skala {sketch.scale} · 1 m = {pxPerM} px · lat {lat.toFixed(3)}°</span>
      </div>
    </div>
  );
}

// --- Klasifikasi fasad berdasarkan arah hadap (kompas asli) ---
type FacadeDir = "N" | "S" | "E" | "W";
function classifyBearing(bearingDeg: number): FacadeDir {
  const b = ((bearingDeg % 360) + 360) % 360;
  if (b >= 315 || b < 45) return "N";
  if (b >= 45 && b < 135) return "E";
  if (b >= 135 && b < 225) return "S";
  return "W";
}
function polygonSignedArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return 0.5 * s;
}
// Outward normal vector (sketch coords, y-down) untuk satu sisi poligon.
function outwardNormal(a: Point, b: Point, ccw: boolean): { x: number; y: number } {
  const ex = b.x - a.x, ey = b.y - a.y;
  // perpendicular kanan dari arah edge: (ey, -ex)
  // Pada kanvas y-down + winding CCW (signed area > 0 di y-up, < 0 di y-down):
  // gunakan tanda yang menghasilkan normal ke luar.
  const nx = ey, ny = -ex;
  const sign = ccw ? -1 : 1;
  const L = Math.hypot(nx, ny) || 1;
  return { x: (sign * nx) / L, y: (sign * ny) / L };
}
// Bearing kompas (0=Utara, CW) dari vektor sketsa diberi northDeg (mapRotation).
function bearingFromSketchVec(vx: number, vy: number, northDeg: number): number {
  // Sudut vektor dari sketsa-atas, CW: atan2(vx, -vy)
  const angSketchTop = (Math.atan2(vx, -vy) * 180) / Math.PI;
  // Utara nyata berada di sudut northDeg CW dari sketsa-atas → bearing = ang - northDeg.
  return ((angSketchTop - northDeg) % 360 + 360) % 360;
}

const FACADE_COLORS: Record<FacadeDir, { fill: string; stroke: string; label: string; kind: "massif" | "glaze" }> = {
  E: { fill: "rgba(120,40,40,0.92)", stroke: "#3a0d0d", label: "Timur", kind: "massif" },
  W: { fill: "rgba(120,40,40,0.92)", stroke: "#3a0d0d", label: "Barat", kind: "massif" },
  N: { fill: "rgba(95,168,211,0.55)", stroke: "#2a5e7a", label: "Utara", kind: "glaze" },
  S: { fill: "rgba(95,168,211,0.55)", stroke: "#2a5e7a", label: "Selatan", kind: "glaze" },
};

function FacadeZoningBody({ slide }: { slide: Extract<Slide, { kind: "facade-zoning" }> }) {
  const { sketch, bounds } = slide;
  const northDeg = effectiveNorthDeg(sketch);
  const pxPerM = pxPerMeterFor(sketch.scale);
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const expanded = expandLevelsForView(levels);
  const buildLayers = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name));
  const lahanAll = (sketch.layers ?? []).filter((l) => isLahan(l.name));

  // Proyeksi dimetric 30° (axonometric bird-eye), pusat = tengah bounds.
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  // zScale: tinggi (m) → px sketsa; gunakan pxPerM langsung agar konsisten skala.
  const project = (x: number, y: number, zMeters: number) => {
    const dx = x - cx;
    const dy = y - cy;
    const zPx = zMeters * pxPerM;
    return { x: (dx - dy) * cos30, y: (dx + dy) * sin30 - zPx };
  };

  // Kumpulkan semua wall quads + top faces untuk diurutkan dan dirender.
  type Quad = { pts: { x: number; y: number }[]; depth: number; fill: string; stroke: string; sw: number; dir?: FacadeDir };
  const quads: Quad[] = [];

  // Lahan (ground polygon, tipis di z=0).
  for (const l of lahanAll) {
    const pts = l.points.map((p) => project(p.x, p.y, 0));
    quads.push({
      pts,
      depth: -1e9, // selalu paling belakang
      fill: "rgba(0,0,0,0.04)",
      stroke: "rgba(0,0,0,0.35)",
      sw: 1.2,
    });
  }

  for (const layer of buildLayers) {
    const own = expanded.filter((e) => e.sourceId === layer.levelId);
    if (own.length === 0) continue;
    const baseMdpl = Math.min(...own.map((e) => e.mdpl));
    const topMdpl = Math.max(...own.map((e) => e.mdpl + e.height));
    // Relative heights (bangunan diasumsikan duduk di z=0 site).
    const baseRel = baseMdpl - Math.min(...expanded.map((e) => e.mdpl));
    const topRel = topMdpl - Math.min(...expanded.map((e) => e.mdpl));

    const ccw = polygonSignedArea(layer.points) > 0;
    // Wall quads per edge.
    for (let i = 0; i < layer.points.length; i++) {
      const a = layer.points[i];
      const b = layer.points[(i + 1) % layer.points.length];
      const n = outwardNormal(a, b, ccw);
      const bearing = bearingFromSketchVec(n.x, n.y, northDeg);
      const dir = classifyBearing(bearing);
      const col = FACADE_COLORS[dir];
      const p1 = project(a.x, a.y, baseRel);
      const p2 = project(b.x, b.y, baseRel);
      const p3 = project(b.x, b.y, topRel);
      const p4 = project(a.x, a.y, topRel);
      // Depth: midpoint of edge in world (a+b)/2 → (x+y). Lebih besar = lebih dekat ke kamera.
      const mx = (a.x + b.x) / 2 - cx;
      const my = (a.y + b.y) / 2 - cy;
      const depth = mx + my;
      quads.push({
        pts: [p1, p2, p3, p4],
        depth,
        fill: col.fill,
        stroke: col.stroke,
        sw: 1.4,
        dir,
      });
    }
    // Top face polygon (atap rata).
    const topPts = layer.points.map((p) => project(p.x, p.y, topRel));
    quads.push({
      pts: topPts,
      depth: 1e8, // selalu paling depan/atas
      fill: "rgba(40,40,40,0.55)",
      stroke: "#0a0a0a",
      sw: 1.4,
    });
  }

  quads.sort((a, b) => a.depth - b.depth);

  // Tentukan bounding viewBox proyeksi.
  const allPts = quads.flatMap((q) => q.pts);
  let pxMin = Infinity, pyMin = Infinity, pxMax = -Infinity, pyMax = -Infinity;
  for (const p of allPts) {
    if (p.x < pxMin) pxMin = p.x;
    if (p.y < pyMin) pyMin = p.y;
    if (p.x > pxMax) pxMax = p.x;
    if (p.y > pyMax) pyMax = p.y;
  }
  if (!Number.isFinite(pxMin)) { pxMin = -100; pxMax = 100; pyMin = -100; pyMax = 100; }
  const padP = Math.max(pxMax - pxMin, pyMax - pyMin) * 0.18 + 40;
  const vbX = pxMin - padP, vbY = pyMin - padP;
  const vbW = (pxMax - pxMin) + padP * 2, vbH = (pyMax - pyMin) + padP * 2;
  const sb = Math.max(vbW, vbH);

  // Leader lines: untuk setiap arah, cari satu sisi representatif (terpanjang) di seluruh bangunan,
  // tarik garis penunjuk dari midpoint sisi (di top) ke pinggir kanvas dengan label keterangan.
  type Lead = { dir: FacadeDir; mid: { x: number; y: number }; lenPx: number; label: string };
  const leads: Record<FacadeDir, Lead | null> = { N: null, S: null, E: null, W: null };
  for (const layer of buildLayers) {
    const own = expanded.filter((e) => e.sourceId === layer.levelId);
    if (own.length === 0) continue;
    const topMdpl = Math.max(...own.map((e) => e.mdpl + e.height));
    const topRel = topMdpl - Math.min(...expanded.map((e) => e.mdpl));
    const ccw = polygonSignedArea(layer.points) > 0;
    for (let i = 0; i < layer.points.length; i++) {
      const a = layer.points[i], b = layer.points[(i + 1) % layer.points.length];
      const n = outwardNormal(a, b, ccw);
      const dir = classifyBearing(bearingFromSketchVec(n.x, n.y, northDeg));
      const lenPx = Math.hypot(b.x - a.x, b.y - a.y);
      if (!leads[dir] || lenPx > leads[dir]!.lenPx) {
        const ma = project((a.x + b.x) / 2, (a.y + b.y) / 2, topRel);
        leads[dir] = {
          dir,
          mid: ma,
          lenPx,
          label: FACADE_COLORS[dir].label,
        };
      }
    }
  }

  // Anchor leader labels di tepi kiri/kanan kanvas berdasar arah kompas.
  // N → kiri-atas, S → kanan-bawah, E → kanan-atas, W → kiri-bawah (jaga keterbacaan).
  const anchors: Record<FacadeDir, { x: number; y: number; tA: "start" | "end" }> = {
    N: { x: vbX + sb * 0.04, y: vbY + sb * 0.12, tA: "start" },
    E: { x: vbX + vbW - sb * 0.04, y: vbY + sb * 0.12, tA: "end" },
    S: { x: vbX + vbW - sb * 0.04, y: vbY + vbH - sb * 0.06, tA: "end" },
    W: { x: vbX + sb * 0.04, y: vbY + vbH - sb * 0.06, tA: "start" },
  };

  return (
    <div style={{ display: "flex", gap: 24, width: "100%", height: "100%" }}>
      {/* Kiri: axonometric */}
      <div style={{ flex: 1.4, minWidth: 0, border: "1px solid #111", padding: 12, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700, marginBottom: 6 }}>
          Axonometric bird-eye · zonasi fasad otomatis
        </div>
        <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#fafafa" }}>
          <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", display: "block" }}>
            {/* Quads (already sorted back-to-front) */}
            {quads.map((q, i) => (
              <polygon key={i}
                points={q.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={q.fill} stroke={q.stroke} strokeWidth={q.sw}
                strokeLinejoin="round" />
            ))}
            {/* Leader lines */}
            {(Object.keys(leads) as FacadeDir[]).map((d) => {
              const L = leads[d];
              if (!L) return null;
              const A = anchors[d];
              const col = FACADE_COLORS[d];
              return (
                <g key={`lead-${d}`}>
                  <line x1={L.mid.x} y1={L.mid.y} x2={A.x} y2={A.y}
                    stroke={col.stroke} strokeWidth={1.4} strokeDasharray="6 4" />
                  <circle cx={L.mid.x} cy={L.mid.y} r={3.5} fill={col.stroke} />
                  <text x={A.x + (A.tA === "start" ? 6 : -6)} y={A.y - 4}
                    textAnchor={A.tA} fontSize={13} fontWeight={800} fill="#0a0a0a"
                    fontFamily="Sora, sans-serif"
                    style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 } as React.CSSProperties}>
                    Fasad {L.label}
                  </text>
                  <text x={A.x + (A.tA === "start" ? 6 : -6)} y={A.y + 12}
                    textAnchor={A.tA} fontSize={10.5} fill="#444"
                    style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 } as React.CSSProperties}>
                    {col.kind === "massif" ? "Dinding masif · blok radiasi" : "Bukaan kaca · cahaya tak langsung"}
                  </text>
                </g>
              );
            })}
          </svg>
          <SlideCompass rotation={northDeg} size={72} />
        </div>
      </div>

      {/* Kanan: legenda + rantai logika */}
      <div style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ border: "1px solid #111", padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700, marginBottom: 8 }}>
            Legenda Strategi Pasif
          </div>
          <LegendRow swatch="rgba(120,40,40,0.92)" border="#3a0d0d"
            title="Dinding Masif (Massive Wall / Bare Concrete)"
            body="Fasad Timur & Barat ditutup masa solid untuk memblokir radiasi matahari ekstrem pagi & sore. Mengurangi beban pendinginan dalam ruang." />
          <LegendRow swatch="rgba(95,168,211,0.55)" border="#2a5e7a"
            title="Bukaan Kaca (Glazing / Open Facade)"
            body="Fasad Utara & Selatan terbuka untuk pencahayaan alami tak langsung sepanjang tahun. Orientasi visual utama ke arah landmark regional via sisi Utara." />
        </div>

        <div style={{ border: "1px solid #0a0a0a", background: "#0a0a0a", color: "#fff", padding: 14, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#e85d3a", fontWeight: 800 }}>
            Rantai Logika (Chain of Logic)
          </div>
          <ChainStep n={1} body="Input koordinat & rotasi peta menentukan arah Utara nyata pada sketsa." />
          <ChainStep n={2} body="SunCalc menghitung azimut & altitud matahari pada 4 titik balik tahunan pukul 15.00 WIB." />
          <ChainStep n={3} body="Setiap sisi poligon ruang dievaluasi normal arah hadapnya terhadap kompas asli." />
          <ChainStep n={4} body="Sisi Timur/Barat → masif (beban termal tinggi). Sisi Utara/Selatan → bukaan kaca (cahaya sejuk)." />
          <ChainStep n={5} body="Hasil menjadi strategi passive cooling: bayangan masif memotong radiasi puncak, fasad terbuka memaksimalkan daylight." />
        </div>
      </div>
    </div>
  );
}

function LegendRow({ swatch, border, title, body }: { swatch: string; border: string; title: string; body: string }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
      <div style={{ width: 22, height: 22, background: swatch, border: `1.5px solid ${border}`, flexShrink: 0, marginTop: 2 }} />
      <div style={{ fontSize: 12, lineHeight: 1.35, color: "#222" }}>
        <div style={{ fontWeight: 800, color: "#0a0a0a", marginBottom: 2 }}>{title}</div>
        <div style={{ color: "#444" }}>{body}</div>
      </div>
    </div>
  );
}

function ChainStep({ n, body }: { n: number; body: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ width: 22, height: 22, borderRadius: 999, background: "#e85d3a", color: "#0a0a0a", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>
        {n}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.4, color: "#e8e8e8" }}>{body}</div>
    </div>
  );
}

