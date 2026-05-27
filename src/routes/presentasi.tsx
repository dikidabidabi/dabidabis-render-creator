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
  id: string; name: string; points: Point[]; areaM2: number; color: string; levelId?: string; coefficient?: number;
};
type Level = { id: string; name: string; mdpl: number; opacity: number; typicalCount?: number };
type Geo = { lat: number; lon: number; locked: boolean; mapOpacity: number; label?: string };
type Sketch = {
  id: string; title: string; createdAt: number; updatedAt: number; scale: string;
  lines?: Line[]; layers: Layer[]; levels: Level[];
  kdbPct?: number; klbCoef?: number; fungsi?: string; northRotation?: number;
  geo?: Geo;
};
type StoreShape = { sketches: Sketch[]; openId: string | null };

const STORAGE_KEY = "dabidabis_sketch_v2";
const COST_KEY = "dabidabis_cost_v1";

// A3 landscape: 420 × 297 mm. Internal slide canvas in px (proportional, 1mm ≈ 3.3674px).
const A3_W = 1414;
const A3_H = 1000;
const PAD = 84; // 2.5cm at this scale (2.5/42 * 1414 ≈ 84.16, 2.5/29.7 * 1000 ≈ 84.18)

function isLahan(n: string) { return n.trim().toLowerCase().startsWith("lahan"); }
function isVoid(n: string) { return n.trim().toLowerCase() === "void"; }

// Typical floor logic — kept in sync with sketch.tsx
const TYPICAL_FLOOR_H = 3;
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
    const base = lv.mdpl + shift;
    shift += (k - 1) * TYPICAL_FLOOR_H;
    return { lv, k, base };
  });
  const out: ExpandedFloor[] = [];
  for (let i = 0; i < adjusted.length; i++) {
    const { lv, k, base } = adjusted[i];
    const next = adjusted[i + 1];
    if (k === 1) {
      const h = next ? Math.max(0.1, next.base - base) : 4;
      out.push({ id: lv.id, sourceId: lv.id, name: lv.name, mdpl: base, height: h, typicalIndex: 0, typicalTotal: 1 });
    } else {
      for (let j = 0; j < k; j++) {
        out.push({
          id: `${lv.id}__t${j}`,
          sourceId: lv.id,
          name: lv.name,
          mdpl: base + j * TYPICAL_FLOOR_H,
          height: TYPICAL_FLOOR_H,
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

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { setSketches([]); return; }
      const s = JSON.parse(raw) as StoreShape;
      if (s && Array.isArray(s.sketches)) {
        setSketches(s.sketches as Sketch[]);
        setOpenId((prev) => {
          if (prev && s.sketches.some((x) => x.id === prev)) return prev;
          return s.openId ?? s.sketches[0]?.id ?? null;
        });
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    setLoaded(true);
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) load(); };
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
  sketch, open, onToggle,
}: { sketch: Sketch; open: boolean; onToggle: () => void }) {
  const slides = useMemo(() => buildSlides(sketch), [sketch]);
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
type Slide =
  | { kind: "level"; id: string; title: string; sketch: Sketch; level: Level; bounds: Bounds }
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

function buildSlides(sk: Sketch): Slide[] {
  const bounds = computeBounds(sk);
  const levels = [...(sk.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const data = computeStats(sk);
  const displayNames = computeLevelDisplayNames(levels);
  const out: Slide[] = [];
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
    (s, lv) => s + (Math.max(1, Math.round(lv.typicalCount ?? 1)) - 1) * TYPICAL_FLOOR_H,
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

  useEffect(() => {
    if (!boxRef.current || !innerRef.current) return;
    const measure = () => {
      const box = boxRef.current!.getBoundingClientRect();
      const inner = innerRef.current!;
      const prev = inner.style.transform;
      inner.style.transform = "none";
      const cw = inner.scrollWidth;
      const ch = inner.scrollHeight;
      inner.style.transform = prev;
      if (cw === 0 || ch === 0 || box.width === 0 || box.height === 0) return;
      setNatural({ w: cw, h: ch });
      setFitScale(Math.min(1, box.width / cw, box.height / ch));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(boxRef.current);
    ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, [children]);

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
      <ManualScaleBox slideId={slide.id} style={{ flex: 1, minHeight: 0, marginTop: 28, marginBottom: 28 }}>
        {slide.kind === "level" && <LevelBody slide={slide} />}
        {slide.kind === "stacking" && <StackingBody sketch={slide.sketch} />}
        {slide.kind === "rekap" && <RekapBody data={slide.data} sketch={slide.sketch} />}
        {slide.kind === "rincian" && <RincianBody sketch={slide.sketch} />}
        {slide.kind === "infografis" && <InfografisBody data={slide.data} sketch={slide.sketch} />}
        {slide.kind === "biaya" && <BiayaBody data={slide.data} sketch={slide.sketch} />}
      </ManualScaleBox>
      <SlideFooter slide={slide} />
    </div>
  );
}


function SlideHeader({ slide }: { slide: Slide }) {
  const kicker =
    slide.kind === "level" ? "Sketsa · Level"
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

  return (
    <div style={{ display: "flex", gap: 32, width: "100%", height: "100%", alignItems: "stretch" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg
          viewBox={`${bounds.minX} ${bounds.minY} ${w} ${h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          {lahanAll.map((l) => (
            <polygon
              key={`lhn-${l.id}`}
              points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(0,0,0,0.04)"
              stroke="rgba(0,0,0,0.55)"
              strokeWidth={Math.max(w, h) * 0.0015}
              strokeDasharray={`${Math.max(w, h) * 0.006} ${Math.max(w, h) * 0.004}`}
            />
          ))}
          {layers.filter((l) => !isLahan(l.name)).map((l) => (
            <g key={l.id}>
              <polygon
                points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={l.color.replace("ALPHA", "0.28")}
                stroke={l.color.replace("ALPHA", "1")}
                strokeWidth={Math.max(w, h) * 0.002}
              />
              <text
                x={centroid(l.points).x}
                y={centroid(l.points).y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(w, h) * 0.02}
                fontWeight={600}
                fill="#0a0a0a"
                style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.85)", strokeWidth: Math.max(w, h) * 0.01 } as React.CSSProperties}
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
              strokeWidth={Math.max(w, h) * 0.003}
              fill="none"
              strokeLinecap="round"
            />
          ))}
        </svg>
        <SlideCompass rotation={Number(sketch.northRotation) || 0} />
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

function centroid(pts: Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
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
