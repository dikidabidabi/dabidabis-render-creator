import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Fragment } from "react";
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
import { colorForRoomName } from "@/lib/room-color";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import SunCalc from "suncalc";
import * as THREE from "three";
import { drawOsmTiles } from "@/lib/geo";
import {
  type StructuralGrid,
  axisPositions,
  spansForLevel,
  isNodeActive,
  isColumnClipped,
  isColumnVisible,
  levelInRange,
  xAxisLabelAt,
  yAxisLabelAt,
  computeAllStructuralStats,
  collectGrids,
} from "@/lib/structural-grid";
import {
  computeStraightSegments,
  segmentIdFor,
  intersectSegmentWithCut,
  type EdgeMaterial,
  type EdgeSegment,
} from "@/lib/edge-segments";
import { type Door } from "@/lib/doors";
import { type Floor, FLOOR_THICKNESS_MM } from "@/lib/floors";
import { type Ramp, tessellateReference, offsetPolyline, polylineLength, pointAtArcLength, computeBordesArcs } from "@/lib/ramps";
import { buildBubbleGraph, type RoomNode, type RoomLink } from "@/lib/adjacency";
import { FUNCTION_META as MP_FUNCTION_META, totalsByFunction as mpTotalsByFunction, blockGFA as mpBlockGFA } from "@/lib/masterplan";
import { loadMasterplanAnalysis, type MasterplanAnalysis } from "@/lib/masterplan-analysis";
import {
  type ParkingArea,
  type ParkingObstacle,
  areaPolygonWorld,
  generateStalls,
  isParkingName,
  normalizeParkingAreas,
  parkingPathsToObstacles,
  computeDiffableTotal,
  distributeDiffableAcrossLevels,
  DIFFABLE_STALL_W,
  DIFFABLE_STALL_L,
} from "@/lib/parking";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceCenter,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

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
  isReferenceRoom?: boolean;
  hidden?: boolean;
  locked?: boolean;
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
  edgeAttrs?: Record<string, EdgeMaterial>;
  doors?: Door[];
  floors?: Floor[];
  parkingAreas?: ParkingArea[];
  ramps?: Ramp[];
  mmGridRotation?: number;
  linkedMasterplan?: { rootLayerId: string };
};
type StoreShape = { sketches: Sketch[]; openId: string | null };

const STORAGE_KEY = "dabidabis_sketch_v2";
const COST_KEY = "dabidabis_cost_v1";
const NARASI_KEY = "dabidabis_narasi_v1";
const PERSPEKTIF_KEY = "dabidabis_perspektif_v1";

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

// ---------- Perspektif store (sinkron dengan halaman /narasi tab Perspektif) ----------
type PerspektifItem = { id: string; title: string; image: string | null };
type PerspektifStore = Record<string, PerspektifItem[]>;
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
  } catch { return {}; }
}
function perspektifForSketch(store: PerspektifStore, sketchId: string): PerspektifItem[] {
  return (store[sketchId] ?? []).filter((p) => !!p.image);
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
  if (isTaman(name)) return { height: 0.1, baseDelta: 0 };
  return null;
}

const MDPL_ZERO_EPS = 0.0001;
function findMdplZeroLevel<T extends { mdpl: number }>(levels: T[]): T | undefined {
  return levels.find((lv) => Math.abs(Number(lv.mdpl) || 0) <= MDPL_ZERO_EPS);
}
function bindLahanToMdplZero(sketch: Sketch): Sketch {
  const rawLevels = sketch.levels ?? [];
  const mmRotRad = ((Number(sketch.mmGridRotation) || 0) * Math.PI) / 180;
  let parkingAreas = normalizeParkingAreas(sketch.parkingAreas, mmRotRad);
  if (!(sketch.layers ?? []).some((ly) => isLahan(ly.name))) {
    const valid = new Set(rawLevels.map((l) => l.id));
    const fallback = rawLevels[0]?.id;
    if (fallback) parkingAreas = parkingAreas.map((p) => (p.levelId && valid.has(p.levelId) ? p : { ...p, levelId: fallback }));
    return { ...sketch, parkingAreas };
  }
  const zero = findMdplZeroLevel(rawLevels);
  const zeroLevel = zero ?? {
    id: `LV_${sketch.id}_MDPL0`,
    name: "Level 1",
    mdpl: 0,
    opacity: 0.5,
  };
  const levels = zero ? rawLevels : [...rawLevels, zeroLevel];
  const valid = new Set(levels.map((l) => l.id));
  parkingAreas = parkingAreas.map((p) => (p.levelId && valid.has(p.levelId) ? p : { ...p, levelId: levels[0]?.id }));
  return {
    ...sketch,
    levels,
    parkingAreas,
    layers: (sketch.layers ?? [])
      .filter((ly) => !ly.hidden)
      .map((ly) => (isLahan(ly.name) ? { ...ly, levelId: zeroLevel.id } : ly)),
  };
}

// --- Pohon acak pada permukaan "Taman" (denah & potongan) ---
function _hashStr32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function _mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
type TamanTreePlan = { x: number; y: number; dM: number };
function planTamanTreesInPoly(poly: Point[], pxPerM: number, seedKey: string): TamanTreePlan[] {
  if (poly.length < 3 || pxPerM <= 0) return [];
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const p of poly) {
    if (p.x < mnx) mnx = p.x; if (p.y < mny) mny = p.y;
    if (p.x > mxx) mxx = p.x; if (p.y > mxy) mxy = p.y;
  }
  const rng = _mulberry32(_hashStr32(seedKey));
  const minSepPx = 3.2 * pxPerM;
  const areaM2 = ((mxx - mnx) * (mxy - mny)) / (pxPerM * pxPerM);
  const tries = Math.min(2500, Math.max(80, Math.round(areaM2 * 3)));
  const out: TamanTreePlan[] = [];
  for (let i = 0; i < tries; i++) {
    const x = mnx + rng() * (mxx - mnx);
    const y = mny + rng() * (mxy - mny);
    if (!pointInPolyPres({ x, y }, poly)) continue;
    const dM = 1 + rng() * 2; // diameter 1..3 m
    const rPx = (dM / 2) * pxPerM;
    // Pastikan kanopi tidak melewati tepi taman
    let okEdge = true;
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
      const ax = poly[j].x, ay = poly[j].y, bx = poly[k].x, by = poly[k].y;
      const vx = bx - ax, vy = by - ay;
      const wx = x - ax, wy = y - ay;
      const L2 = vx * vx + vy * vy || 1e-9;
      const tt = Math.max(0, Math.min(1, (vx * wx + vy * wy) / L2));
      const ex = ax + tt * vx, ey = ay + tt * vy;
      if (Math.hypot(x - ex, y - ey) < rPx) { okEdge = false; break; }
    }
    if (!okEdge) continue;
    let okSep = true;
    for (const t of out) if (Math.hypot(t.x - x, t.y - y) < minSepPx) { okSep = false; break; }
    if (!okSep) continue;
    out.push({ x, y, dM });
  }
  return out;
}
type TamanTreeSecPlan = { xM: number; canopyDm: number; heightM: number };
function planTamanTreesAlong(x0M: number, x1M: number, seedKey: string): TamanTreeSecPlan[] {
  const len = x1M - x0M;
  if (len <= 0.5) return [];
  const rng = _mulberry32(_hashStr32(seedKey));
  const tries = Math.max(20, Math.round(len * 4));
  const out: TamanTreeSecPlan[] = [];
  for (let i = 0; i < tries; i++) {
    const xM = x0M + rng() * len;
    const dM = 1 + rng() * 2; // canopy 1..3 m
    const hM = Math.max(dM, Math.min(5, 2 + rng() * 3)); // total tinggi 2..5 m
    let ok = true;
    for (const t of out) if (Math.abs(t.xM - xM) < 3.2) { ok = false; break; }
    if (!ok) continue;
    out.push({ xM, canopyDm: dM, heightM: hM });
  }
  return out;
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
  const [perspektifStore, setPerspektifStore] = useState<PerspektifStore>({});
  const lastRawRef = useRef<string | null>(null);
  const lastNarasiRawRef = useRef<string | null>(null);
  const lastPerspektifRawRef = useRef<string | null>(null);

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== lastRawRef.current) {
        lastRawRef.current = raw;
        if (!raw) { setSketches([]); setOpenId(null); }
        else {
          const s = JSON.parse(raw) as StoreShape;
          if (s && Array.isArray(s.sketches)) {
            // Drop reference rooms — hanya bentuk yang digambar di sketsa yang dirender.
            const filtered = s.sketches.map((sk) => ({
              ...sk,
              layers: (sk.layers ?? []).filter((l) => !l.isReferenceRoom),
            }));
            setSketches(filtered.map(bindLahanToMdplZero));
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
      const praw = localStorage.getItem(PERSPEKTIF_KEY);
      if (praw !== lastPerspektifRawRef.current) {
        lastPerspektifRawRef.current = praw;
        setPerspektifStore(loadPerspektifStore());
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    setLoaded(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === NARASI_KEY || e.key === PERSPEKTIF_KEY) load();
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
              perspektif={perspektifForSketch(perspektifStore, sk.id)}
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
  sketch, narasi, perspektif, open, onToggle,
}: { sketch: Sketch; narasi: NarasiItem[]; perspektif: PerspektifItem[]; open: boolean; onToggle: () => void }) {
  const [masterPlan, setMasterPlan] = useState<import("@/lib/masterplan").MasterPlan | null>(null);
  const [mpAnalysis, setMpAnalysis] = useState<MasterplanAnalysis | null>(null);
  useEffect(() => {
    let mounted = true;
    const refreshAnalysis = () => setMpAnalysis(loadMasterplanAnalysis());
    refreshAnalysis();
    import("@/lib/masterplan").then((m) => {
      if (!mounted) return;
      const refresh = () => { setMasterPlan(m.loadPlan()); refreshAnalysis(); };
      refresh();
      window.addEventListener("masterplan:update", refresh);
      window.addEventListener("storage", refresh);
      (window as any).__mpCleanup = () => {
        window.removeEventListener("masterplan:update", refresh);
        window.removeEventListener("storage", refresh);
      };
    });
    return () => { mounted = false; (window as any).__mpCleanup?.(); };
  }, []);
  const effectiveSketch = useMemo(() => (mpAnalysis && sketch.linkedMasterplan && mpAnalysis.title ? { ...sketch, title: mpAnalysis.title } : sketch), [sketch, mpAnalysis]);
  const slides = useMemo(() => buildSlides(effectiveSketch, narasi, perspektif, masterPlan, mpAnalysis), [effectiveSketch, narasi, perspektif, masterPlan, mpAnalysis]);

  const [idx, setIdx] = useState(0);
  const [full, setFull] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<null | "pptx" | "pdf">(null);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const exportRootRef = useRef<HTMLDivElement | null>(null);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggleHidden = useCallback((id: string) => {
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);
  const allHiddenChecked = useMemo(
    () => slides.length > 0 && slides.every((s) => hidden.has(s.id)),
    [slides, hidden],
  );
  const checkAllHidden = useCallback(() => {
    if (allHiddenChecked) {
      setHidden(new Set());
    } else {
      const n = new Set<string>();
      for (const s of slides) n.add(s.id);
      setHidden(n);
    }
  }, [slides, allHiddenChecked]);
  const visibleSlides = useMemo(() => slides.filter((s) => !hidden.has(s.id)), [slides, hidden]);

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

  const renderSlideImages = useCallback(async (
    onProgress?: (current: number, total: number) => void,
  ): Promise<string[]> => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const root = exportRootRef.current;
    if (!root) throw new Error("Render container tidak siap");
    const pages = Array.from(root.querySelectorAll<HTMLElement>("[data-slide-page]"));
    const { default: html2canvas } = await import("html2canvas-pro");
    const images: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(i + 1, pages.length);
      const canvas = await html2canvas(pages[i], { backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false });
      images.push(canvas.toDataURL("image/jpeg", 1.0));
      // Free canvas memory immediately
      canvas.width = 0;
      canvas.height = 0;
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    return images;
  }, []);

  const doExportPptx = useCallback(async () => {
    setExporting("pptx");
    setExportProgress({ current: 0, total: 0 });
    let pres: any = null;
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const root = exportRootRef.current;
      if (!root) throw new Error("Render container tidak siap");
      const pages = Array.from(root.querySelectorAll<HTMLElement>("[data-slide-page]"));
      const total = pages.length;
      if (total === 0) throw new Error("Tidak ada slide untuk diekspor");

      const [{ default: html2canvas }, { default: PptxGenJS }] = await Promise.all([
        import("html2canvas-pro"),
        import("pptxgenjs"),
      ]);
      pres = new PptxGenJS();
      pres.defineLayout({ name: "A3", width: 16.54, height: 11.69 });
      pres.layout = "A3";

      for (let i = 0; i < total; i++) {
        setExportProgress({ current: i + 1, total });
        // Yield so progress UI repaints before heavy work
        await new Promise<void>((r) => setTimeout(r, 0));

        const canvas = await html2canvas(pages[i], {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          logging: false,
        });
        let data: string | null = canvas.toDataURL("image/jpeg", 1.0);

        const slide = pres.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addImage({ data, x: 0, y: 0, w: 16.54, h: 11.69 });

        // Aggressive cleanup — release base64 and canvas backing store before next slide
        data = null;
        canvas.width = 0;
        canvas.height = 0;
        await new Promise<void>((r) => setTimeout(r, 0));
      }

      const fname = `${(sketch.title || "presentasi").replace(/[^\w\-]+/g, "_")}.pptx`;
      // writeFile is async — keep UI thread responsive during zipping
      await pres.writeFile({ fileName: fname });
    } catch (err) {
      console.error(err);
      window.alert("Gagal mengekspor PPTX: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      // Destroy PPT instance so internal slide buffers can be GC'd
      pres = null;
      setExporting(null);
      setExportProgress(null);
    }
  }, [sketch.title]);

  const doExportPdf = useCallback(async () => {
    setExporting("pdf");
    setExportProgress({ current: 0, total: 0 });
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const root = exportRootRef.current;
      if (!root) throw new Error("Render container tidak siap");
      const pages = Array.from(root.querySelectorAll<HTMLElement>("[data-slide-page]"));
      const total = pages.length;
      if (total === 0) throw new Error("Tidak ada slide untuk diekspor");

      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3", compress: true });

      for (let i = 0; i < total; i++) {
        setExportProgress({ current: i + 1, total });
        // Yield to browser so the progress UI repaints before heavy work
        await new Promise<void>((r) => setTimeout(r, 0));

        const canvas = await html2canvas(pages[i], {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          logging: false,
        });
        const dataUrl = canvas.toDataURL("image/jpeg", 1.0);

        if (i > 0) pdf.addPage("a3", "landscape");
        pdf.addImage(dataUrl, "JPEG", 0, 0, 420, 297, undefined, "FAST");

        // Aggressive cleanup: nullify canvas backing store so GC can reclaim it
        canvas.width = 0;
        canvas.height = 0;
        // Hint GC between slides
        await new Promise<void>((r) => setTimeout(r, 0));
      }

      const fname = `${(sketch.title || "presentasi").replace(/[^\w\-]+/g, "_")}.pdf`;
      pdf.save(fname);
    } catch (err) {
      console.error(err);
      window.alert("Gagal mengekspor PDF: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(null);
      setExportProgress(null);
    }
  }, [sketch.title]);


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
            {exporting && exportProgress && exportProgress.total > 0 && (
              <div className="mb-2 rounded-md border border-border bg-background/60 px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                  <span>
                    Merender Slide {exportProgress.current} dari {exportProgress.total}
                    {exporting === "pdf" ? " (PDF)" : " (PPTX)"}…
                  </span>
                  <span>{Math.round((exportProgress.current / exportProgress.total) * 100)}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
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
                    hidden.has(s.id) && "opacity-40 line-through",
                  )}
                >
                  {i + 1}. {s.title}
                </button>
              ))}
            </div>

            {/* Hide Slide checklist */}
            <div className="rounded-lg border border-border bg-background/40">
              <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                <div className="text-xs font-semibold">Sembunyikan Slide</div>
                <div className="flex items-center gap-3">
                  <div className="text-[10px] text-muted-foreground">
                    {hidden.size} disembunyikan · {visibleSlides.length}/{slides.length} akan dicetak
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={checkAllHidden}
                  >
                    {allHiddenChecked ? "Uncheck All" : "Check All"}
                  </Button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto px-3 py-2">
                <ul className="space-y-1">
                  {slides.map((s, i) => {
                    const checked = hidden.has(s.id);
                    return (
                      <li key={s.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`hide-${s.id}`}
                          checked={checked}
                          onCheckedChange={() => toggleHidden(s.id)}
                        />
                        <label
                          htmlFor={`hide-${s.id}`}
                          className={cn(
                            "flex-1 cursor-pointer truncate text-xs",
                            checked && "line-through opacity-60",
                          )}
                          title={s.title}
                        >
                          {i + 1}. {s.title}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
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
          {visibleSlides.map((s) => (
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: typeof window !== "undefined" ? window.innerWidth : 1920, h: typeof window !== "undefined" ? window.innerHeight : 1080 });

  // Request native fullscreen on the container so it fills the entire screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const tryEnter = async () => {
      try { if (!document.fullscreenElement) await el.requestFullscreen?.(); } catch {}
    };
    tryEnter();
    const onChange = () => {
      if (!document.fullscreenElement) onClose();
      setVp({ w: window.innerWidth, h: window.innerHeight });
    };
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("resize", onResize);
      if (document.fullscreenElement) { try { document.exitFullscreen?.(); } catch {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit A3 (1414×1000 ≈ 1.414:1) inside viewport, maintaining aspect — letterbox on sides.
  const scale = Math.min(vp.w / A3_W, vp.h / A3_H);
  const slideW = A3_W * scale;
  const slideH = A3_H * scale;

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      <div
        className="bg-white overflow-hidden shadow-2xl"
        style={{ width: slideW, height: slideH, position: "relative" }}
      >
        <div
          style={{
            width: A3_W,
            height: A3_H,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <SlideContent slide={slides[idx]} />
        </div>
      </div>
      <div className="absolute right-4 top-4">
        <Button variant="ghost" size="icon" className="h-9 w-9 text-white hover:bg-white/10" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
        <Button variant="ghost" size="icon" className="h-10 w-10 text-ember hover:bg-ember/20" onClick={prev}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost" size="icon" className="h-10 w-10 text-ember hover:bg-ember/20"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-10 w-10 text-ember hover:bg-ember/20" onClick={next}>
          <ChevronRight className="h-5 w-5" />
        </Button>
        <div className="ml-3 text-xs text-ember/90 font-medium">
          {idx + 1} / {slides.length} · {slides[idx]?.title}
        </div>
      </div>
    </div>
  );
}

// ---------- A3 Frame: maintains aspect, scales internal 1414x1000 canvas ----------
function A3Frame({ children }: { children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ scale: 0.5, w: A3_W * 0.5, h: A3_H * 0.5 });
  useLayoutEffect(() => {
    if (!wrap.current) return;
    const update = (availableW: number) => {
      const viewportFitW = Math.max(320, (window.innerHeight - 140) * (A3_W / A3_H));
      const w = Math.min(availableW, viewportFitW);
      const scale = w / A3_W;
      setFrame({ scale, w, h: A3_H * scale });
    };
    const ro = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    ro.observe(wrap.current);
    const onResize = () => wrap.current && update(wrap.current.getBoundingClientRect().width);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return (
    <div
      ref={wrap}
      className="relative flex w-full items-center justify-center overflow-hidden"
      style={{ height: frame.h }}
    >
      <div
        className="overflow-hidden bg-white shadow-[0_10px_40px_-15px_rgba(0,0,0,0.45)] ring-1 ring-black/5"
        style={{ width: frame.w, height: frame.h }}
      >
        <div
        style={{
          width: A3_W,
          height: A3_H,
          transform: `scale(${frame.scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
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
type TocEntry = { label: string; page: number };
type Slide =
  | { kind: "title"; id: string; title: string; sketch: Sketch }
  | { kind: "toc"; id: string; title: string; sketch: Sketch; entries: TocEntry[] }
  | { kind: "closing"; id: string; title: string; sketch: Sketch }
  | { kind: "level"; id: string; title: string; sketch: Sketch; level: Level; bounds: Bounds }
  | { kind: "bubble"; id: string; title: string; sketch: Sketch; level: Level; bounds: Bounds }
  | { kind: "section"; id: string; title: string; sketch: Sketch; cut: SectionCut }
  | { kind: "site"; id: string; title: string; sketch: Sketch; bounds: Bounds; view: SiteView }
  | { kind: "konsep"; id: string; title: string; sketch: Sketch; narasi: NarasiItem; index: number; total: number }
  | { kind: "perspektif"; id: string; title: string; sketch: Sketch; image: string; caption: string; index: number; total: number }
  | { kind: "matahari"; id: string; title: string; sketch: Sketch; bounds: Bounds }
  | { kind: "shadow-seasonal"; id: string; title: string; sketch: Sketch; bounds: Bounds }
  | { kind: "facade-zoning"; id: string; title: string; sketch: Sketch; bounds: Bounds }
  | { kind: "wind"; id: string; title: string; sketch: Sketch }
  | { kind: "thermal"; id: string; title: string; sketch: Sketch }
  | { kind: "stacking"; id: string; title: string; sketch: Sketch }
  | { kind: "explode-axo"; id: string; title: string; sketch: Sketch }
  | { kind: "rekap"; id: string; title: string; sketch: Sketch; data: Stats }
  | { kind: "rincian"; id: string; title: string; sketch: Sketch; sections: RincianSection[]; pageIndex: number; pageCount: number }
  | { kind: "infografis"; id: string; title: string; sketch: Sketch; data: Stats }
  | { kind: "komposisi"; id: string; title: string; sketch: Sketch; data: Stats }
  | { kind: "biaya"; id: string; title: string; sketch: Sketch; data: Stats }
  | { kind: "masterplan"; id: string; title: string; sketch: Sketch; plan: import("@/lib/masterplan").MasterPlan; analysis: MasterplanAnalysis | null }
  | { kind: "siteplan"; id: string; title: string; sketch: Sketch; analysis: MasterplanAnalysis };

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
  const mmRotRad = ((Number(sk.mmGridRotation) || 0) * Math.PI) / 180;
  for (const area of sk.parkingAreas ?? []) for (const p of areaPolygonWorld(area, mmRotRad)) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const w = maxX - minX, h = maxY - minY;
  const pad = Math.max(w, h, 1) * 0.08;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function buildSlides(sk: Sketch, narasi: NarasiItem[] = [], perspektif: PerspektifItem[] = [], plan: import("@/lib/masterplan").MasterPlan | null = null, analysis: MasterplanAnalysis | null = null): Slide[] {
  const bounds = computeBounds(sk);
  const levels = [...(sk.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const data = computeStats(sk);
  const displayNames = computeLevelDisplayNames(levels, sk.layers ?? []);
  const out: Slide[] = [];
  // Slide judul (paling awal)
  out.push({ kind: "title", id: "title-slide", title: sk.title || "Proyek", sketch: sk });
  // Slide Master Plan — hanya untuk proyek hasil impor dari halaman Master Plan.
  const hasAnalysis = analysis && (analysis.buildings.length > 0 || analysis.lahanPolygonsPx.length > 0);
  if (hasAnalysis && sk.linkedMasterplan) {
    out.push({ kind: "masterplan", id: "masterplan", title: "Analisis Master Plan Kawasan", sketch: sk, plan: plan ?? { blocks: [], siteSize: 200, updatedAt: 0 } as any, analysis });
  }
  // Slide Siteplan — hanya bila sketsa aktif terkait masterplan.
  if (hasAnalysis && sk.linkedMasterplan) {
    out.push({ kind: "siteplan", id: "siteplan", title: "Siteplan Kawasan", sketch: sk, analysis: analysis! });
  }
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
  const perspektifList = perspektif.filter((p): p is PerspektifItem & { image: string } => !!p.image);
  for (const lv of levels) {
    out.push({
      kind: "bubble",
      id: `bubble-${lv.id}`,
      title: `Diagram Hubungan Ruang · ${displayNames[lv.id] ?? lv.name}`,
      sketch: sk,
      level: lv,
      bounds,
    });
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
  out.push({ kind: "wind", id: "wind", title: "Simulasi Aliran Angin", sketch: sk });
  out.push({ kind: "matahari", id: "matahari", title: "Analisa Matahari & Bukaan", sketch: sk, bounds });
  out.push({ kind: "shadow-seasonal", id: "shadow-seasonal", title: "Studi Bayangan Tahunan · 15.00 WIB", sketch: sk, bounds });
  out.push({ kind: "facade-zoning", id: "facade-zoning", title: "Zonasi Fasad · Masif vs Bukaan", sketch: sk, bounds });
  out.push({ kind: "thermal", id: "thermal", title: "Analisa Thermal Heatmap", sketch: sk });
  out.push({ kind: "stacking", id: "stacking", title: "Stacking Diagram", sketch: sk });
  out.push({ kind: "explode-axo", id: "explode-axo", title: "Diagram Aksonometri Eksplode · Tipe Layout", sketch: sk });
  // Slide Perspektif — ditempatkan setelah Aksonometri Eksplode.
  perspektifList.forEach((p, i) => {
    out.push({
      kind: "perspektif",
      id: `perspektif-${p.id}`,
      title: p.title.trim() || (perspektifList.length > 1 ? `Perspektif ${i + 1}` : "Perspektif"),
      sketch: sk,
      image: p.image,
      caption: p.title.trim() || (perspektifList.length > 1 ? `Perspektif ${i + 1}` : "Perspektif"),
      index: i,
      total: perspektifList.length,
    });
  });
  out.push({ kind: "rekap", id: "rekap", title: "Rekapitulasi", sketch: sk, data });
  // Rincian per Level — paginated jika tidak muat satu slide.
  {
    const ruangAll = (sk.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name));
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
  out.push({ kind: "komposisi", id: "komposisi", title: "Komposisi Ruang", sketch: sk, data });
  out.push({ kind: "biaya", id: "biaya", title: "Estimasi Biaya", sketch: sk, data });
  // Slide penutup
  out.push({ kind: "closing", id: "closing-slide", title: "Terima Kasih", sketch: sk });

  // Sisipkan Daftar Isi tepat setelah slide judul (index 1).
  // Page numbering setelah penyisipan: title=1, toc=2, rest mulai 3.
  const groupLabel = (s: Slide): string | null => {
    switch (s.kind) {
      case "site": return "Analisa Tapak";
      case "konsep": return "Konsep";
      case "perspektif": return "Perspektif";
      case "level": return "Denah per Level";
      case "bubble": return "Diagram Hubungan Ruang";
      case "section": return "Potongan Prinsip";
      case "matahari":
      case "shadow-seasonal":
      case "facade-zoning": return "Analisa Matahari & Fasad";
      case "wind": return "Analisa Iklim · Angin";
      case "thermal": return "Analisa Thermal Heatmap";
      case "stacking": return "Stacking Diagram";
      case "explode-axo": return "Aksonometri Eksplode";
      case "rekap": return "Rekapitulasi";
      case "rincian": return "Rincian per Level";
      case "infografis": return "Infografis";
      case "komposisi": return "Komposisi Ruang";
      case "biaya": return "Estimasi Biaya";
      case "closing": return "Penutup";
      case "masterplan": return "Master Plan";
      case "siteplan": return "Siteplan Kawasan";
      default: return null;
    }
  };
  const entries: TocEntry[] = [];
  const seen = new Set<string>();
  // out[0] is title; remaining items start at page 3 after TOC is inserted.
  for (let i = 1; i < out.length; i++) {
    const label = groupLabel(out[i]);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    entries.push({ label, page: i + 2 });
  }
  out.splice(1, 0, { kind: "toc", id: "toc-slide", title: "Daftar Isi", sketch: sk, entries });
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
    .filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name))
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

const SLIDE_VIEW_KEY = "dabidabis_slideview_v3";
type SlideView = { scale: number; tx: number; ty: number };
const COMPASS_VIEW_KEY = "dabidabis_compass_view_v1";
type CompassView = { x: number; y: number };
function loadSlideView(id: string): SlideView | null {
  try {
    const raw = localStorage.getItem(SLIDE_VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const s = v?.[id];
    if (!s) return null;
    if (typeof s.scale === "number" && typeof s.tx === "number" && typeof s.ty === "number") return s;
    return null;
  } catch { return null; }
}
function saveSlideView(id: string, view: SlideView | null) {
  try {
    const raw = localStorage.getItem(SLIDE_VIEW_KEY);
    const v = raw ? JSON.parse(raw) : {};
    if (view == null) delete v[id]; else v[id] = view;
    localStorage.setItem(SLIDE_VIEW_KEY, JSON.stringify(v));
  } catch { /* ignore */ }
}
function loadCompassView(id: string): CompassView | null {
  try {
    const raw = localStorage.getItem(COMPASS_VIEW_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw)?.[id];
    if (typeof s?.x === "number" && typeof s?.y === "number") return s;
    return null;
  } catch { return null; }
}
function saveCompassView(id: string, view: CompassView) {
  try {
    const raw = localStorage.getItem(COMPASS_VIEW_KEY);
    const v = raw ? JSON.parse(raw) : {};
    v[id] = view;
    localStorage.setItem(COMPASS_VIEW_KEY, JSON.stringify(v));
  } catch { /* ignore */ }
}

// Default: fit-to-box, centered. User can drag (1 finger / mouse) to pan,
// pinch with 2 fingers (or Ctrl+wheel) to zoom. Double-click to reset.
function ManualScaleBox({
  slideId, children, style,
}: { slideId: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [view, setView] = useState<SlideView | null>(() => loadSlideView(slideId));
  const viewRef = useRef<SlideView | null>(view);
  viewRef.current = view;

  useEffect(() => { setView(loadSlideView(slideId)); }, [slideId]);

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
      setFitScale(Math.min(box.width / cw, box.height / ch));
    };
    const ro = new ResizeObserver(() => measure());
    ro.observe(boxRef.current);
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(measure); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); ro.disconnect(); };
  }, [slideId]);

  const scale = view?.scale ?? fitScale;
  const tx = view?.tx ?? 0;
  const ty = view?.ty ?? 0;

  // Pointer-based pan + pinch
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    startView: SlideView;
    startDist?: number;
    startMid?: { x: number; y: number };
    startCenter?: { x: number; y: number }; // pointer in box coords at gesture start
  } | null>(null);

  const currentView = (): SlideView => viewRef.current ?? { scale: fitScale, tx: 0, ty: 0 };

  const boxRect = () => boxRef.current?.getBoundingClientRect();

  const onPointerDown = (e: React.PointerEvent) => {
    if (!boxRef.current || !natural) return;
    boxRef.current.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointersRef.current.values());
    const v = currentView();
    if (pts.length === 1) {
      gestureRef.current = { startView: v, startCenter: { x: pts[0].x, y: pts[0].y } };
    } else if (pts.length === 2) {
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy) || 1;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      gestureRef.current = { startView: v, startDist: dist, startMid: mid, startCenter: mid };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointersRef.current.values());
    const g = gestureRef.current;
    if (!g || !natural) return;
    const rect = boxRect();
    if (!rect) return;
    if (pts.length === 1 && g.startCenter) {
      // Pan
      const dx = pts[0].x - g.startCenter.x;
      const dy = pts[0].y - g.startCenter.y;
      const next = { scale: g.startView.scale, tx: g.startView.tx + dx, ty: g.startView.ty + dy };
      setView(next);
      viewRef.current = next;
    } else if (pts.length >= 2 && g.startDist && g.startMid) {
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy) || 1;
      const ratio = dist / g.startDist;
      const newScale = Math.max(0.1, Math.min(6, g.startView.scale * ratio));
      // Keep gesture midpoint anchored
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      // Convert start mid (box coord) to inner-untranslated coord at startView
      const cxBox = g.startMid.x - rect.left - rect.width / 2;
      const cyBox = g.startMid.y - rect.top - rect.height / 2;
      // Anchor: keep that inner point under the current mid pointer
      const sRatio = newScale / g.startView.scale;
      const tx = (g.startView.tx - cxBox) * sRatio + (mid.x - rect.left - rect.width / 2);
      const ty = (g.startView.ty - cyBox) * sRatio + (mid.y - rect.top - rect.height / 2);
      const next = { scale: newScale, tx, ty };
      setView(next);
      viewRef.current = next;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      saveSlideView(slideId, viewRef.current);
    } else {
      // Recalibrate remaining gesture
      const pts = Array.from(pointersRef.current.values());
      const v = currentView();
      if (pts.length === 1) {
        gestureRef.current = { startView: v, startCenter: { x: pts[0].x, y: pts[0].y } };
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return; // only ctrl-wheel zooms; normal wheel scrolls page
    e.preventDefault();
    const rect = boxRect();
    if (!rect) return;
    const v = currentView();
    const ratio = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.max(0.1, Math.min(6, v.scale * ratio));
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const sRatio = newScale / v.scale;
    const tx = (v.tx - cx) * sRatio + cx;
    const ty = (v.ty - cy) * sRatio + cy;
    const next = { scale: newScale, tx, ty };
    setView(next);
    viewRef.current = next;
    saveSlideView(slideId, next);
  };

  const reset = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setView(null);
    viewRef.current = null;
    saveSlideView(slideId, null);
  };

  return (
    <div
      ref={boxRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={reset}
      title="Tarik untuk geser · Cubit 2 jari untuk zoom · Klik dua kali untuk reset"
      style={{
        ...style,
        position: "relative",
        overflow: "hidden",
        touchAction: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: pointersRef.current.size > 0 ? "grabbing" : "grab",
      }}
    >
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          ref={innerRef}
          style={{
            width: natural ? natural.w : "100%",
            height: natural ? natural.h : "100%",
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
            flexShrink: 0,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
function SlideContent({ slide }: { slide?: Slide }) {
  if (!slide) return null;
  const isSpecial = slide.kind === "title" || slide.kind === "closing" || slide.kind === "konsep" || slide.kind === "perspektif";
  const body = (
    <>
      {slide.kind === "title" && <TitleBody slide={slide} />}
      {slide.kind === "toc" && <TocBody slide={slide} />}
      {slide.kind === "closing" && <ClosingBody slide={slide} />}
      {slide.kind === "level" && <LevelBody slide={slide} />}
      {slide.kind === "bubble" && <BubbleBody slide={slide} />}
      {slide.kind === "section" && <SectionBody slide={slide} />}
      {slide.kind === "site" && <SiteAnalysisBody slide={slide} />}
      {slide.kind === "konsep" && <KonsepBody slide={slide} />}
      {slide.kind === "perspektif" && <PerspektifBody slide={slide} />}
      {slide.kind === "matahari" && <MatahariBody slide={slide} />}
      {slide.kind === "shadow-seasonal" && <ShadowSeasonalBody slide={slide} />}
      {slide.kind === "facade-zoning" && <FacadeZoningBody slide={slide} />}
      {slide.kind === "wind" && <WindBody sketch={slide.sketch} />}
      {slide.kind === "thermal" && <ThermalBody sketch={slide.sketch} />}
      {slide.kind === "stacking" && <StackingBody sketch={slide.sketch} />}
      {slide.kind === "explode-axo" && <ExplodedAxoBody sketch={slide.sketch} />}
      {slide.kind === "rekap" && <RekapBody data={slide.data} sketch={slide.sketch} />}
      {slide.kind === "rincian" && <RincianBody slide={slide} />}
      {slide.kind === "infografis" && <InfografisBody data={slide.data} sketch={slide.sketch} />}
      {slide.kind === "komposisi" && <KomposisiBody data={slide.data} sketch={slide.sketch} />}
      {slide.kind === "biaya" && <BiayaBody data={slide.data} sketch={slide.sketch} />}
      {slide.kind === "masterplan" && <MasterPlanBody plan={slide.plan} analysis={slide.analysis} />}
      {slide.kind === "siteplan" && <SiteplanBody analysis={slide.analysis} />}
    </>
  );
  // All non-special slides default to centered fit; users can pan and pinch-to-zoom.
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
      {isSpecial ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
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
    : slide.kind === "bubble" ? "Diagram · Hubungan Ruang"
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
    : slide.kind === "wind" ? "Analisa · Iklim Angin"
    : slide.kind === "thermal" ? "Analisa · Thermal Heatmap"
    : slide.kind === "explode-axo" ? "Sketsa · Aksonometri Eksplode"
    : slide.kind === "rekap" ? "Tabulasi · Rekap"
    : slide.kind === "rincian" ? "Tabulasi · Rincian"
    : slide.kind === "infografis" ? "Tabulasi · Infografis"
    : slide.kind === "komposisi" ? "Tabulasi · Komposisi"
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

function formatProduksi(ts: number) {
  return new Date(ts || Date.now()).toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
function formatCetak(ts: number) {
  return new Date(ts).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function useNowOnMount() {
  const [now] = useState(() => Date.now());
  return now;
}
function SlideFooter({ slide }: { slide: Slide }) {
  const now = useNowOnMount();
  const produksi = formatProduksi(slide.sketch.createdAt);
  const cetak = formatCetak(now);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e5e5e5", paddingTop: 14, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#888" }}>
      <span style={{ fontWeight: 700, color: "#111" }}>Produksi {produksi}</span>
      <span>{slide.title}</span>
      <span>Cetak {cetak}</span>
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

function SlideCompass({ rotation, size = 92, draggableId }: { rotation: number; size?: number; draggableId?: string }) {
  const r = ((rotation % 360) + 360) % 360;
  const [pos, setPos] = useState<CompassView>(() => (draggableId ? loadCompassView(draggableId) ?? { x: 14, y: 14 } : { x: 0, y: 0 }));
  const posRef = useRef(pos);
  posRef.current = pos;
  const dragRef = useRef<{ startX: number; startY: number; origin: CompassView } | null>(null);

  useEffect(() => {
    if (draggableId) setPos(loadCompassView(draggableId) ?? { x: 14, y: 14 });
  }, [draggableId]);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggableId) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: posRef.current };
  };
  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = dragRef.current;
    if (!draggableId || !g) return;
    e.preventDefault();
    e.stopPropagation();
    const next = { x: g.origin.x + e.clientX - g.startX, y: g.origin.y + e.clientY - g.startY };
    setPos(next);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggableId) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = null;
    saveCompassView(draggableId, posRef.current);
  };

  return (
    <div
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title={draggableId ? "Tarik kompas untuk mengatur posisi" : undefined}
      style={{
        position: "absolute",
        ...(draggableId ? { left: pos.x, top: pos.y } : { right: 10, bottom: 10 }),
        width: size,
        height: size,
        cursor: draggableId ? "move" : "default",
        touchAction: draggableId ? "none" : "auto",
        pointerEvents: draggableId ? "auto" : "none",
        filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.18))",
        zIndex: 6,
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block" }}>
        {/* Thin circle */}
        <circle cx="50" cy="50" r="44" fill="rgba(255,255,255,0.92)" stroke="#0a0a0a" strokeWidth="0.8" />
        {/* Rotating north line */}
        <g transform={`rotate(${r} 50 50)`}>
          <line x1="50" y1="50" x2="50" y2="6" stroke="#0a0a0a" strokeWidth="4.5" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}
// ---- Title body ----
function TitleBody({ slide }: { slide: Extract<Slide, { kind: "title" }> }) {
  const now = useNowOnMount();
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
        <span style={{ fontWeight: 700, color: "#111" }}>Produksi {formatProduksi(slide.sketch.createdAt)}</span>
        <span>Skala {slide.sketch.scale}{slide.sketch.fungsi ? ` · ${slide.sketch.fungsi}` : ""}</span>
        <span>Cetak {formatCetak(now)}</span>
      </div>
    </div>
  );
}

// ---- Table of Contents body ----
function TocBody({ slide }: { slide: Extract<Slide, { kind: "toc" }> }) {
  const entries = slide.entries;
  const half = Math.ceil(entries.length / 2);
  const col1 = entries.slice(0, half);
  const col2 = entries.slice(half);
  const renderCol = (items: TocEntry[], startIdx: number) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minWidth: 0 }}>
      {items.map((e, i) => (
        <div
          key={`${e.label}-${e.page}-${i}`}
          style={{ display: "flex", alignItems: "baseline", gap: 12, fontFamily: "var(--font-sans, Manrope, sans-serif)" }}
        >
          <span style={{ fontSize: 13, color: "#888", fontVariantNumeric: "tabular-nums", width: 28, fontWeight: 600 }}>
            {String(startIdx + i + 1).padStart(2, "0")}
          </span>
          <span style={{ fontSize: 20, color: "#111", fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
            {e.label}
          </span>
          <span style={{ flex: 1, borderBottom: "1px dotted #c8c8c8", transform: "translateY(-4px)" }} />
          <span style={{ fontSize: 18, color: "#444", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            {String(e.page).padStart(2, "0")}
          </span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: "#888", fontWeight: 700 }}>
          Daftar Isi
        </div>
        <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#888" }}>
          {slide.sketch.title || "Proyek"}
        </div>
      </div>
      <div style={{ width: 80, height: 3, background: "#e85d3a", marginBottom: 24 }} />
      <div
        style={{
          fontFamily: "var(--font-display, Sora, sans-serif)",
          fontSize: 56,
          lineHeight: 1.05,
          letterSpacing: "-0.03em",
          fontWeight: 700,
          color: "#0a0a0a",
          marginBottom: 32,
        }}
      >
        Ikhtisar Presentasi
      </div>
      <div style={{ display: "flex", gap: 64, flex: 1, alignItems: "flex-start" }}>
        {renderCol(col1, 0)}
        {col2.length > 0 && renderCol(col2, col1.length)}
      </div>
    </div>
  );
}



// ---- Closing body ----
function ClosingBody({ slide }: { slide: Extract<Slide, { kind: "closing" }> }) {
  const now = useNowOnMount();
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
        <span style={{ fontWeight: 700, color: "#fff" }}>Produksi {formatProduksi(slide.sketch.createdAt)}</span>
        <span style={{ color: "#888" }}>Skala {slide.sketch.scale}{slide.sketch.fungsi ? ` · ${slide.sketch.fungsi}` : ""}</span>
        <span style={{ color: "#888" }}>Cetak {formatCetak(now)}</span>
      </div>
    </div>
  );
}

// ---- Section body (Potongan Prinsip A-A, dinamis dari sketch.sectionCut) ----
const SECTION_METERS_PER_MAJOR: Record<string, number> = {
  "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10, "1:1200": 12, "1:1500": 15, "1:2000": 20,
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
    slices: Array<{ x0: number; x1: number; layerId: string; name: string; color: string; areaM2: number; heightOverride?: number; baseDelta?: number }>;
  };
  // Gunakan expand untuk turunkan tinggi tiap lantai sesuai Elev gap (k=1) atau
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
        layerId: layer.id,
        name: layer.name,
        color: roomFillOverride(layer.name, "0.55") ?? ((colorForRoomName(layer.name) ?? layer.color)?.replace("ALPHA", "0.55") ?? "rgba(232,93,58,0.5)"),
        areaM2: layer.areaM2 || 0,
        heightOverride,
        baseDelta,
      });
    }
  }

  // Build legend: kelompokkan berdasar NAMA, lalu pecah lagi jika
  // selisih luas antar item > 2 m². Setiap kelompok menampilkan rata-rata
  // luas (bukan akumulasi).
  const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const AREA_TOL = 2; // m²
  type LR = {
    key: string; number: number; name: string; color: string;
    areas: number[]; areaM2: number; levelName: string; layerIds: string[];
  };
  const legendByName = new Map<string, LR[]>();
  const legendRooms: LR[] = [];
  const sortedBoxesForLegend = [...boxes].sort((a, b) => a.baseM - b.baseM);
  for (const b of sortedBoxesForLegend) {
    for (const sl of b.slices) {
      const nk = nameKey(sl.name);
      const buckets = legendByName.get(nk) ?? [];
      // cari bucket dengan rata-rata luas dalam toleransi
      let bucket = buckets.find((bk) => Math.abs(bk.areaM2 - sl.areaM2) <= AREA_TOL);
      if (!bucket) {
        bucket = {
          key: `${nk}#${buckets.length + 1}`,
          number: legendRooms.length + 1,
          name: sl.name,
          color: sl.color,
          areas: [],
          areaM2: 0,
          levelName: b.name,
          layerIds: [],
        };
        buckets.push(bucket);
        legendByName.set(nk, buckets);
        legendRooms.push(bucket);
      }
      bucket.areas.push(sl.areaM2);
      bucket.areaM2 = bucket.areas.reduce((a, x) => a + x, 0) / bucket.areas.length;
      bucket.layerIds.push(sl.layerId);
    }
  }
  const numberByLayerId = new Map<string, number>();
  for (const r of legendRooms) for (const id of r.layerIds) numberByLayerId.set(id, r.number);

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
  const BUBBLE_PAD = hasGrid ? 60 : 40;
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
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 16, alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
        <svg
          width="100%" height="100%"
          viewBox={`0 0 ${AREA_W} ${AREA_H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block", background: "#ffffff" }}
        >
          <defs>
            <pattern id={`mm-minor-${slide.id}`} width={gridMinor} height={gridMinor} patternUnits="userSpaceOnUse">
              <path d={`M ${gridMinor} 0 L 0 0 0 ${gridMinor}`} fill="none" stroke="#e7e2d4" strokeWidth={0.5} />
            </pattern>
            <pattern id={`mm-major-${slide.id}`} width={gridMajor} height={gridMajor} patternUnits="userSpaceOnUse">
              <rect width={gridMajor} height={gridMajor} fill={`url(#mm-minor-${slide.id})`} />
              <path d={`M ${gridMajor} 0 L 0 0 0 ${gridMajor}`} fill="none" stroke="#d6cfb8" strokeWidth={0.8} />
            </pattern>
            {/* Hatch 45° rapat (1 garis / 100 mm skala asli) untuk dinding solid pada potongan. */}
            {(() => {
              const gap = Math.max(1.2, scalePxPerM * 0.1);
              return (
                <pattern
                  id={`hatch45-sec-${slide.id}`}
                  patternUnits="userSpaceOnUse"
                  width={gap} height={gap}
                  patternTransform="rotate(45)"
                >
                  <line x1={0} y1={0} x2={0} y2={gap} stroke="#0a0a0a" strokeWidth={0.35} />
                </pattern>
              );
            })()}
            {/* Notasi beton — pola titik (bintik) untuk slab lantai & balok. */}
            <pattern id={`concrete-dot-${slide.id}`} width={5} height={5} patternUnits="userSpaceOnUse">
              <rect width={5} height={5} fill="#ece6d3" />
              <circle cx={1.2} cy={1.2} r={0.55} fill="#1a1a1a" />
              <circle cx={3.7} cy={3.7} r={0.55} fill="#1a1a1a" />
              <circle cx={3.7} cy={1.2} r={0.32} fill="#3a3a3a" />
              <circle cx={1.2} cy={3.7} r={0.32} fill="#3a3a3a" />
            </pattern>
          </defs>
          <rect x={0} y={0} width={AREA_W} height={AREA_H} fill="#ffffff" />

          {/* Lahan / ground line — terikat MDPL 0 */}
          <line x1={mx(0) - 30} y1={my(groundMdpl)} x2={mx(cutLenM) + 30} y2={my(groundMdpl)} stroke="#111" strokeWidth={1.6} />
          <text x={mx(0) - 36} y={my(groundMdpl) - 5} fontSize={10} textAnchor="end" fill="#111" style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700 }}>
            Lahan ±0 Elev
          </text>
          {/* Hatching lahan */}
          {Array.from({ length: 18 }).map((_, i) => {
            const x = mx(0) - 20 + i * ((cutLenM * scalePxPerM + 40) / 18);
            return (
              <line key={i} x1={x} y1={my(groundMdpl)} x2={x - 8} y2={my(groundMdpl) + 10}
                stroke="#111" strokeWidth={0.7} />
            );
          })}

          {/* Proyeksi latar tampak — siluet perimeter luar bangunan dari
              ruang-ruang di belakang garis potongan. Digambar SEBELUM slice
              ruang yang terpotong agar otomatis tertutup di dalam ruang
              yang terpotong (slice foreground berisi fill solid). */}
          {(() => {
            const ddx = cut.p2.x - cut.p1.x;
            const ddy = cut.p2.y - cut.p1.y;
            const L2 = ddx * ddx + ddy * ddy;
            if (L2 < 1e-6) return null;
            return boxes.flatMap((b) => {
              const ranges: Array<[number, number]> = [];
              for (const layer of sketch.layers ?? []) {
                if (layer.levelId !== b.id) continue;
                if (isLahanSec(layer.name) || isVoidSec(layer.name)) continue;
                if (!layer.points || layer.points.length < 2) continue;
                let tMin = Infinity, tMax = -Infinity;
                for (const p of layer.points) {
                  const t = ((p.x - cut.p1.x) * ddx + (p.y - cut.p1.y) * ddy) / L2;
                  if (t < tMin) tMin = t;
                  if (t > tMax) tMax = t;
                }
                if (!isFinite(tMin)) continue;
                const a = Math.max(0, Math.min(1, tMin)) * cutLenM;
                const c = Math.max(0, Math.min(1, tMax)) * cutLenM;
                if (c - a > 1e-3) ranges.push([a, c]);
              }
              if (!ranges.length) return [];
              ranges.sort((a, c) => a[0] - c[0]);
              const merged: Array<[number, number]> = [];
              for (const r of ranges) {
                if (merged.length && r[0] <= merged[merged.length - 1][1] + 1e-4) {
                  merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
                } else merged.push([r[0], r[1]]);
              }
              return Array.from({ length: Math.max(1, b.count) }).flatMap((_, fi) => {
                const baseM = b.baseM + fi * b.floorH;
                const topM = baseM + b.floorH;
                const yT = my(topM);
                const hPx = b.floorH * scalePxPerM;
                return merged.map(([a, c], i) => (
                  <rect
                    key={`proj-${b.id}-${fi}-${i}`}
                    x={mx(a)} y={yT}
                    width={(c - a) * scalePxPerM} height={hPx}
                    fill="none" stroke="#000000" strokeWidth={0.35}
                    pointerEvents="none"
                  />
                ));
              });
            });
          })()}

          {/* Room slices per level — digambar lebih dulu agar notasi
              dinding / lantai / balok berada DI ATAS layer ruang. */}
          {boxes.map((b) => {
            // Default font untuk slice non-taman/non-atap-hijau di box ini,
            // dipakai sebagai ukuran label untuk Taman & Atap Hijau (yang
            // umumnya tipis dan menghasilkan font sangat kecil bila dihitung
            // dari geometri slice-nya sendiri).
            const normalSlices = b.slices.filter(
              (sl) => !isTaman(sl.name) && !isAtapHijau(sl.name),
            );
            let defaultFs = 12;
            if (normalSlices.length) {
              const widest = normalSlices.reduce((a, c) =>
                (c.x1 - c.x0) > (a.x1 - a.x0) ? c : a,
              );
              const w0 = (widest.x1 - widest.x0) * scalePxPerM;
              const h0 = (widest.heightOverride ?? b.floorH) * scalePxPerM;
              defaultFs = Math.max(8, Math.min(16, Math.min(w0 * 0.5, h0 * 0.6)));
            }
            return b.slices.flatMap((sl, i) => {
              const x = mx(sl.x0);
              const w = (sl.x1 - sl.x0) * scalePxPerM;
              const sliceHM = sl.heightOverride ?? b.floorH;
              const num = numberByLayerId.get(sl.layerId);
              const label = num != null ? String(num) : "";
              const isGreen = isTaman(sl.name) || isAtapHijau(sl.name);
              return Array.from({ length: Math.max(1, b.count) }).map((_, fi) => {
                const sliceBaseM = b.baseM + fi * b.floorH + (sl.baseDelta ?? 0);
                const sliceTopM = sliceBaseM + sliceHM;
                const y = my(sliceTopM);
                const h = sliceHM * scalePxPerM;
                const cx = x + w / 2, cy = y + h / 2;
                const labelFs = isGreen
                  ? defaultFs
                  : Math.max(8, Math.min(16, Math.min(w * 0.5, h * 0.6)));
                // Untuk Taman/Atap Hijau, posisikan nomor 3 m di atas permukaan slice
                // (mengikuti permintaan: nomor diletakkan 3 m di atas ruangnya).
                const labelY = isGreen ? my(sliceTopM + 3) : cy;
                return (
                  <g key={`${b.id}-${i}-${fi}`}>
                    <rect x={x} y={y} width={w} height={h} fill={sl.color} stroke="#222" strokeWidth={0.5} />
                    {label && (
                      <text x={cx} y={labelY} fontSize={labelFs} fill="#111" textAnchor="middle" dominantBaseline="middle"
                        style={{ fontFamily: "Sora, sans-serif", fontWeight: 700 }}>
                        {label}
                      </text>
                    )}
                  </g>
                );
              });
            });
          })}

          {/* Level boxes — pelat lantai tebal HANYA di bawah ruang;
              di luar ruang berupa garis putus-putus tipis.
              Dinding luar level basement (di bawah MDPL 0) dan lantai paling bawah
              dibuat 2x lebih tebal dari garis lantai.
              Digambar SETELAH room slices agar selalu terlihat di atas warna ruang. */}
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
            const FLOOR_THICK_HEAVY = 4.8;
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

          {/* Slab lantai (150 mm) + Balok (400×700 mm) di setiap as grid.
              Notasi: beton dengan pola bintik. */}
          {(() => {
            const floors = sketch.floors ?? [];
            if (!floors.length) return null;
            const SLAB_M = FLOOR_THICKNESS_MM / 1000;
            const BEAM_W_M = 0.4;
            const BEAM_H_M = 0.7;

            // Cut intersection intervals (in cut-meters) untuk satu floor (outer minus holes).
            const intervalsFor = (fl: Floor): Array<[number, number]> => {
              const outer = cutPolygonIntervals(cut.p1, cut.p2, fl.outer);
              if (!outer.length) return [];
              const holes = (fl.holes ?? []).flatMap((h) => cutPolygonIntervals(cut.p1, cut.p2, h));
              let segs: Array<[number, number]> = outer.map(([a, b]) => [a, b]);
              for (const [ha, hb] of holes) {
                const next: Array<[number, number]> = [];
                for (const [a, b] of segs) {
                  if (hb <= a || ha >= b) { next.push([a, b]); continue; }
                  if (ha > a) next.push([a, Math.min(b, ha)]);
                  if (hb < b) next.push([Math.max(a, hb), b]);
                }
                segs = next;
              }
              return segs
                .filter(([a, b]) => b - a > 1e-5)
                .map(([a, b]) => [a * cutLenM, b * cutLenM] as [number, number]);
            };

            // Pusat balok (cut-meters) — proyeksi semua as grid X & Y ke garis potongan.
            const ppm = pxPerMeter;
            const ddx = cut.p2.x - cut.p1.x;
            const ddy = cut.p2.y - cut.p1.y;
            const beamCenters: number[] = [];
            for (const grid of collectGrids(sketch.structuralGrid, sketch.structuralGridExtras)) {
              const axX = axisPositions(grid.spansX);
              for (let i = 0; i < axX.length; i++) {
                const planX = grid.origin.x + axX[i] * ppm;
                if (Math.abs(ddx) < 1e-6) continue;
                const t = (planX - cut.p1.x) / ddx;
                if (t < -0.001 || t > 1.001) continue;
                beamCenters.push(Math.max(0, Math.min(1, t)) * cutLenM);
              }
              if (!grid.lineOnly) {
                const axY = axisPositions(grid.spansY);
                for (let j = 0; j < axY.length; j++) {
                  const planY = grid.origin.y + axY[j] * ppm;
                  if (Math.abs(ddy) < 1e-6) continue;
                  const t = (planY - cut.p1.y) / ddy;
                  if (t < -0.001 || t > 1.001) continue;
                  beamCenters.push(Math.max(0, Math.min(1, t)) * cutLenM);
                }
              }
            }
            // Dedupe pusat balok yang terlalu dekat (< setengah lebar balok).
            beamCenters.sort((a, b) => a - b);
            const uniqCenters: number[] = [];
            for (const c of beamCenters) {
              if (!uniqCenters.length || c - uniqCenters[uniqCenters.length - 1] > BEAM_W_M * 0.5) {
                uniqCenters.push(c);
              }
            }

            const fill = "#e8e8e8";
            const strokeCol = "#111";
            const swSlab = 0.4;
            return floors.flatMap((fl) => {
              const copies = floorsExp.filter((e) => e.sourceId === fl.levelId);
              if (!copies.length) return [];
              const intervals = intervalsFor(fl);
              if (!intervals.length) return [];
              return copies.map((cp) => {
                const topM = cp.mdpl;
                const yTop = my(topM);
                const ySlabBot = my(topM - SLAB_M);
                const yBeamBot = my(topM - SLAB_M - BEAM_H_M);
                const EDGE_BEAM_W_M = 0.2;
                return (
                  <g key={`slab-${fl.id}-${cp.id}`}>
                    {intervals.map(([a, b], i) => (
                      <rect key={`s${i}`}
                        x={mx(a)} y={yTop}
                        width={(b - a) * scalePxPerM} height={ySlabBot - yTop}
                        fill={fill} stroke={strokeCol} strokeWidth={swSlab} strokeLinejoin="miter" />
                    ))}
                    {uniqCenters.map((bc, i) => {
                      const inside = intervals.some(([a, b]) => bc >= a - 1e-3 && bc <= b + 1e-3);
                      if (!inside) return null;
                      const x0 = mx(bc - BEAM_W_M / 2);
                      const w = BEAM_W_M * scalePxPerM;
                      const yTopBeam = ySlabBot - 0.2;
                      return (
                        <rect key={`b${i}`}
                          x={x0} y={yTopBeam}
                          width={w} height={yBeamBot - yTopBeam}
                          fill={fill} stroke={strokeCol} strokeWidth={swSlab} strokeLinejoin="miter" />
                      );
                    })}
                    {/* Balok tepi pada setiap ujung lantai / tepi void — 200mm × 700mm */}
                    {intervals.flatMap(([a, b], i) => {
                      const w = EDGE_BEAM_W_M * scalePxPerM;
                      const yTopBeam = ySlabBot - 0.2;
                      return [a, b].map((edge, k) => (
                        <rect key={`eb${i}-${k}`}
                          x={mx(edge - EDGE_BEAM_W_M / 2)} y={yTopBeam}
                          width={w} height={yBeamBot - yTopBeam}
                          fill={fill} stroke={strokeCol} strokeWidth={swSlab} strokeLinejoin="miter" />
                      ));
                    })}
                    {/* Garis tipis penghubung ujung bawah balok dengan kedua ujung dinding (slab) */}
                    {intervals.map(([a, b], i) => (
                      <line key={`bl${i}`}
                        x1={mx(a)} y1={yBeamBot}
                        x2={mx(b)} y2={yBeamBot}
                        stroke={strokeCol} strokeWidth={0.4} strokeLinecap="square" />
                    ))}
                  </g>
                );
              });
            });
          })()}

          {/* Pohon di permukaan Taman pada potongan — kanopi hijau solid 50%,
              tinggi total acak (kanopi..5 m) dari permukaan level. */}
          {boxes.flatMap((b) =>
            b.slices.filter((sl) => isTaman(sl.name) || isAtapHijau(sl.name)).flatMap((sl) =>
              Array.from({ length: Math.max(1, b.count) }).flatMap((_, fi) => {
                const sliceBaseM = b.baseM + fi * b.floorH + (sl.baseDelta ?? 0);
                const sliceHM = sl.heightOverride ?? b.floorH;
                const surfaceMdpl = sliceBaseM + sliceHM;
                const trees = planTamanTreesAlong(sl.x0, sl.x1, `taman-sec-${b.id}-${sl.layerId}-${fi}`);
                return trees.map((t, ti) => {
                  const cxPx = mx(t.xM);
                  const rPx = (t.canopyDm / 2) * scalePxPerM;
                  const canopyCenterMdpl = surfaceMdpl + t.heightM - t.canopyDm / 2;
                  const trunkBotPx = my(surfaceMdpl);
                  const trunkTopPx = my(canopyCenterMdpl);
                  return (
                    <g key={`taman-tree-${b.id}-${sl.layerId}-${fi}-${ti}`} pointerEvents="none">
                      <line x1={cxPx} y1={trunkBotPx} x2={cxPx} y2={trunkTopPx}
                        stroke="#5a3a1e" strokeWidth={Math.max(0.8, scalePxPerM * 0.08)} strokeLinecap="round" />
                      <circle cx={cxPx} cy={my(canopyCenterMdpl)} r={rPx}
                        fill="rgba(22,163,74,0.5)" />
                    </g>
                  );
                });
              })
            )
          )}





          {/* Notasi material selubung pada potongan — dihitung dari edgeAttrs */}
          {(() => {
            const attrs = sketch.edgeAttrs ?? {};
            if (!Object.keys(attrs).length) return null;
            const allSegs = computeStraightSegments(
              (sketch.lines ?? []).map((l) => ({ a: l.a, b: l.b, kind: l.kind, levelId: l.levelId })),
            );
            type Hit = { t: number; mat: EdgeMaterial; levelId?: string };
            const hits: Hit[] = [];
            for (const seg of allSegs) {
              const mat = attrs[segmentIdFor(seg.a, seg.b)];
              if (!mat) continue;
              const t = intersectSegmentWithCut({ a: seg.a, b: seg.b }, cut.p1, cut.p2);
              if (t == null) continue;
              hits.push({ t, mat, levelId: seg.levelId });
            }
            if (!hits.length) return null;
            return (
              <g>
                {boxes.map((b) => {
                  const relevant = hits.filter((h) => !h.levelId || h.levelId === b.id);
                  return relevant.map((h, idx) => {
                    const cx = mx(h.t * cutLenM);
                    const bandW = Math.max(2, (WALL_THICK_MM[h.mat] / 1000) * scalePxPerM);
                    const x = cx - bandW / 2;
                    const yTop = my(b.topM);
                    const yBot = my(b.baseM);
                    const totalH = yBot - yTop;
                    if (h.mat === "solid") {
                      return (
                        <g key={`mat-${b.id}-${idx}`}>
                          <rect x={x} y={yTop} width={bandW} height={totalH}
                            fill="#ffffff" stroke="#0a0a0a" strokeWidth={0.8} />
                          <rect x={x} y={yTop} width={bandW} height={totalH}
                            fill={`url(#hatch45-sec-${slide.id})`} stroke="none" />
                        </g>
                      );
                    }
                    if (h.mat === "curtain") {
                      return (
                        <g key={`mat-${b.id}-${idx}`}>
                          <rect x={x} y={yTop} width={bandW} height={totalH}
                            fill="rgba(34,211,238,0.28)" stroke="#0a0a0a" strokeWidth={0.5} />
                          <line x1={x + bandW / 2} y1={yTop} x2={x + bandW / 2} y2={yBot}
                            stroke="#0a0a0a" strokeWidth={0.4} strokeDasharray="2 3" />
                        </g>
                      );
                    }
                    // window: dinding 0–0.9m, kaca 0.9–2.4m, dinding 2.4–plafon (relatif ke baseM)
                    const ySill = my(b.baseM + 0.9);
                    const yHead = my(b.baseM + 2.4);
                    const yCap = Math.max(yTop, yHead);
                    return (
                      <g key={`mat-${b.id}-${idx}`}>
                        {/* Dinding bawah */}
                        <rect x={x} y={ySill} width={bandW} height={yBot - ySill}
                          fill="#ffffff" stroke="#0a0a0a" strokeWidth={0.6} />
                        {/* Kaca tengah */}
                        <rect x={x} y={yCap} width={bandW} height={ySill - yCap}
                          fill="rgba(34,211,238,0.28)" stroke="#0a0a0a" strokeWidth={0.5} />
                        <line x1={x + bandW / 2} y1={yCap} x2={x + bandW / 2} y2={ySill}
                          stroke="#0a0a0a" strokeWidth={0.4} strokeDasharray="2 3" />
                        {/* Dinding atas */}
                        {yCap > yTop && (
                          <rect x={x} y={yTop} width={bandW} height={yCap - yTop}
                            fill="#ffffff" stroke="#0a0a0a" strokeWidth={0.6} />
                        )}
                      </g>
                    );
                  });
                })}
              </g>
            );
          })()}



          {/* Elevation labels (kiri) — per lantai, termasuk setiap floor pada level tipikal */}
          {boxes.flatMap((b) => {
            const xLabel = mx(0) - 8;
            const out: Array<React.ReactNode> = [];
            for (let fi = 0; fi < Math.max(1, b.count); fi++) {
              const baseM = b.baseM + fi * b.floorH;
              const topM = baseM + b.floorH;
              const yBase = my(baseM);
              const yTop = my(topM);
              out.push(
                <g key={`elev-${b.id}-${fi}`}>
                  <line x1={mx(0) - 36} y1={yTop} x2={mx(0)} y2={yTop} stroke="#111" strokeWidth={0.6} />
                  <text x={xLabel} y={yTop - 3} fontSize={9} textAnchor="end" fill="#111"
                    style={{ fontFamily: "Manrope, sans-serif" }}>
                    +{topM.toFixed(2)} Elev
                  </text>
                  {fi === 0 && (
                    <text x={xLabel} y={yBase - 3} fontSize={9} textAnchor="end" fill="#444"
                      style={{ fontFamily: "Manrope, sans-serif" }}>
                      +{baseM.toFixed(2)} Elev
                    </text>
                  )}
                </g>
              );
            }
            return out;
          })}

          {/* Dimensi tinggi bersih per lantai (kanan), termasuk setiap floor pada level tipikal */}
          {boxes.flatMap((b) => {
            const x = mx(cutLenM) + 8;
            const out: Array<React.ReactNode> = [];
            for (let fi = 0; fi < Math.max(1, b.count); fi++) {
              const baseM = b.baseM + fi * b.floorH;
              const topM = baseM + b.floorH;
              const y1 = my(topM);
              const y2 = my(baseM);
              const cy = (y1 + y2) / 2;
              const dim = Math.round(b.floorH * 1000);
              out.push(
                <g key={`dim-${b.id}-${fi}`}>
                  <line x1={x} y1={y1} x2={x} y2={y2} stroke="#111" strokeWidth={0.8} />
                  <line x1={x - 4} y1={y1} x2={x + 4} y2={y1} stroke="#111" strokeWidth={0.8} />
                  <line x1={x - 4} y1={y2} x2={x + 4} y2={y2} stroke="#111" strokeWidth={0.8} />
                  <text x={x + 8} y={cy + 3} fontSize={9} fill="#111"
                    style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600 }}>
                    {dim} mm
                  </text>
                </g>
              );
            }
            return out;
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


          {/* Penanda bubble potongan di ujung area gambar — mengikuti label cut */}
          {(() => {
            const tag = ((cut.label || "A-A").split("-")[0] || "A").trim();
            return (
              <g>
                <circle cx={mx(0)} cy={my(maxMdpl) - 18} r={10} fill="#111" />
                <text x={mx(0)} y={my(maxMdpl) - 18} fontSize={11} fill="#fff" textAnchor="middle" dominantBaseline="middle" fontWeight={700}>{tag}</text>
                <circle cx={mx(cutLenM)} cy={my(maxMdpl) - 18} r={10} fill="#111" />
                <text x={mx(cutLenM)} y={my(maxMdpl) - 18} fontSize={11} fill="#fff" textAnchor="middle" dominantBaseline="middle" fontWeight={700}>{`${tag}'`}</text>
              </g>
            );
          })()}

          {/* Skala panjang potongan dihapus — diganti dimensi bentang grid */}

          {/* Grid struktur vertikal — diproyeksikan ke garis potongan (semua grid aktif) */}
          {collectGrids(sketch.structuralGrid, sketch.structuralGridExtras).map((grid, gIdx) => {
            const ppm = pxPerMeter;
            const ox = grid.origin.x, oy = grid.origin.y;
            const ddx = cut.p2.x - cut.p1.x;
            const ddy = cut.p2.y - cut.p1.y;
            type Hit = { t: number; label: string; key: string };
            const hits: Hit[] = [];
            const axX = axisPositions(grid.spansX);
            const lastIX = axX.length - 1;
            for (let i = 0; i < axX.length; i++) {
              if (i === 0 && grid.hideBubbleStartX) continue;
              if (i === lastIX && grid.hideBubbleEndX) continue;
              const planX = ox + axX[i] * ppm;
              if (Math.abs(ddx) < 1e-6) continue;
              const t = (planX - cut.p1.x) / ddx;
              if (t < -0.001 || t > 1.001) continue;
              hits.push({ t: Math.max(0, Math.min(1, t)), label: xAxisLabelAt(i, grid.labelOffsetX ?? 0), key: `g${gIdx}x${i}` });
            }
            if (!grid.lineOnly) {
              const axY = axisPositions(grid.spansY);
              const lastIY = axY.length - 1;
              for (let j = 0; j < axY.length; j++) {
                if (j === 0 && grid.hideBubbleStartY) continue;
                if (j === lastIY && grid.hideBubbleEndY) continue;
                const planY = oy + axY[j] * ppm;
                if (Math.abs(ddy) < 1e-6) continue;
                const t = (planY - cut.p1.y) / ddy;
                if (t < -0.001 || t > 1.001) continue;
                hits.push({ t: Math.max(0, Math.min(1, t)), label: yAxisLabelAt(j, grid.labelOffsetY ?? 0), key: `g${gIdx}y${j}` });
              }
            }
            if (!hits.length) return null;
            const yTopPx = my(maxMdpl);
            const yFloorBottom = my(minMdpl);
            const rBub = 7;
            // Bubble digeser mendekat ke bawah lantai terbawah; dimensi di atas buble
            // (di antara lantai terbawah dan buble).
            const yBub = yFloorBottom + 32;
            const yDim = yFloorBottom + 14;
            // Sort hits by t, dedupe near-identical positions, dan hitung
            // bentang antar buble (mm) untuk ditampilkan di atas buble.
            const sorted = [...hits].sort((a, b) => a.t - b.t);
            const dims: Array<{ x: number; mm: number }> = [];
            for (let i = 0; i < sorted.length - 1; i++) {
              const a = sorted[i], b = sorted[i + 1];
              const dM = (b.t - a.t) * cutLenM;
              if (dM <= 0.05) continue;
              const xa = mx(a.t * cutLenM);
              const xb = mx(b.t * cutLenM);
              dims.push({ x: (xa + xb) / 2, mm: Math.round(dM * 1000) });
            }
            return (
              <g key={`sg-${gIdx}`} pointerEvents="none">
                {hits.map((h) => {
                  const sx = mx(h.t * cutLenM);
                  return (
                    <g key={h.key}>
                      <line x1={sx} y1={yTopPx} x2={sx} y2={yFloorBottom}
                        stroke="#0a0a0a" strokeWidth={0.15}
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
                {dims.map((d, i) => (
                  <text key={`gd-${gIdx}-${i}`} x={d.x} y={yDim}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={9} fontWeight={600} fill="#0a0a0a"
                    style={{ fontFamily: "Manrope, sans-serif",
                      paintOrder: "stroke", stroke: "rgba(255,255,255,0.92)", strokeWidth: 3 } as React.CSSProperties}>
                    {d.mm}
                  </text>
                ))}
              </g>
            );
          })}

          {/* Notasi railing pada potongan — per lantai, tinggi 1.2 m, lebar 100 mm,
              dua garis tipis vertikal + cap horizontal di puncak. */}
          {(() => {
            const attrs = sketch.edgeAttrs ?? {};
            const allSegs = computeStraightSegments(
              (sketch.lines ?? []).map((l) => ({ a: l.a, b: l.b, kind: l.kind, levelId: l.levelId })),
            );
            const railingHits: Array<{ t: number; levelId?: string }> = [];
            for (const seg of allSegs) {
              if (attrs[segmentIdFor(seg.a, seg.b)] !== "railing") continue;
              const t = intersectSegmentWithCut({ a: seg.a, b: seg.b }, cut.p1, cut.p2);
              if (t == null) continue;
              railingHits.push({ t, levelId: seg.levelId });
            }
            if (!railingHits.length) return null;
            const bandW = Math.max(2, 0.1 * scalePxPerM);
            const railH = 1.2 * scalePxPerM;
            const sw = 0.7;
            return (
              <g>
                {boxes.flatMap((b) => {
                  const rel = railingHits.filter((h) => !h.levelId || h.levelId === b.id);
                  return rel.flatMap((h, idx) =>
                    Array.from({ length: Math.max(1, b.count) }).map((_, fi) => {
                      const floorBaseM = b.baseM + fi * b.floorH;
                      const cx = mx(h.t * cutLenM);
                      const xL = cx - bandW / 2, xR = cx + bandW / 2;
                      const yBot = my(floorBaseM);
                      const yTop = yBot - railH;
                      return (
                        <g key={`rail-${b.id}-${idx}-${fi}`}>
                          <line x1={xL} y1={yBot} x2={xL} y2={yTop} stroke={RAILING_COLOR} strokeWidth={sw} strokeLinecap="square" />
                          <line x1={xR} y1={yBot} x2={xR} y2={yTop} stroke={RAILING_COLOR} strokeWidth={sw} strokeLinecap="square" />
                          <line x1={xL} y1={yTop} x2={xR} y2={yTop} stroke={RAILING_COLOR} strokeWidth={sw} strokeLinecap="square" />
                        </g>
                      );
                    })
                  );
                })}
              </g>
            );
          })()}

          {/* Garis batas lahan & GSB pada potongan — garis putus-putus vertikal
              setinggi rentang elevasi. Ketebalan sama dengan garis dimensi.
              Batas lahan tetap berlabel; garis GSB tanpa teks. */}
          {(() => {
            const lahanLayers = (sketch.layers ?? []).filter((l) => isLahanSec(l.name));
            if (!lahanLayers.length) return null;
            const yT = my(maxMdpl);
            const yB = my(minMdpl);
            const midY = (yT + yB) / 2;
            const fs = 11;
            const sw = 0.8; // sama dengan garis dimensi
            const sketchPxPerM = 1 / sketchMetersPerSketchPx(sketch.scale);

            const collectTs = (segments: Array<{ a: Point; b: Point }>): number[] => {
              const ts: number[] = [];
              for (const s of segments) {
                const t = cutSegmentIntersectParam(cut.p1, cut.p2, s.a, s.b);
                if (t != null && t > 1e-6 && t < 1 - 1e-6) ts.push(t);
              }
              ts.sort((a, b) => a - b);
              const uniq: number[] = [];
              for (const t of ts) {
                if (!uniq.length || Math.abs(uniq[uniq.length - 1] - t) > 1e-3) uniq.push(t);
              }
              return uniq;
            };

            // Batas lahan: edges of lahan polygons
            const lahanSegs: Array<{ a: Point; b: Point }> = [];
            for (const ly of lahanLayers) {
              for (let i = 0; i < ly.points.length; i++) {
                lahanSegs.push({ a: ly.points[i], b: ly.points[(i + 1) % ly.points.length] });
              }
            }
            // GSB: inward-offset segment per edge dengan gsb>0
            const gsbSegs: Array<{ a: Point; b: Point }> = [];
            for (const ly of lahanLayers) {
              for (let i = 0; i < ly.points.length; i++) {
                const g = getLayerGsbM(ly, i);
                if (g <= 0) continue;
                const seg = inwardOffsetSegPx(ly.points, i, g * sketchPxPerM);
                gsbSegs.push({ a: seg.a, b: seg.b });
              }
            }

            const renderGroup = (ts: number[], color: string, text: string, keyPrefix: string) => {
              if (!ts.length) return null;
              const hasText = text.trim().length > 0;
              const textH = hasText ? text.length * fs * 0.62 : 0;
              const halfH = hasText ? textH / 2 + 2 : 0;
              return (
                <g pointerEvents="none">
                  {ts.map((t, i) => {
                    const xx = mx(t * cutLenM);
                    return (
                      <g key={`${keyPrefix}-${i}`}>
                        {hasText ? (
                          <>
                            <line x1={xx} y1={yT} x2={xx} y2={midY - halfH}
                              stroke={color} strokeWidth={sw} strokeDasharray="7 5" />
                            <line x1={xx} y1={midY + halfH} x2={xx} y2={yB}
                              stroke={color} strokeWidth={sw} strokeDasharray="7 5" />
                            <text x={xx} y={midY} fontSize={fs} fill={color}
                              textAnchor="middle" dominantBaseline="central"
                              transform={`rotate(-90 ${xx} ${midY})`}
                              style={{ fontFamily: "Sora, sans-serif", fontWeight: 400, letterSpacing: "0.18em" }}>
                              {text}
                            </text>
                          </>
                        ) : (
                          <line x1={xx} y1={yT} x2={xx} y2={yB}
                            stroke={color} strokeWidth={sw} strokeDasharray="7 5" />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            };

            return (
              <>
                {renderGroup(collectTs(lahanSegs), "#7a1f1f", "BATAS LAHAN", "bl")}
                {renderGroup(collectTs(gsbSegs), "#1e40af", "", "gsb")}
              </>
            );
          })()}
        </svg>
        </div>
        {/* Legenda ruang potongan */}
        {(() => {
          const n = legendRooms.length;
          const cols = n > 60 ? 4 : n > 36 ? 3 : n > 16 ? 2 : 1;
          const width = cols === 4 ? 460 : cols === 3 ? 380 : cols === 2 ? 320 : 240;
          const fs = n > 80 ? 8 : n > 60 ? 9 : n > 40 ? 10 : n > 24 ? 11 : 12;
          const mb = n > 60 ? 2 : n > 30 ? 3 : 4;
          return (
        <div style={{ width, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0, borderLeft: "1px solid #e5e5e5", paddingLeft: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#666", fontWeight: 600, marginBottom: 10, flexShrink: 0 }}>
            Legenda Ruang
          </div>
          {n === 0 ? (
            <div style={{ fontSize: 13, color: "#999", fontFamily: "Manrope, sans-serif" }}>
              Tidak ada ruang teriris pada garis potong ini.
            </div>
          ) : (
            <ol style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              columnCount: cols,
              columnGap: 10,
              fontSize: fs,
              lineHeight: 1.3,
              flex: "1 1 auto",
              fontFamily: "Manrope, sans-serif",
            }}>
              {legendRooms.map((r) => (
                <li key={r.key} style={{ display: "flex", gap: 5, breakInside: "avoid", marginBottom: mb }}>
                  <span style={{
                    flexShrink: 0,
                    minWidth: 16,
                    fontWeight: 700,
                    color: r.color,
                    fontVariantNumeric: "tabular-nums",
                  }}>{r.number}.</span>
                  <span style={{ flex: 1, minWidth: 0, color: "#222", wordBreak: "break-word" }}>
                    {r.name} : {fmt(r.areaM2, 1)} m²
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
          );
        })()}
      </div>
      <div style={{ fontSize: 11, color: "#444", textAlign: "center", fontFamily: "Manrope, sans-serif" }}>
        Potongan dihasilkan otomatis dari garis irisan {cut.label || "A-A"} pada kanvas sketsa ·
        Skala {sketch.scale} · {boxes.length} level
      </div>
    </div>
  );
}

// ---- Bubble Diagram (Diagram Hubungan Ruang) ----
type SimNode = SimulationNodeDatum & RoomNode & { r: number };
type SimLink = SimulationLinkDatum<SimNode> & { weight: number; hasDoor: boolean };

const BUBBLE_VB_W = 1240;
const BUBBLE_VB_H = 720;

function radiusForArea(areaM2: number): number {
  // Proporsional terhadap sqrt(luas) — area ~ pi*r^2 secara visual.
  const a = Math.max(0.1, areaM2);
  const r = 14 + Math.sqrt(a) * 7.5;
  return Math.max(22, Math.min(95, r));
}

function BubbleBody({ slide }: { slide: Extract<Slide, { kind: "bubble" }> }) {
  const { sketch, level } = slide;
  const layersOnLevel = (sketch.layers ?? []).filter(
    (l) => l.levelId === level.id && !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name) && l.points.length >= 3,
  );
  const doorsOnLevel = (sketch.doors ?? []).filter((d) => d.levelId === level.id);

  // Tolerance ~ 1 m (anggap ruang yang dindingnya berjarak ≤ 1m sebagai bertetangga).
  const mPerSPx = sketchMetersPerSketchPx(sketch.scale);
  const tolerancePx = (1 / mPerSPx) * 0.6;

  const graph = useMemo(() => {
    const rooms = layersOnLevel.map((l) => {
      const baseColor = colorForRoomName(l.name) ?? l.color ?? "rgba(120,120,120,ALPHA)";
      const fill = roomFillOverride(l.name, "ALPHA") ?? baseColor;
      return {
        id: l.id,
        name: l.name,
        points: l.points,
        areaM2: l.areaM2,
        color: fill,
        coefficient: l.coefficient ?? 1,
        levelId: l.levelId,
      };
    });
    return buildBubbleGraph(rooms, doorsOnLevel, tolerancePx);
    // re-compute when any room polygon changes or doors change
  }, [
    JSON.stringify(layersOnLevel.map((l) => ({ id: l.id, n: l.name, a: l.areaM2, p: l.points, c: l.coefficient }))),
    JSON.stringify(doorsOnLevel),
    tolerancePx,
  ]);

  const [tick, setTick] = useState(0);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);

  useEffect(() => {
    // Bangun ulang simulasi setiap kali graph berubah.
    const cx = BUBBLE_VB_W / 2;
    const cy = BUBBLE_VB_H / 2;
    const nodes: SimNode[] = graph.nodes.map((n, i) => {
      const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const ring = 140 + (i % 3) * 40;
      return {
        ...n,
        r: radiusForArea(n.areaM2),
        x: cx + Math.cos(angle) * ring,
        y: cy + Math.sin(angle) * ring,
      };
    });
    const byId = new Map(nodes.map((n) => [n.layerId, n]));
    const links: SimLink[] = graph.links
      .map((l) => {
        const s = byId.get(l.source);
        const t = byId.get(l.target);
        if (!s || !t) return null;
        return { source: s, target: t, weight: l.weight, hasDoor: l.hasDoor } as SimLink;
      })
      .filter((x): x is SimLink => x !== null);

    nodesRef.current = nodes;
    linksRef.current = links;

    if (simRef.current) simRef.current.stop();
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.layerId)
          .distance((l) => (l.source as SimNode).r + (l.target as SimNode).r + 26)
          .strength(0.6),
      )
      .force("charge", forceManyBody<SimNode>().strength(-260))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 6).iterations(2))
      .force("center", forceCenter<SimNode>(cx, cy).strength(0.05))
      .force("x", forceX<SimNode>(cx).strength(0.04))
      .force("y", forceY<SimNode>(cy).strength(0.05))
      .alpha(1)
      .alphaDecay(0.035)
      .on("tick", () => setTick((t) => (t + 1) % 1000000));
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [graph]);

  // Clamp nodes ke viewBox setelah setiap tick.
  for (const n of nodesRef.current) {
    if (n.x !== undefined) n.x = Math.max(n.r + 8, Math.min(BUBBLE_VB_W - n.r - 8, n.x));
    if (n.y !== undefined) n.y = Math.max(n.r + 8, Math.min(BUBBLE_VB_H - n.r - 8, n.y));
  }
  void tick;

  const nodes = nodesRef.current;
  const links = linksRef.current;

  // Statistik kecil.
  const totalArea = layersOnLevel.reduce((s, l) => s + l.areaM2, 0);
  const doorCount = links.filter((l) => l.hasDoor).length;
  const adjCount = links.length;

  return (
    <div style={{ display: "flex", gap: 28, width: "100%", height: "100%", alignItems: "stretch" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg
          viewBox={`0 0 ${BUBBLE_VB_W} ${BUBBLE_VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block", background: "#fafaf7", border: "1px solid #e5e5e5" }}
        >
          <defs>
            <pattern id="bubble-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x={0} y={0} width={BUBBLE_VB_W} height={BUBBLE_VB_H} fill="url(#bubble-grid)" />

          {/* Edges */}
          {links.map((l, i) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            if (s.x == null || s.y == null || t.x == null || t.y == null) return null;
            const sw = l.hasDoor ? 3.2 : 1.4;
            const color = l.hasDoor ? "rgba(20,20,20,0.85)" : "rgba(80,80,80,0.45)";
            return (
              <line
                key={`e-${i}`}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={color}
                strokeWidth={sw}
                strokeDasharray={l.hasDoor ? undefined : "4 4"}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((n) => {
            if (n.x == null || n.y == null) return null;
            const fill = (n.color || "rgba(180,180,180,ALPHA)").replace("ALPHA", "0.78");
            const stroke = (n.color || "rgba(80,80,80,ALPHA)").replace("ALPHA", "1");
            const labelSize = Math.max(10, Math.min(18, n.r * 0.32));
            const areaSize = Math.max(8, labelSize - 3);
            return (
              <g key={`n-${n.layerId}`}>
                <circle cx={n.x} cy={n.y} r={n.r} fill={fill} stroke={stroke} strokeWidth={1.4} />
                <text
                  x={n.x} y={n.y - 2}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={labelSize} fontWeight={600} fill="#0a0a0a"
                  style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.85)", strokeWidth: 2.5 } as React.CSSProperties}
                >
                  {n.name}
                </text>
                <text
                  x={n.x} y={n.y + labelSize}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={areaSize} fill="#333"
                  style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.85)", strokeWidth: 2 } as React.CSSProperties}
                >
                  {n.areaM2.toFixed(1)} m²
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Side panel */}
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ border: "1px solid #111", padding: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 600 }}>
            Topologi
          </div>
          <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 26, fontWeight: 700, marginTop: 6, letterSpacing: "-0.02em" }}>
            {nodes.length} Ruang
          </div>
          <div style={{ fontSize: 13, color: "#444", marginTop: 4 }}>
            {adjCount} relasi adjacency · {doorCount} hubungan pintu
          </div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            Total luas: {totalArea.toFixed(1)} m²
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", padding: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 600 }}>
            Legenda
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <svg width={48} height={12}><line x1={2} y1={6} x2={46} y2={6} stroke="#141414" strokeWidth={3.2} /></svg>
            <span style={{ fontSize: 12 }}>Terhubung pintu</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <svg width={48} height={12}><line x1={2} y1={6} x2={46} y2={6} stroke="#666" strokeWidth={1.4} strokeDasharray="4 4" /></svg>
            <span style={{ fontSize: 12 }}>Bersebelahan (dinding)</span>
          </div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 12, lineHeight: 1.5 }}>
            Ukuran lingkaran proporsional terhadap luas ruang (m²). Warna menyesuaikan warna ruang pada Stacking 3D. Diagram otomatis ter-update mengikuti perubahan denah.
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", padding: 14, maxHeight: 260, overflow: "hidden" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 600, marginBottom: 8 }}>
            Daftar Ruang
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
            {nodes.slice(0, 14).map((n) => (
              <div key={`li-${n.layerId}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: (n.color || "rgba(180,180,180,ALPHA)").replace("ALPHA", "1"), flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                <span style={{ color: "#666" }}>{n.areaM2.toFixed(1)} m²</span>
              </div>
            ))}
            {nodes.length > 14 ? (
              <div style={{ color: "#888", marginTop: 4 }}>+{nodes.length - 14} ruang lain</div>
            ) : null}
          </div>
        </div>
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
  const luasPerLantai = layers.filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name)).reduce((s, l) => s + l.areaM2, 0);
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
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", height: "100%", width: "auto", aspectRatio: `${w} / ${h}`, maxWidth: "100%", maxHeight: "100%" }}>
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
                  </g>
                );
              })}
            </g>
          ))}
          {/* Hanya perimeter luar elemen "Lantai" (slab) dari SATU level
              tepat di bawah level ini yang ditampilkan. Garis dinding/objek
              di bawah slab tidak ditampilkan karena slab tidak transparan. */}
          {(() => {
            const lvls = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
            const idx = lvls.findIndex((lv) => lv.id === level.id);
            const below = idx > 0 ? lvls[idx - 1] : null;
            if (!below) return null;
            const floorsBelow = (sketch.floors ?? []).filter((fl) => fl.levelId === below.id);
            return floorsBelow.map((fl) => (
              <polygon
                key={`below-floor-${fl.id}`}
                points={fl.outer.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={sw * 0.001}
              />
            ));
          })()}
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
            const baseCol = colorForRoomName(l.name) ?? l.color;
            const fillCol = overrideFill ?? baseCol.replace("ALPHA", "0.28");
            const strokeCol = overrideStroke ?? baseCol.replace("ALPHA", "1");
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
          {(sketch.floors ?? []).filter((fl) => fl.levelId === level.id).map((fl) => {
            const ring = (pts: { x: number; y: number }[]) =>
              pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
            const d = [fl.outer, ...(fl.holes ?? [])].map(ring).join(" ");
            return (
              <g key={`fl-${fl.id}`} pointerEvents="none">
                <path d={d} fillRule="evenodd"
                  fill="rgba(160,160,160,0.15)"
                  stroke="rgba(90,90,90,0.85)"
                  strokeWidth={sw * 0.0012} />
                {(fl.holes ?? []).map((h, hi) => {
                  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
                  for (const p of h) {
                    if (p.x < mnx) mnx = p.x;
                    if (p.y < mny) mny = p.y;
                    if (p.x > mxx) mxx = p.x;
                    if (p.y > mxy) mxy = p.y;
                  }
                  const clipId = `fvoid-${slide.id}-${fl.id}-${hi}`;
                  const hPts = h.map((p) => `${p.x},${p.y}`).join(" ");
                  return (
                    <g key={`fh-${hi}`}>
                      <defs>
                        <clipPath id={clipId}>
                          <polygon points={hPts} />
                        </clipPath>
                      </defs>
                      <polygon points={hPts}
                        fill="#ffffff"
                        stroke="rgba(120,40,20,0.9)"
                        strokeWidth={sw * 0.0012}
                        strokeDasharray={`${sw * 0.006} ${sw * 0.004}`} />
                      <g clipPath={`url(#${clipId})`}>
                        <line x1={mnx} y1={mny} x2={mxx} y2={mxy}
                          stroke="rgba(120,40,20,0.85)" strokeWidth={sw * 0.001} />
                        <line x1={mxx} y1={mny} x2={mnx} y2={mxy}
                          stroke="rgba(120,40,20,0.85)" strokeWidth={sw * 0.001} />
                      </g>
              </g>
            );
          })}
              </g>
            );
          })}
          {/* Ramps — render pada level kaki ramp (solid setengah pertama, dashed setengah kedua)
              dan pada level di atasnya (dashed setengah pertama, solid setengah kedua). */}
          {(() => {
            const ramps = sketch.ramps ?? [];
            if (!ramps.length) return null;
            const sortedLv = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
            const visible = ramps.filter((r) => {
              const i = sortedLv.findIndex((l) => l.id === r.levelId);
              if (i < 0) return false;
              if (r.levelId === level.id) return true;
              if (i < sortedLv.length - 1 && sortedLv[i + 1].id === level.id) return true;
              return false;
            });
            const splitPolyline = (pts: { x: number; y: number }[], s: number) => {
              const a: { x: number; y: number }[] = []; const b: { x: number; y: number }[] = [];
              let acc = 0; if (pts.length === 0) return { a, b };
              a.push(pts[0]);
              for (let i = 1; i < pts.length; i++) {
                const p0 = pts[i - 1], p1 = pts[i];
                const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
                if (acc + d < s) { a.push(p1); acc += d; continue; }
                const u = (s - acc) / Math.max(1e-9, d);
                const mid = { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u };
                a.push(mid); b.push(mid);
                for (let k = i; k < pts.length; k++) b.push(pts[k]);
                return { a, b };
              }
              return { a, b };
            };
            const toPath = (pts: { x: number; y: number }[]) =>
              pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
            const sLine = sw * 0.0014;
            const dashArr = `${sw * 0.006} ${sw * 0.004}`;
            return visible.map((r) => {
              const isBase = r.levelId === level.id;
              const refDense = tessellateReference(r.anchors, pxPerM, 18);
              const wPx = r.widthM * pxPerM;
              const offDense = offsetPolyline(refDense, wPx, r.offsetSide);
              if (refDense.length < 2 || offDense.length < 2) return null;
              const refLen = polylineLength(refDense);
              const offLen = polylineLength(offDense);
              const refSplit = splitPolyline(refDense, refLen / 2);
              const offSplit = splitPolyline(offDense, offLen / 2);
              const halfPoly = (refPts: { x: number; y: number }[], offPts: { x: number; y: number }[]) => {
                if (refPts.length < 2 || offPts.length < 2) return "";
                const pts = [...refPts, ...offPts.slice().reverse()];
                return pts.map((p) => `${p.x},${p.y}`).join(" ");
              };
              // Centerline (mengikuti belokan, tetap di dalam perimeter)
              const N = Math.min(refDense.length, offDense.length);
              const center: { x: number; y: number }[] = [];
              for (let i = 0; i < N; i++) {
                center.push({ x: (refDense[i].x + offDense[i].x) / 2, y: (refDense[i].y + offDense[i].y) / 2 });
              }
              const tip = center[center.length - 1];
              const prev = center[center.length - 2] ?? center[0];
              const adx = tip.x - prev.x, ady = tip.y - prev.y;
              const aL = Math.max(1e-9, Math.hypot(adx, ady));
              const aux = adx / aL, auy = ady / aL;
              const headLen = Math.min(wPx * 0.4, sw * 0.02);
              const baseX = tip.x - aux * headLen, baseY = tip.y - auy * headLen;
              const pnx = -auy, pny = aux;
              const wHead = headLen * 0.55;
              const arrowPts = `${tip.x},${tip.y} ${baseX + pnx * wHead},${baseY + pny * wHead} ${baseX - pnx * wHead},${baseY - pny * wHead}`;
              const fillA = "rgba(20,184,166,0.14)";
              const fillB = "rgba(148,163,184,0.10)";
              const arrowColor = isBase ? "rgba(234,88,12,0.9)" : "rgba(100,116,139,0.75)";
              return (
                <g key={`ramp-${r.id}`} pointerEvents="none">
                  {/* first half */}
                  <polygon points={halfPoly(refSplit.a, offSplit.a)}
                    fill={isBase ? fillA : fillB} stroke="rgba(15,23,42,0.85)" strokeWidth={sLine}
                    strokeDasharray={isBase ? undefined : dashArr} />
                  {/* second half */}
                  <polygon points={halfPoly(refSplit.b, offSplit.b)}
                    fill={isBase ? fillB : fillA} stroke="rgba(15,23,42,0.85)" strokeWidth={sLine}
                    strokeDasharray={isBase ? dashArr : undefined} />
                  {/* explicit edge paths */}
                  <path d={toPath(refSplit.a)} fill="none" stroke="rgba(15,23,42,0.85)" strokeWidth={sLine}
                    strokeDasharray={isBase ? undefined : dashArr} />
                  <path d={toPath(offSplit.a)} fill="none" stroke="rgba(15,23,42,0.85)" strokeWidth={sLine}
                    strokeDasharray={isBase ? undefined : dashArr} />
                  <path d={toPath(refSplit.b)} fill="none" stroke="rgba(15,23,42,0.85)" strokeWidth={sLine}
                    strokeDasharray={isBase ? dashArr : undefined} />
                  <path d={toPath(offSplit.b)} fill="none" stroke="rgba(15,23,42,0.85)" strokeWidth={sLine}
                    strokeDasharray={isBase ? dashArr : undefined} />
                  {/* arah ramp: centerline polyline mengikuti belokan + kepala panah */}
                  <path d={toPath(center)} fill="none" stroke={arrowColor}
                    strokeWidth={sLine * 1.1}
                    strokeDasharray={isBase ? undefined : dashArr} />
                  <polygon points={arrowPts} fill={arrowColor} stroke="none" />
                  {/* bordes overlays */}
                  {(() => {
                    if (!r.bordes) return null;
                    const sortedLv2 = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
                    const li = sortedLv2.findIndex((l) => l.id === r.levelId);
                    const ab = li >= 0 && li < sortedLv2.length - 1 ? sortedLv2[li + 1] : null;
                    const tH = ab ? Math.max(0, ab.mdpl - sortedLv2[li].mdpl) : 0;
                    const spacingM = r.bordesSpacingM ?? 9;
                    const bLenM = r.bordesLenM ?? 1.2;
                    const slopeLenM = tH * r.nM;
                    const centerLenM = polylineLength(center) / pxPerM;
                    // Corner arc-lengths on centerline (meter) — reset spasi setelah bordes belokan.
                    const cornerArcsM: number[] = [];
                    const Nrc = Math.min(refDense.length, offDense.length);
                    if (r.bordesBelokan && r.anchors.length >= 3) {
                      const cumPx: number[] = [0];
                      for (let i = 1; i < Nrc; i++) {
                        cumPx.push(cumPx[i - 1] + Math.hypot(center[i].x - center[i - 1].x, center[i].y - center[i - 1].y));
                      }
                      for (let ai = 1; ai < r.anchors.length - 1; ai++) {
                        const B = r.anchors[ai];
                        let bestI = 0, bestD = Infinity;
                        for (let i = 0; i < Nrc; i++) {
                          const d = Math.hypot(refDense[i].x - B.x, refDense[i].y - B.y);
                          if (d < bestD) { bestD = d; bestI = i; }
                        }
                        cornerArcsM.push(cumPx[bestI] / pxPerM);
                      }
                    }
                    const arcs = computeBordesArcs(centerLenM, slopeLenM, spacingM, bLenM, true, cornerArcsM);
                    const halfW = (r.widthM * pxPerM) / 2;
                    const pointAt = (sM: number) => pointAtArcLength(center, sM * pxPerM);
                    const midM = centerLenM / 2;
                    const isDashedAtM = (sM: number) => isBase ? sM > midM : sM < midM;
                    const quads: Array<{ pts: string; dashed: boolean }> = [];
                    for (const a of arcs) {
                      const p0 = pointAt(a.s0);
                      const p1 = pointAt(a.s1);
                      const n0 = { x: -p0.t.y, y: p0.t.x };
                      const n1 = { x: -p1.t.y, y: p1.t.x };
                      const q00 = { x: p0.p.x + n0.x * halfW, y: p0.p.y + n0.y * halfW };
                      const q01 = { x: p0.p.x - n0.x * halfW, y: p0.p.y - n0.y * halfW };
                      const q11 = { x: p1.p.x - n1.x * halfW, y: p1.p.y - n1.y * halfW };
                      const q10 = { x: p1.p.x + n1.x * halfW, y: p1.p.y + n1.y * halfW };
                      quads.push({
                        pts: `${q00.x},${q00.y} ${q01.x},${q01.y} ${q11.x},${q11.y} ${q10.x},${q10.y}`,
                        dashed: isDashedAtM((a.s0 + a.s1) / 2),
                      });
                    }
                    // Corner landings: persegi dengan diagonal B↔B'.
                    const corners: Array<{ pts: string; dashed: boolean }> = [];
                    if (r.bordesBelokan && r.anchors.length >= 3) {
                      for (let ai = 1; ai < r.anchors.length - 1; ai++) {
                        const B = r.anchors[ai];
                        let bestI = 0, bestD = Infinity;
                        for (let i = 0; i < Nrc; i++) {
                          const d = Math.hypot(refDense[i].x - B.x, refDense[i].y - B.y);
                          if (d < bestD) { bestD = d; bestI = i; }
                        }
                        const Bp = offDense[bestI];
                        const mx = (B.x + Bp.x) / 2, my = (B.y + Bp.y) / 2;
                        const dx = Bp.x - B.x, dy = Bp.y - B.y;
                        const dlen = Math.max(1e-6, Math.hypot(dx, dy));
                        const px = -dy / dlen, py = dx / dlen;
                        const halfDiag = dlen * 0.5;
                        const v3 = { x: mx + px * halfDiag, y: my + py * halfDiag };
                        const v4 = { x: mx - px * halfDiag, y: my - py * halfDiag };
                        const cornerArc = cornerArcsM[ai - 1] ?? 0;
                        corners.push({
                          pts: `${B.x},${B.y} ${v3.x},${v3.y} ${Bp.x},${Bp.y} ${v4.x},${v4.y}`,
                          dashed: isDashedAtM(cornerArc),
                        });
                      }
                    }
                    return (
                      <>
                        {quads.map((q, qi) => (
                          <polygon key={`b-${qi}`} points={q.pts}
                            fill="none" stroke="rgba(15,23,42,0.85)" strokeWidth={sLine * 0.5}
                            strokeDasharray={q.dashed ? dashArr : undefined} />
                        ))}
                        {corners.map((c, ci) => (
                          <polygon key={`bc-${ci}`} points={c.pts}
                            fill="none" stroke="rgba(15,23,42,0.85)" strokeWidth={sLine * 0.5}
                            strokeDasharray={c.dashed ? dashArr : undefined} />
                        ))}
                      </>
                    );
                  })()}
                </g>
              );
            });
          })()}
          <MaterialEdges
            lines={lines}
            edgeAttrs={sketch.edgeAttrs ?? {}}
            pxPerM={pxPerM}
            sw={sw}
            mode="base"
          />



          {/* Pohon pada permukaan Taman — lingkaran hijau solid opacity 50%,
              diameter acak 1..3 m, jarak antar pohon minimal 3.2 m. */}
          {layers.filter((l) => isTaman(l.name) || isAtapHijau(l.name)).map((l) => {
            const trees = planTamanTreesInPoly(l.points, pxPerM, `taman-plan-${l.id}`);
            return (
              <g key={`taman-trees-${l.id}`} pointerEvents="none">
                {trees.map((t, ti) => (
                  <circle key={ti}
                    cx={t.x} cy={t.y} r={(t.dM / 2) * pxPerM}
                    fill="rgba(22,163,74,0.5)" />
                ))}
              </g>
            );
          })}



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
            const gridSW = sw * 0.0003; // lebih tipis 50% lagi
            const dash = `${sw * 0.01} ${sw * 0.004} ${sw * 0.002} ${sw * 0.004}`;
            const colPx = (grid.colSizeCm / 100) * pxPerM;
            const bubFs = sw * 0.008;
            const dimFs = sw * 0.0085;
            const dimGap = sw * 0.006;
            const rotDeg = Number(grid.rotation) || 0;
            const hideSX = Boolean(grid.hideBubbleStartX);
            const hideEX = Boolean(grid.hideBubbleEndX);
            const hideSY = Boolean(grid.hideBubbleStartY);
            const hideEY = Boolean(grid.hideBubbleEndY);
            if (grid.lineOnly) {
              const lastI = xs.length - 1;
              return (
                <g key={`grid-${gIdx}`} pointerEvents="none"
                  transform={rotDeg ? `rotate(${rotDeg} ${ox} ${oy})` : undefined}>
                  <line x1={x0 - ext} y1={y0} x2={x1 + ext} y2={y0}
                    stroke="#0a0a0a" strokeWidth={gridSW} strokeDasharray={dash} />
                  {!hideSX && (
                    <g>
                      <circle cx={x0 - ext - rBub} cy={y0} r={rBub}
                        fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                      <text x={x0 - ext - rBub} y={y0} textAnchor="middle" dominantBaseline="central"
                        fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                        {xAxisLabelAt(0, grid.labelOffsetX ?? 0)}
                      </text>
                    </g>
                  )}
                  {!hideEX && (
                    <g>
                      <circle cx={x1 + ext + rBub} cy={y0} r={rBub}
                        fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                      <text x={x1 + ext + rBub} y={y0} textAnchor="middle" dominantBaseline="central"
                        fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                        {xAxisLabelAt(lastI, grid.labelOffsetX ?? 0)}
                      </text>
                    </g>
                  )}
                </g>
              );
            }
            return (
              <g key={`grid-${gIdx}`} pointerEvents="none"
                transform={rotDeg ? `rotate(${rotDeg} ${ox} ${oy})` : undefined}>
                {/* Vertikal (sumbu X) */}
                {xs.map((x, i) => (
                  <g key={`gx-${i}`}>
                    <line x1={x} y1={y0 - ext} x2={x} y2={y1 + ext}
                      stroke="#0a0a0a" strokeWidth={gridSW} strokeDasharray={dash} />
                    {!hideSY && (<>
                      <circle cx={x} cy={y0 - ext - rBub} r={rBub}
                        fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                      <text x={x} y={y0 - ext - rBub} textAnchor="middle" dominantBaseline="central"
                        fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                        {xAxisLabelAt(i, grid.labelOffsetX ?? 0)}
                      </text>
                    </>)}
                    {!hideEY && (<>
                      <circle cx={x} cy={y1 + ext + rBub} r={rBub}
                        fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                      <text x={x} y={y1 + ext + rBub} textAnchor="middle" dominantBaseline="central"
                        fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                        {xAxisLabelAt(i, grid.labelOffsetX ?? 0)}
                      </text>
                    </>)}
                  </g>
                ))}
                {/* Horizontal (sumbu Y) */}
                {ys.map((y, j) => (
                  <g key={`gy-${j}`}>
                    <line x1={x0 - ext} y1={y} x2={x1 + ext} y2={y}
                      stroke="#0a0a0a" strokeWidth={gridSW} strokeDasharray={dash} />
                    {!hideSX && (<>
                      <circle cx={x0 - ext - rBub} cy={y} r={rBub}
                        fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                      <text x={x0 - ext - rBub} y={y} textAnchor="middle" dominantBaseline="central"
                        fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                        {yAxisLabelAt(j, grid.labelOffsetY ?? 0)}
                      </text>
                    </>)}
                    {!hideEX && (<>
                      <circle cx={x1 + ext + rBub} cy={y} r={rBub}
                        fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSW} />
                      <text x={x1 + ext + rBub} y={y} textAnchor="middle" dominantBaseline="central"
                        fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">
                        {yAxisLabelAt(j, grid.labelOffsetY ?? 0)}
                      </text>
                    </>)}
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
          {/* extraLines: garis tambahan yang tergabung pada tiap grid */}
          {collectGrids(sketch.structuralGrid, sketch.structuralGridExtras).flatMap((grid, gIdx) => {
            const allLv = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
            if (!levelInRange(grid, level, allLv)) return [];
            const lines = grid.extraLines ?? [];
            if (!lines.length) return [];
            const ext = sw * 0.04;
            const rBub = sw * 0.009;
            const gridSWx = sw * 0.0003;
            const dash = `${sw * 0.01} ${sw * 0.004} ${sw * 0.002} ${sw * 0.004}`;
            const bubFs = sw * 0.008;
            const baseIdx = (grid.labelOffsetX ?? 0) + grid.spansX.length + 1;
            return lines.map((el, i) => {
              const lenPx = el.lengthM * pxPerM;
              const lbl = xAxisLabelAt(baseIdx + i, 0);
              return (
                <g key={`xl-${gIdx}-${el.id}`} pointerEvents="none"
                  transform={`translate(${el.origin.x} ${el.origin.y}) rotate(${el.rotation})`}>
                  <line x1={-ext} y1={0} x2={lenPx + ext} y2={0}
                    stroke="#0a0a0a" strokeWidth={gridSWx} strokeDasharray={dash} />
                  {!el.hideStart && (
                    <g transform={`translate(${-ext - rBub} 0) rotate(${-el.rotation})`}>
                      <circle r={rBub} fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSWx} />
                      <text textAnchor="middle" dominantBaseline="central"
                        fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">{lbl}</text>
                    </g>
                  )}
                  {!el.hideEnd && (
                    <g transform={`translate(${lenPx + ext + rBub} 0) rotate(${-el.rotation})`}>
                      <circle r={rBub} fill="#ffffff" stroke="#0a0a0a" strokeWidth={gridSWx} />
                      <text textAnchor="middle" dominantBaseline="central"
                        fontSize={bubFs} fontWeight={700} fill="#0a0a0a" fontFamily="Sora, sans-serif">{lbl}</text>
                    </g>
                  )}
                </g>
              );
            });
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
              const rBub = sw * 0.009;
              const bubSW = sw * 0.0006;
              const triSW = bubSW * 1.2;
              const bubFs = sw * 0.008;
              // Bubble positions extend beyond each endpoint along the line
              const bA = { x: p1.x - ux * (rBub + sw * 0.001), y: p1.y - uy * (rBub + sw * 0.001) };
              const bB = { x: p2.x + ux * (rBub + sw * 0.001), y: p2.y + uy * (rBub + sw * 0.001) };
              // Right-angle isoceles triangle at each bubble:
              // hypotenuse sejajar garis potongan (melalui pusat buble, tidak digambar),
              // sudut siku-siku menunjuk arah potongan (px, py).
              const hLeg = rBub; // half hypotenuse length & apex distance
              // Dekatkan segitiga ke bubble: midpoint hypotenuse berada di dalam bubble,
              // sehingga base segitiga "menempel" pada bubble dan hanya apex terlihat di luar.
              const midOff = rBub * 0.4;
              return (
                <g key={`cut-${idx}`} pointerEvents="none">
                  {/* Garis potongan — tipis, hitam, putus-putus */}
                  <line
                    x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke="#0a0a0a"
                    strokeWidth={sw * 0.0014}
                    strokeDasharray={`${sw * 0.012} ${sw * 0.006} ${sw * 0.0025} ${sw * 0.006}`}
                    strokeLinecap="round"
                  />
                  {/* Endpoint label bubbles + segitiga siku-siku */}
                  {[{ pt: bA, txt: tag }, { pt: bB, txt: `${tag}'` }].map((b, j) => {
                    const mid = { x: b.pt.x + px * midOff, y: b.pt.y + py * midOff };
                    const h1 = { x: mid.x - ux * hLeg, y: mid.y - uy * hLeg };
                    const h2 = { x: mid.x + ux * hLeg, y: mid.y + uy * hLeg };
                    const apex = { x: mid.x + px * hLeg, y: mid.y + py * hLeg };
                    return (
                      <g key={j}>
                        {/* Dua sisi tegak siku — sisi miring tidak digambar.
                            Digambar dulu agar bubble menutup pangkalnya. */}
                        <line x1={h1.x} y1={h1.y} x2={apex.x} y2={apex.y}
                          stroke="#0a0a0a" strokeWidth={triSW} strokeLinecap="round" />
                        <line x1={h2.x} y1={h2.y} x2={apex.x} y2={apex.y}
                          stroke="#0a0a0a" strokeWidth={triSW} strokeLinecap="round" />
                        <circle cx={b.pt.x} cy={b.pt.y} r={rBub}
                          fill="#ffffff" stroke="#0a0a0a" strokeWidth={bubSW} />
                        <text x={b.pt.x} y={b.pt.y}
                          textAnchor="middle" dominantBaseline="central"
                          fontSize={bubFs} fontWeight={700} fill="#0a0a0a"
                          fontFamily="Sora, sans-serif">
                          {b.txt}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            });
          })()}
          {/* Overlay material di lapisan teratas, menutupi garis base sketsa. */}
          <MaterialEdges
            lines={lines}
            edgeAttrs={sketch.edgeAttrs ?? {}}
            pxPerM={pxPerM}
            sw={sw}
            mode="overlay"
          />
          {/* Pintu digambar paling akhir agar bukaan pintu menutupi material/dinding di bawahnya. */}
          <DoorNotation
            doors={(sketch.doors ?? []).filter((d) => d.levelId === level.id)}
            pxPerM={pxPerM}
            sw={sw}
          />
          {/* Lot parkir otomatis (geometris) untuk level ini. */}
          {(() => {
            const areas = (sketch.parkingAreas ?? []).filter((p) => p.levelId === level.id);
            if (!areas.length) return null;
            const mmRotRad = ((Number(sketch.mmGridRotation) || 0) * Math.PI) / 180;
            const obs: ParkingObstacle[] = [];
            const wallBuf = 0.075 * pxPerM;
            for (const ln of lines) {
              if ((ln.kind ?? "straight") !== "straight") continue;
              obs.push({ kind: "wall", a: ln.a, b: ln.b, bufferPx: wallBuf });
            }
            for (const ly of layers) {
              if (!Array.isArray(ly.points) || ly.points.length < 3) continue;
              if (isParkingName(ly.name)) continue;
              obs.push({ kind: "polygon", poly: ly.points });
            }
            for (const grid of collectGrids(sketch.structuralGrid, sketch.structuralGridExtras)) {
              if (grid.lineOnly || !levelInRange(grid, level, sketch.levels ?? [])) continue;
              const { spansX, spansY } = spansForLevel(grid, level.id);
              const xsM = axisPositions(spansX);
              const ysM = axisPositions(spansY);
              const halfCol = ((grid.colSizeCm / 100) * pxPerM) / 2;
              const rotRad = ((Number(grid.rotation) || 0) * Math.PI) / 180;
              const cs = Math.cos(rotRad), sn = Math.sin(rotRad);
              for (let j = 0; j < ysM.length; j++) {
                for (let i = 0; i < xsM.length; i++) {
                  if (!isColumnVisible(grid, level.id, i, j, spansX, spansY)) continue;
                  const lx = xsM[i] * pxPerM;
                  const ly = ysM[j] * pxPerM;
                  const cx = grid.origin.x + lx * cs - ly * sn;
                  const cy = grid.origin.y + lx * sn + ly * cs;
                  const poly = [
                    { x: -halfCol, y: -halfCol }, { x: halfCol, y: -halfCol },
                    { x: halfCol, y: halfCol }, { x: -halfCol, y: halfCol },
                  ].map((p) => ({ x: cx + p.x * cs - p.y * sn, y: cy + p.x * sn + p.y * cs }));
                  obs.push({ kind: "polygon", poly });
                }
              }
            }
            // Tambahkan jalur parkir (polyline) sebagai obstacle ber-buffer 1.75 m.
            obs.push(...parkingPathsToObstacles(areas, pxPerM, mmRotRad));
            const cs = Math.cos(mmRotRad), sn = Math.sin(mmRotRad);
            // Polyline jalur parkir di koordinat dunia (untuk rendering).
            const pathWorlds: Array<{ areaId: string; pathId: string; pts: Array<{ x: number; y: number }> }> = [];
            for (const area of areas) {
              for (const path of area.paths ?? []) {
                pathWorlds.push({
                  areaId: area.id,
                  pathId: path.id,
                  pts: path.pointsLocal.map((p) => ({ x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs })),
                });
              }
            }
            // Diffable efektif (manual + auto) untuk seluruh sketch.
            const diffEff = computeDiffableEffective(sketch);
            // Hitung stall + polygon dunia untuk tiap area
            const areaInfos = areas.map((area) => {
              const diffKeys = diffEff.get(area.id);
              const stalls = generateStalls(area, pxPerM, mmRotRad, obs, diffKeys);
              const valid = stalls.filter((s) => s.valid);
              const regular = valid.filter((s) => !s.diffable);
              const diffable = valid.filter((s) => !!s.diffable);
              const worldPoly = area.pointsLocal.map((p) => ({ x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs }));
              const cx = worldPoly.reduce((s, p) => s + p.x, 0) / worldPoly.length;
              const cy = worldPoly.reduce((s, p) => s + p.y, 0) / worldPoly.length;
              return { area, valid, regular, diffable, worldPoly, cx, cy };
            });
            // Kelompokkan area berdasar ruang parkir yang membungkusnya + kind
            const parkingRooms = layers.filter((ly) => isParkingName(ly.name) && Array.isArray(ly.points) && ly.points.length >= 3);
            const groups = new Map<string, { mobil: number; motor: number; diffable: number; cx: number; cy: number }>();
            const ungrouped: Array<{ info: typeof areaInfos[number]; kind: "mobil" | "motor" }> = [];
            for (const info of areaInfos) {
              const kind: "mobil" | "motor" = info.area.kind === "motor" ? "motor" : "mobil";
              let room = parkingRooms.find((r) => pointInPolyPres({ x: info.cx, y: info.cy }, r.points));
              if (!room) room = parkingRooms.find((r) => info.worldPoly.some((v) => pointInPolyPres(v, r.points)));
              if (!room) room = parkingRooms.find((r) => {
                const rcx = r.points.reduce((s, p) => s + p.x, 0) / r.points.length;
                const rcy = r.points.reduce((s, p) => s + p.y, 0) / r.points.length;
                return info.worldPoly.length >= 3 && pointInPolyPres({ x: rcx, y: rcy }, info.worldPoly);
              });
              const mobilCount = kind === "mobil" ? info.regular.length : 0;
              const motorCount = kind === "motor" ? info.valid.length : 0;
              const diffCount = kind === "mobil" ? info.diffable.length : 0;
              if (!room) { ungrouped.push({ info, kind }); continue; }
              const prev = groups.get(room.id);
              if (prev) {
                prev.mobil += mobilCount;
                prev.motor += motorCount;
                prev.diffable += diffCount;
              } else {
                const rcx = room.points.reduce((s, p) => s + p.x, 0) / room.points.length;
                const rcy = room.points.reduce((s, p) => s + p.y, 0) / room.points.length;
                groups.set(room.id, {
                  mobil: mobilCount,
                  motor: motorCount,
                  diffable: diffCount,
                  cx: rcx, cy: rcy,
                });
              }
            }
            const formatLabel = (mobil: number, motor: number, diffable: number): string => {
              const parts: string[] = [];
              if (mobil > 0 || diffable > 0) {
                parts.push(diffable > 0 ? `${mobil} mobil + ${diffable} diffable` : `${mobil} lot mobil`);
              }
              if (motor > 0) parts.push(`${motor} lot motor`);
              return parts.join(" · ") || "0 lot";
            };
            const labels = [
              ...Array.from(groups.entries()).map(([id, g]) => ({
                key: `room-${id}`, text: formatLabel(g.mobil, g.motor, g.diffable), cx: g.cx, cy: g.cy,
              })),
              ...ungrouped.map(({ info, kind }) => ({
                key: `area-${info.area.id}`,
                text: formatLabel(
                  kind === "mobil" ? info.regular.length : 0,
                  kind === "motor" ? info.valid.length : 0,
                  kind === "mobil" ? info.diffable.length : 0,
                ),
                cx: info.cx, cy: info.cy,
              })),
            ];
            const diffSymPx = Math.min(DIFFABLE_STALL_W, DIFFABLE_STALL_L) * pxPerM * 0.55;
            return (
              <g pointerEvents="none">
                {areaInfos.map((info) => (
                  <g key={`pk-${info.area.id}`}>
                    {info.regular.map((st) => (
                      <polygon
                        key={st.id}
                        points={st.poly.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill="rgba(200,200,200,0.35)"
                        stroke="#000000"
                        strokeWidth={sw * 0.00045}
                      />
                    ))}
                    {info.diffable.map((st) => (
                      <g key={`d-${st.id}`}>
                        <polygon
                          points={st.poly.map((p) => `${p.x},${p.y}`).join(" ")}
                          fill="rgba(170,140,140,0.5)"
                          stroke="#000000"
                          strokeWidth={sw * 0.00045}
                        />
                        <text
                          x={st.center.x}
                          y={st.center.y}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={diffSymPx}
                          fill="#ffffff"
                          transform={`rotate(${((st.angle + Math.PI / 2) * 180) / Math.PI} ${st.center.x} ${st.center.y})`}
                        >
                          ♿
                        </text>
                      </g>
                    ))}
                  </g>
                ))}
                {pathWorlds.map((pw) => (
                  <polyline
                    key={`pp-${pw.areaId}-${pw.pathId}`}
                    points={pw.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="#9ca3af"
                    strokeWidth={sw * 0.00045}
                    strokeDasharray={`${sw * 0.003} ${sw * 0.002}`}
                  />
                ))}
                {labels.map((lbl) => {
                  const w = sw * 0.018 * Math.max(6, lbl.text.length) * 0.55;
                  const halfW = Math.max(sw * 0.045, w / 2 + sw * 0.008);
                  return (
                    <g key={lbl.key}>
                      <rect
                        x={lbl.cx - halfW} y={lbl.cy - sw * 0.014}
                        width={halfW * 2} height={sw * 0.028}
                        rx={sw * 0.004}
                        fill="rgba(255,255,255,0.9)"
                        stroke="#000000"
                        strokeWidth={sw * 0.00045}
                      />
                      <text
                        x={lbl.cx} y={lbl.cy}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize={sw * 0.016} fontWeight={700}
                        fill="#000000"
                      >
                        {lbl.text}
                      </text>
                    </g>
                  );
                })}
              </g>
            );

          })()}
        </svg>
        <SlideCompass rotation={effectiveNorthDeg(sketch)} draggableId={`level-${slide.id}`} />
        </div>
      </div>
      <div style={{ width: (layers.filter((l) => !isLahan(l.name)).length > 60 ? 420 : layers.filter((l) => !isLahan(l.name)).length > 32 ? 360 : 300), flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 14, overflow: "hidden" }}>
        <BigStat
          compact
          label="Level"
          value={displayName}
          hint={k > 1
            ? `${fmt(level.mdpl, 1)} Elev · tipikal ${k}×`
            : `${fmt(level.mdpl, 1)} Elev`}
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
          const cols = n > 60 ? 4 : n > 32 ? 3 : n > 14 ? 2 : 1;
          const fontPx = n > 80 ? 8 : n > 60 ? 9 : n > 44 ? 10 : n > 28 ? 11 : 12;
          const gapPx = n > 60 ? 2 : n > 28 ? 3 : 4;
          return (
            <div style={{ marginTop: 6, borderTop: "1px solid #111", paddingTop: 10, minHeight: 0, flex: "1 1 auto", display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#666", fontWeight: 600, marginBottom: 10, flexShrink: 0 }}>
                Legenda Ruang
              </div>
              <ol style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                columnCount: cols,
                columnGap: 10,
                fontSize: fontPx,
                lineHeight: 1.3,
                flex: "1 1 auto",
              }}>
                {roomList.map((r, i) => (
                  <li key={r.id} style={{ display: "flex", gap: 5, breakInside: "avoid", marginBottom: gapPx }}>
                    <span style={{
                      flexShrink: 0,
                      minWidth: 16,
                      fontWeight: 700,
                      color: (colorForRoomName(r.name) ?? r.color).replace("ALPHA", "1"),
                      fontVariantNumeric: "tabular-nums",
                    }}>{i + 1}.</span>
                    <span style={{ flex: 1, minWidth: 0, color: "#222", wordBreak: "break-word" }}>
                      {r.name} : {fmt(r.areaM2 || 0, 1)} m²
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
  const major: Record<string, number> = { "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10, "1:1200": 12, "1:1500": 15, "1:2000": 20 };
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
  const buildM2 = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name)).reduce((s, l) => s + (l.areaM2 || 0), 0);
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
  const bgImage = imgs[0] ?? null;
  const text = slide.narasi.text.trim();
  const firstBreak = text.indexOf("\n");
  const heading = firstBreak === -1 ? text : text.slice(0, firstBreak).trim();
  const body = firstBreak === -1 ? "" : text.slice(firstBreak + 1).trim();

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: bgImage ? "#000" : "#f5f5f5",
      }}
    >
      {/* Full-bleed background image */}
      {bgImage ? (
        <img
          src={bgImage}
          alt={`Konsep ${slide.index + 1}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#999",
            fontSize: 14,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Unggah gambar di halaman Narasi
        </div>
      )}

      {/* Top scrim for header legibility */}
      {bgImage && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 220,
            background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0) 100%)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Header / Kop — white text */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: `${PAD}px ${PAD}px 20px ${PAD}px`,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          color: "#ffffff",
          borderBottom: "1px solid rgba(255,255,255,0.35)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(255,255,255,0.8)", fontWeight: 600 }}>
            Konsep · Narasi
          </div>
          <div
            style={{
              fontFamily: "var(--font-display, Sora, sans-serif)",
              fontSize: 58, lineHeight: 1.02, letterSpacing: "-0.03em", fontWeight: 600, marginTop: 6,
              color: "#ffffff",
              textShadow: "0 2px 14px rgba(0,0,0,0.45)",
            }}
          >
            {slide.title}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", color: "#ffffff" }}>
            {slide.sketch.title}
          </div>
          <div style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.75)", marginTop: 4 }}>
            Skala {slide.sketch.scale}{slide.sketch.fungsi ? ` · ${slide.sketch.fungsi}` : ""}
          </div>
        </div>
      </div>

      {/* Left-side narasi — black text on light scrim */}
      <div
        style={{
          position: "absolute",
          left: PAD,
          bottom: PAD,
          width: "38%",
          maxHeight: "62%",
          overflow: "hidden",
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(4px)",
          padding: "22px 24px",
          borderRadius: 4,
          boxShadow: "0 8px 28px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: "#666", fontWeight: 600 }}>
          Gagasan Utama · Narasi {slide.index + 1}
        </div>
        {heading && (
          <div
            style={{
              fontFamily: "var(--font-display, Sora, sans-serif)",
              fontSize: 26,
              lineHeight: 1.2,
              color: "#000000",
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
            fontSize: 15,
            lineHeight: 1.55,
            color: text ? "#000000" : "#888",
            fontWeight: 400,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflow: "hidden",
          }}
        >
          {body || (heading ? "" : "Tulis gagasan utama narasi di halaman Narasi.")}
        </div>
      </div>
    </div>
  );
}

function PerspektifBody({ slide }: { slide: Extract<Slide, { kind: "perspektif" }> }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#000",
      }}
    >
      {/* Full-bleed perspektif image */}
      <img
        src={slide.image}
        alt={slide.caption}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />

      {/* Minimal top scrim — half-height of previous, fades quickly */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 90,
          background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 65%, rgba(0,0,0,0) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Compact single-line header bar — title kiri, proyek kanan, dipisah pipe */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: `14px ${PAD}px 10px ${PAD}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          color: "#ffffff",
          borderBottom: "1px solid rgba(255,255,255,0.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.8)",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            Perspektif{slide.total > 1 ? ` ${slide.index + 1}/${slide.total}` : ""}
          </span>
          <span
            style={{
              fontFamily: "var(--font-display, Sora, sans-serif)",
              fontSize: 22,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              fontWeight: 600,
              color: "#ffffff",
              textShadow: "0 1px 8px rgba(0,0,0,0.5)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {slide.title}
          </span>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 12, fontWeight: 600, letterSpacing: "-0.005em", color: "#ffffff" }}>
            {slide.sketch.title}
          </span>
          <span style={{ fontSize: 8, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>
            Skala {slide.sketch.scale}{slide.sketch.fungsi ? ` · ${slide.sketch.fungsi}` : ""}
          </span>
        </div>
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

// ---- Material edge notation untuk denah (plan view) ----
// Tebal dinding selubung (mm), dikonversi ke px sketsa via pxPerM.
const WALL_THICK_MM: Record<EdgeMaterial, number> = {
  solid: 150,
  curtain: 80,
  window: 150,
  railing: 100,
};
const RAILING_COLOR = "#8b5a2b";

function MaterialEdges({
  lines,
  edgeAttrs,
  pxPerM,
  sw,
  mode = "all",
}: {
  lines: Line[];
  edgeAttrs: Record<string, EdgeMaterial>;
  pxPerM: number;
  sw: number;
  /** "base" = garis sketsa dasar saja; "overlay" = elemen ber-material saja
   *  di lapisan teratas; "all" = keduanya. */
  mode?: "base" | "overlay" | "all";
}) {
  // Segmen non-lurus: render utuh via linePath (tidak dipecah).
  const curved = lines
    .map((ln, i) => ({ ln, i }))
    .filter((x) => (x.ln.kind ?? "straight") !== "straight");
  const segs = computeStraightSegments(
    lines.map((l) => ({ a: l.a, b: l.b, kind: l.kind, levelId: l.levelId })),
  ).filter((s) => (lines[s.sourceLineIndex].kind ?? "straight") === "straight");
  // Kontur dinding sangat tipis & seragam (80% lebih tipis dari sebelumnya).
  const stroke = sw * 0.00028;
  const strokeFine = stroke;
  // Hatch 45° rapat: 1 garis tiap 100 mm pada skala asli.
  const hatchGap = Math.max(1.2, pxPerM * 0.1);
  const hatchStroke = Math.max(0.18, sw * 0.0004);
  const patternId = useId();
  return (
    <g>
      <defs>
        {/* Hatch 45° sangat tipis untuk dinding solid. */}
        <pattern
          id={`hatch45-${patternId}`}
          patternUnits="userSpaceOnUse"
          width={hatchGap} height={hatchGap}
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={hatchGap}
            stroke="#0a0a0a" strokeWidth={hatchStroke} />
        </pattern>
      </defs>
      {/* Garis lengkung — render apa adanya (notasi material 2D hanya utk garis lurus). */}
      {mode !== "overlay" && curved.map(({ ln, i }) => (
        <path
          key={`c-${i}`}
          d={linePath(ln)}
          stroke="#0a0a0a"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {mode !== "overlay" && segs.map((s) => {
        const mat = edgeAttrs[segmentIdFor(s.a, s.b)];
        if (mat) return null;
        return (
          <line
            key={`s-${s.id}`}
            x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y}
            stroke="#0a0a0a" strokeWidth={stroke} strokeLinecap="round"
          />
        );
      })}
      {/* Render elemen ber-material di lapisan teratas agar menutupi
          garis dasar sketsa yang berada di bawahnya. */}
      {mode !== "base" && segs.map((s) => {
        const mat = edgeAttrs[segmentIdFor(s.a, s.b)];
        if (!mat) return null;
        const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const half = (WALL_THICK_MM[mat] / 1000) * pxPerM * 0.5;
        const a1 = { x: s.a.x + nx * half, y: s.a.y + ny * half };
        const a2 = { x: s.a.x - nx * half, y: s.a.y - ny * half };
        const b1 = { x: s.b.x + nx * half, y: s.b.y + ny * half };
        const b2 = { x: s.b.x - nx * half, y: s.b.y - ny * half };
        const pts = `${a1.x},${a1.y} ${b1.x},${b1.y} ${b2.x},${b2.y} ${a2.x},${a2.y}`;
        if (mat === "solid") {
          // Dinding solid: kontur tebal + hatch 45° sangat tipis.
          return (
            <g key={`s-${s.id}`}>
              <polygon points={pts} fill="#ffffff" stroke="none" />
              <polygon points={pts} fill={`url(#hatch45-${patternId})`} stroke="none" />
              <polygon points={pts} fill="none"
                stroke="#0a0a0a" strokeWidth={stroke} strokeLinejoin="miter" />
            </g>
          );
        }
        if (mat === "curtain") {
          // Curtain wall: dua garis sejajar tipis dengan isi semi-transparan biru muda.
          return (
            <g key={`s-${s.id}`}>
              <polygon points={pts} fill="#ffffff" stroke="none" />
              <polygon points={pts} fill="rgba(34,211,238,0.22)" stroke="none" />
              <line x1={a1.x} y1={a1.y} x2={b1.x} y2={b1.y}
                stroke="#0a0a0a" strokeWidth={strokeFine} />
              <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y}
                stroke="#0a0a0a" strokeWidth={strokeFine} />
              {/* Mullion tick di tiap ~1.2m */}
              {(() => {
                const mPerSeg = 1.2 * pxPerM;
                const n = Math.max(1, Math.floor(len / mPerSeg));
                const out: Array<React.ReactNode> = [];
                for (let k = 1; k < n; k++) {
                  const t = k / n;
                  const p1 = { x: a1.x + (b1.x - a1.x) * t, y: a1.y + (b1.y - a1.y) * t };
                  const p2 = { x: a2.x + (b2.x - a2.x) * t, y: a2.y + (b2.y - a2.y) * t };
                  out.push(<line key={k} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke="#0a0a0a" strokeWidth={strokeFine * 0.8} />);
                }
                return out;
              })()}
            </g>
          );
        }
        if (mat === "railing") {
          // Railing: 2 garis tipis berjarak 100 mm, warna coklat (tanpa fill/hatch).
          return (
            <g key={`s-${s.id}`}>
              <line x1={a1.x} y1={a1.y} x2={b1.x} y2={b1.y}
                stroke={RAILING_COLOR} strokeWidth={strokeFine} />
              <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y}
                stroke={RAILING_COLOR} strokeWidth={strokeFine} />
            </g>
          );
        }
        // window (jendela): kontur tipis seragam + 3 garis sash kaca + hatch tipis pada band dinding.
        const off = half * 0.33;
        const cMid1 = { x: (a1.x + a2.x) / 2 + nx * off, y: (a1.y + a2.y) / 2 + ny * off };
        const cMid2 = { x: (b1.x + b2.x) / 2 + nx * off, y: (b1.y + b2.y) / 2 + ny * off };
        const dMid1 = { x: (a1.x + a2.x) / 2 - nx * off, y: (a1.y + a2.y) / 2 - ny * off };
        const dMid2 = { x: (b1.x + b2.x) / 2 - nx * off, y: (b1.y + b2.y) / 2 - ny * off };
        const eMid1 = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
        const eMid2 = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
        return (
          <g key={`s-${s.id}`}>
            <polygon points={pts} fill="#ffffff" stroke="none" />
            <polygon points={pts} fill={`url(#hatch45-${patternId})`} stroke="none" opacity={0.55} />
            <polygon points={pts} fill="none"
              stroke="#0a0a0a" strokeWidth={stroke} strokeLinejoin="miter" />
            <line x1={cMid1.x} y1={cMid1.y} x2={cMid2.x} y2={cMid2.y}
              stroke="#0a0a0a" strokeWidth={stroke} />
            <line x1={eMid1.x} y1={eMid1.y} x2={eMid2.x} y2={eMid2.y}
              stroke="#0a0a0a" strokeWidth={stroke} />
            <line x1={dMid1.x} y1={dMid1.y} x2={dMid2.x} y2={dMid2.y}
              stroke="#0a0a0a" strokeWidth={stroke} />
          </g>
        );
      })}
    </g>
  );
}

function DoorNotation({
  doors,
  pxPerM,
  sw,
}: {
  doors: Door[];
  pxPerM: number;
  sw: number;
}) {
  if (!doors.length) return null;
  const stroke = sw * 0.0006;
  const thick = 0.15 * pxPerM; // 150mm wall thickness mask
  return (
    <g>
      {doors.map((d) => {
        const ax = d.a.x, ay = d.a.y, bx = d.b.x, by = d.b.y;
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const dx = (bx - ax) / len, dy = (by - ay) / len;
        const px = -dy, py = dx;
        const half = thick * 0.7;
        const widthPx = (d.widthCm / 100) * pxPerM;
        // Mask polygon (cover the wall band)
        const m1 = `${ax + px * half},${ay + py * half}`;
        const m2 = `${bx + px * half},${by + py * half}`;
        const m3 = `${bx - px * half},${by - py * half}`;
        const m4 = `${ax - px * half},${ay - py * half}`;
        // Door leaf + arc
        const nx = d.nx, ny = d.ny;
        const a0 = Math.atan2(ny, nx);
        if (d.leaves === 1) {
          const lx = ax + nx * widthPx, ly = ay + ny * widthPx;
          const a1 = Math.atan2(by - ay, bx - ax);
          let delta = a1 - a0;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          const sweep = delta < 0 ? 0 : 1;
          const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
          return (
            <g key={d.id}>
              <polygon points={`${m1} ${m2} ${m3} ${m4}`} fill="#ffffff" stroke="none" />
              <line x1={ax} y1={ay} x2={lx} y2={ly} stroke="#0a0a0a" strokeWidth={stroke} strokeLinecap="round" />
              <path
                d={`M ${lx} ${ly} A ${widthPx} ${widthPx} 0 ${largeArc} ${sweep} ${bx} ${by}`}
                fill="none" stroke="#0a0a0a" strokeWidth={stroke * 0.7}
              />
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#0a0a0a" strokeWidth={stroke * 0.4} strokeDasharray={`${sw * 0.004} ${sw * 0.003}`} />
            </g>
          );
        }
        // 2 daun
        const mxp = (ax + bx) / 2, myp = (ay + by) / 2;
        const halfW = widthPx / 2;
        const la = { x: ax + nx * halfW, y: ay + ny * halfW };
        const lb = { x: bx + nx * halfW, y: by + ny * halfW };
        const a1a = Math.atan2(myp - ay, mxp - ax);
        let da = a1a - a0;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const swA = da < 0 ? 0 : 1;
        const a1b = Math.atan2(myp - by, mxp - bx);
        let db = a1b - a0;
        while (db > Math.PI) db -= Math.PI * 2;
        while (db < -Math.PI) db += Math.PI * 2;
        const swB = db < 0 ? 0 : 1;
        return (
          <g key={d.id}>
            <polygon points={`${m1} ${m2} ${m3} ${m4}`} fill="#ffffff" stroke="none" />
            <line x1={ax} y1={ay} x2={la.x} y2={la.y} stroke="#0a0a0a" strokeWidth={stroke} strokeLinecap="round" />
            <line x1={bx} y1={by} x2={lb.x} y2={lb.y} stroke="#0a0a0a" strokeWidth={stroke} strokeLinecap="round" />
            <path d={`M ${la.x} ${la.y} A ${halfW} ${halfW} 0 0 ${swA} ${mxp} ${myp}`} fill="none" stroke="#0a0a0a" strokeWidth={stroke * 0.7} />
            <path d={`M ${lb.x} ${lb.y} A ${halfW} ${halfW} 0 0 ${swB} ${mxp} ${myp}`} fill="none" stroke="#0a0a0a" strokeWidth={stroke * 0.7} />
          </g>
        );
      })}
    </g>
  );
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
  "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10, "1:1200": 12, "1:1500": 15, "1:2000": 20,
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
    holes?: { x: number; y: number }[][];
    fill: string;
    stroke: string;
    depth: number;
    sw: number;
    kind: "base" | "top" | "side";
  };
  const faces: Face[] = [];

  const groundLevel = findMdplZeroLevel(ascLevels) ?? ascLevels[0];
  const groundLevelId = groundLevel?.id;
  const lahan = (sketch.layers ?? []).filter((l) => isLahan(l.name));
  // Taman di level dasar (LT 1) tidak ikut stacking diagram — itu lansekap, bukan luasan bangunan.
  const taman = (sketch.layers ?? []).filter(
    (l) => isTaman(l.name) && l.levelId !== groundLevelId,
  );
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
    faces.push({ pts: top, fill: "#efeae1", stroke: "#a8a195", depth: avg - 100000, sw: 0.4, kind: "base" });
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
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const quad = [
        project(a.x, a.z, yBot),
        project(b.x, b.z, yBot),
        project(b.x, b.z, yTop),
        project(a.x, a.z, yTop),
      ];
      const depth = (a.x + b.x + a.z + b.z) / 2 + yBot * 0.01;
      faces.push({ pts: quad, fill: TAMAN_SIDE, stroke: "rgba(0,0,0,0.35)", depth, sw: 0.4, kind: "side" });
    }
    const topPts = pm.map((p) => project(p.x, p.z, yTop));
    const avg = pm.reduce((s, p) => s + p.x + p.z, 0) / pm.length;
    faces.push({
      pts: topPts,
      fill: TAMAN_GREEN,
      stroke: "rgba(0,0,0,0.4)",
      depth: avg + yTop * 0.01,
      sw: 0.5,
      kind: "top",
    });
  }

  // Floors (build layers only — Taman handled above, Lahan/Void excluded)
  const ABU_HEX = "#bebebe";
  const ABU_SIDE = "#9a9a9a";
  const HIJAU_HEX = "#22c55e";
  const HIJAU_SIDE = "#16a34a";
  for (const lv of withH) {
    const top = colorOf(lv.sourceId);
    const side = shadeHsl(top, -18);
    const layers = build.filter((l) => l.levelId === lv.sourceId);
    for (const ly of layers) {
      const pm = toPm(ly);
      if (pm.length < 3) continue;
      const ov = roomExtrudeOverride(ly.name);
      const yBot = lv.base + (ov?.baseDelta ?? 0);
      const yTop = yBot + (ov?.height ?? lv.height);
      const topFill = ov ? (isAtapHijau(ly.name) ? HIJAU_HEX : ABU_HEX) : top;
      const sideFill = ov ? (isAtapHijau(ly.name) ? HIJAU_SIDE : ABU_SIDE) : side;
      // Side quads: render semua sisi, lalu painter sorting menempatkan sisi depan di atas top/back face.
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
        faces.push({ pts: quad, fill: sideFill, stroke: "rgba(0,0,0,0.45)", depth, sw: 0.5, kind: "side" });
      }
      // Top face
      const topPts = pm.map((p) => project(p.x, p.z, yTop));
      const avg = pm.reduce((s, p) => s + p.x + p.z, 0) / pm.length;
      faces.push({
        pts: topPts,
        fill: topFill,
        stroke: "rgba(0,0,0,0.55)",
        depth: avg + yTop * 0.01,
        sw: 0.7,
        kind: "top",
      });
    }
  }

  // Kolom struktur sengaja tidak dirender di stacking diagram (Aksonometrik).

  // Slab lantai (entitas Floor) — extrude 150mm ke bawah dari MDPL level.
  const SLAB_TOP = "#cfcfcf";
  const SLAB_SIDE = "#9c9c9c";
  const slabThk = FLOOR_THICKNESS_MM / 1000;
  for (const fl of sketch.floors ?? []) {
    const copies = expanded.filter((e) => e.sourceId === fl.levelId);
    if (!copies.length) continue;
    const outerPm = fl.outer.map((p) => ({ x: -(p.x - ox) * mPerPx, z: -(p.y - oy) * mPerPx }));
    if (outerPm.length < 3) continue;
    const holesPm = (fl.holes ?? [])
      .map((h) => h.map((p) => ({ x: -(p.x - ox) * mPerPx, z: -(p.y - oy) * mPerPx })))
      .filter((h) => h.length >= 3);
    for (const cp of copies) {
      const topY = cp.mdpl;
      const botY = topY - slabThk;
      for (let i = 0; i < outerPm.length; i++) {
        const a = outerPm[i];
        const b = outerPm[(i + 1) % outerPm.length];
        const quad = [
          project(a.x, a.z, botY),
          project(b.x, b.z, botY),
          project(b.x, b.z, topY),
          project(a.x, a.z, topY),
        ];
        const depth = (a.x + b.x + a.z + b.z) / 2 + botY * 0.01;
        faces.push({ pts: quad, fill: SLAB_SIDE, stroke: "rgba(0,0,0,0.4)", depth, sw: 0.4, kind: "side" });
      }
      const topPts = outerPm.map((p) => project(p.x, p.z, topY));
      const holesTop = holesPm.map((h) => h.map((p) => project(p.x, p.z, topY)));
      const avg = outerPm.reduce((s, p) => s + p.x + p.z, 0) / outerPm.length;
      faces.push({
        pts: topPts,
        holes: holesTop.length ? holesTop : undefined,
        fill: SLAB_TOP,
        stroke: "rgba(0,0,0,0.5)",
        depth: avg + topY * 0.01 - 0.001,
        sw: 0.5,
        kind: "top",
      });
    }
  }

  const faceLayer = (kind: Face["kind"]) => kind === "base" ? 0 : kind === "top" ? 1 : 2;
  faces.sort((a, b) => faceLayer(a.kind) - faceLayer(b.kind) || a.depth - b.depth);

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
      {faces.map((f, i) => {
        if (f.holes && f.holes.length) {
          const ring = (pts: { x: number; y: number }[]) =>
            `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ") + " Z";
          const d = [f.pts, ...f.holes].map(ring).join(" ");
          return (
            <path
              key={i}
              d={d}
              fill={f.fill}
              fillRule="evenodd"
              stroke={f.stroke}
              strokeWidth={baseStroke * f.sw * 2}
              strokeLinejoin="round"
            />
          );
        }
        return (
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
        );
      })}
    </svg>
  );
}

function StackingBody({ sketch }: { sketch: Sketch }) {
  const levelsAsc = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const groundLv = findMdplZeroLevel(levelsAsc) ?? levelsAsc[0];
  const groundId = groundLv?.id;
  // Taman tidak dihitung sebagai luasan bangunan (lansekap), tidak masuk stacking di level manapun.
  void groundId;
  const build = (sketch.layers ?? []).filter(
    (l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name),
  );
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
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 0", minHeight: 0, maxHeight: 30 }}>
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
            ELEV
          </div>
          <div style={{ flex: 1, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#888" }}>
            Tanah · Elev 0
          </div>
        </div>
      </div>

      {/* Legend & summary */}
      <div style={{ width: 230, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "hidden" }}>
        <div style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: "#777", fontWeight: 600, marginBottom: 6 }}>
            Legenda Level
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
            {levelsAsc.slice().reverse().map((lv) => {
              const baseArea = build
                .filter((l) => l.levelId === lv.id)
                .reduce((s, l) => s + (l.areaM2 || 0), 0);
              const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
              const total = baseArea * k;
              const pct = totalArea > 0 ? (total / totalArea) * 100 : 0;
              const name = displayNames[lv.id] ?? lv.name;
              return (
                <div key={lv.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
                  <span style={{ width: 9, height: 9, background: colorOf(lv.id), border: "1px solid rgba(0,0,0,0.25)", flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}{k > 1 ? ` · ${k}×` : ""}
                  </span>
                  <span style={{ color: "#888", fontSize: 9, fontVariantNumeric: "tabular-nums" }}>
                    {fmt(pct, 1)}%
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 52, textAlign: "right", fontSize: 10 }}>
                    {fmt(total)} m²
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <BigStat label="Jumlah Lapis" value={String(totalFloors)} compact />
        <BigStat label="Total Luas" value={`${fmt(totalArea)} m²`} hint="tanpa Lahan, Void & Taman" compact />
        <BigStat label="Ketinggian" value={`${fmt(ketinggian, 1)} m`} hint="termasuk tipikal" compact />
      </div>
    </div>
  );
}


// ---- Simulasi Aliran Angin (Three.js, conceptual particle stream) ----
function WindBody({ sketch }: { sketch: Sketch }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [wind, setWind] = useState<{ dir: number; speed: number; source: string } | null>(null);
  const [windError, setWindError] = useState<string | null>(null);

  const lat = sketch.geo?.lat ?? -6.2;
  const lon = sketch.geo?.lon ?? 106.816666;
  const northRot = Number(sketch.northRotation) || 0;

  // Fetch nilai angin rata-rata dari Open-Meteo (gratis, tanpa API key).
  useEffect(() => {
    let cancelled = false;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&hourly=wind_direction_10m,wind_speed_10m&past_days=7&forecast_days=1&timezone=auto&wind_speed_unit=ms`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: any) => {
        if (cancelled) return;
        const dirs: number[] = Array.isArray(j?.hourly?.wind_direction_10m) ? j.hourly.wind_direction_10m.filter((v: any) => Number.isFinite(v)) : [];
        const spds: number[] = Array.isArray(j?.hourly?.wind_speed_10m) ? j.hourly.wind_speed_10m.filter((v: any) => Number.isFinite(v)) : [];
        if (!dirs.length || !spds.length) {
          setWind({ dir: 90, speed: 3, source: "default" });
          return;
        }
        // Rata-rata sudut (vector mean) supaya tidak bias di sekitar 0°/360°.
        let sx = 0, sy = 0;
        for (const d of dirs) {
          const r = (d * Math.PI) / 180;
          sx += Math.cos(r);
          sy += Math.sin(r);
        }
        const dirAvg = ((Math.atan2(sy / dirs.length, sx / dirs.length) * 180) / Math.PI + 360) % 360;
        const spdAvg = spds.reduce((a, b) => a + b, 0) / spds.length;
        setWind({ dir: dirAvg, speed: spdAvg, source: "Open-Meteo" });
      })
      .catch((e: any) => {
        if (cancelled) return;
        setWindError(String(e?.message ?? e));
        setWind({ dir: 90, speed: 3, source: "default" });
      });
    return () => { cancelled = true; };
  }, [lat, lon]);

  // Scene Three.js dipasang sekali; arah/kecepatan partikel diperbarui via ref.
  const windRef = useRef(wind);
  windRef.current = wind;

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    let stopped = false;

    const W0 = Math.max(320, host.clientWidth);
    const H0 = Math.max(240, host.clientHeight);

    const BG_HEX = "#f5f5f5";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_HEX);
    scene.fog = new THREE.Fog(BG_HEX, 120, 320);

    const camera = new THREE.PerspectiveCamera(38, W0 / H0, 0.5, 1500);
    // preserveDrawingBuffer agar snapshot toDataURL (PDF export) menangkap frame terakhir.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W0, H0);
    host.appendChild(renderer.domElement);
    (renderer.domElement.style as any).display = "block";

    // Lighting tema terang.
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d2dc, 1.1));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6);
    dl.position.set(40, 80, 30);
    scene.add(dl);

    // -------- Build massing group --------
    const massGroup = new THREE.Group();
    scene.add(massGroup);

    const mPerPx = stackMetersPerPx(sketch.scale);
    const ascLevels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
    const expanded = expandLevelsForView(ascLevels);
    const lahan = (sketch.layers ?? []).filter((l) => isLahan(l.name));
    const build = (sketch.layers ?? []).filter(
      (l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name),
    );

    let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity;
    for (const l of sketch.layers ?? []) for (const p of l.points) {
      if (p.x < minPx) minPx = p.x; if (p.y < minPy) minPy = p.y;
      if (p.x > maxPx) maxPx = p.x; if (p.y > maxPy) maxPy = p.y;
    }
    if (!Number.isFinite(minPx)) { minPx = 0; minPy = 0; maxPx = 100; maxPy = 100; }
    const ox = (minPx + maxPx) / 2;
    const oy = (minPy + maxPy) / 2;
    const toXZ = (p: { x: number; y: number }) => ({ x: (p.x - ox) * mPerPx, z: (p.y - oy) * mPerPx });

    // Ground site (warna terang).
    let siteMinX = Infinity, siteMinZ = Infinity, siteMaxX = -Infinity, siteMaxZ = -Infinity;
    if (lahan.length > 0) {
      for (const ly of lahan) {
        const pts = ly.points.map(toXZ);
        if (pts.length < 3) continue;
        const shape = new THREE.Shape();
        pts.forEach((p, i) => i === 0 ? shape.moveTo(p.x, p.z) : shape.lineTo(p.x, p.z));
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: "#e6e9ec", roughness: 0.95, metalness: 0 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = -0.01;
        massGroup.add(mesh);
        for (const p of pts) {
          if (p.x < siteMinX) siteMinX = p.x;
          if (p.z < siteMinZ) siteMinZ = p.z;
          if (p.x > siteMaxX) siteMaxX = p.x;
          if (p.z > siteMaxZ) siteMaxZ = p.z;
        }
      }
    }

    // Bangunan: extrude per layer per level (greyscale terang).
    type Box = { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number; cx: number; cz: number; rx: number; rz: number };
    const boxes: Box[] = [];
    for (const lv of expanded) {
      const layers = build.filter((l) => l.levelId === lv.sourceId);
      for (const ly of layers) {
        const pts = ly.points.map(toXZ);
        if (pts.length < 3) continue;
        const ov = roomExtrudeOverride(ly.name);
        const yBot = lv.mdpl + (ov?.baseDelta ?? 0);
        const height = ov?.height ?? lv.height;
        if (height <= 0.001) continue;
        const yTop = yBot + height;

        const shape = new THREE.Shape();
        pts.forEach((p, i) => i === 0 ? shape.moveTo(p.x, p.z) : shape.lineTo(p.x, p.z));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, yTop, 0);
        const isGreen = isAtapHijau(ly.name);
        const color = isGreen ? "#7fb98a" : "#e2e6ea";
        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.7,
          metalness: 0.02,
          flatShading: true,
        });
        const mesh = new THREE.Mesh(geo, mat);
        massGroup.add(mesh);

        const edges = new THREE.EdgesGeometry(geo, 25);
        const elines = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: 0x1a2a3a, transparent: true, opacity: 0.75 }),
        );
        massGroup.add(elines);

        let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
        for (const p of pts) {
          if (p.x < bMinX) bMinX = p.x; if (p.x > bMaxX) bMaxX = p.x;
          if (p.z < bMinZ) bMinZ = p.z; if (p.z > bMaxZ) bMaxZ = p.z;
        }
        boxes.push({
          minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ,
          minY: yBot, maxY: yTop,
          cx: (bMinX + bMaxX) / 2, cz: (bMinZ + bMaxZ) / 2,
          rx: Math.max(0.5, (bMaxX - bMinX) / 2),
          rz: Math.max(0.5, (bMaxZ - bMinZ) / 2),
        });
      }
    }

    if (!Number.isFinite(siteMinX)) {
      siteMinX = Infinity; siteMinZ = Infinity; siteMaxX = -Infinity; siteMaxZ = -Infinity;
      for (const b of boxes) {
        siteMinX = Math.min(siteMinX, b.minX); siteMaxX = Math.max(siteMaxX, b.maxX);
        siteMinZ = Math.min(siteMinZ, b.minZ); siteMaxZ = Math.max(siteMaxZ, b.maxZ);
      }
      if (!Number.isFinite(siteMinX)) { siteMinX = -20; siteMaxX = 20; siteMinZ = -20; siteMaxZ = 20; }
      const padX = Math.max(8, (siteMaxX - siteMinX) * 0.25);
      const padZ = Math.max(8, (siteMaxZ - siteMinZ) * 0.25);
      siteMinX -= padX; siteMaxX += padX; siteMinZ -= padZ; siteMaxZ += padZ;
    }
    const domW = siteMaxX - siteMinX;
    const domD = siteMaxZ - siteMinZ;
    const domCx = (siteMinX + siteMaxX) / 2;
    const domCz = (siteMinZ + siteMaxZ) / 2;
    const domR = Math.hypot(domW, domD) / 2;
    const maxBuildY = boxes.reduce((m, b) => Math.max(m, b.maxY), 6);

    const camDist = Math.max(40, domR * 2.3);
    camera.position.set(domCx + camDist * 0.65, maxBuildY + domR * 0.9, domCz + camDist * 0.65);
    camera.lookAt(domCx, maxBuildY * 0.35, domCz);

    // -------- Particle TRAIL system: 7000 partikel × tail 20 meter, satu BufferGeometry --------
    const N = 7000;
    const TAIL_MAX = 20;
    const SEG_PER = TAIL_MAX - 1;
    const TRAIL_LENGTH_M = 20; // panjang total jejak partikel dalam meter
    const SEG_LEN_M = TRAIL_LENGTH_M / SEG_PER; // jarak antar simpul jejak (~1.05 m)
    const VTX_TOTAL = N * TAIL_MAX;
    const positions = new Float32Array(VTX_TOTAL * 3);
    const colors = new Float32Array(VTX_TOTAL * 3);
    const indices = new Uint32Array(N * SEG_PER * 2);
    for (let i = 0; i < N; i++) {
      const base = i * TAIL_MAX;
      const ix0 = i * SEG_PER * 2;
      for (let k = 0; k < SEG_PER; k++) {
        indices[ix0 + k * 2] = base + k;
        indices[ix0 + k * 2 + 1] = base + k + 1;
      }
    }
    const ages = new Float32Array(N);
    const maxAge = new Float32Array(N);
    const tailLen = new Uint8Array(N); // jumlah simpul jejak aktif (tumbuh seiring partikel bergerak)
    const accDist = new Float32Array(N); // akumulasi jarak head sejak shift terakhir
    const spawnX = new Float32Array(N);
    const spawnZ = new Float32Array(N);
    const TRAVEL_MAX_M = 200;

    // Gradasi: ekor (tail) biru gelap pudar → kepala (head) cyan terang
    const colHead = new THREE.Color("#00d4ff");
    const colTail = new THREE.Color("#0a2540");
    const colBg = new THREE.Color(BG_HEX);

    function paintColors(i: number) {
      const tl = tailLen[i];
      const base = i * TAIL_MAX;
      for (let k = 0; k < TAIL_MAX; k++) {
        const within = k >= (TAIL_MAX - tl);
        const off = (base + k) * 3;
        if (!within) {
          colors[off] = colBg.r; colors[off + 1] = colBg.g; colors[off + 2] = colBg.b;
          continue;
        }
        // t = 0 di ekor (paling tua), t = 1 di kepala (paling depan)
        const t = (k - (TAIL_MAX - tl)) / Math.max(1, tl - 1);
        // Easing kuadratik supaya transisi head ↔ tail terbaca jelas
        const e = t * t;
        const c = colTail.clone().lerp(colHead, e);
        // Fade ekor ke warna latar agar ujung jejak terasa pudar
        const fade = 0.25 + 0.75 * t;
        c.lerp(colBg, 1 - fade);
        colors[off] = c.r;
        colors[off + 1] = c.g;
        colors[off + 2] = c.b;
      }
    }

    const geoLines = new THREE.BufferGeometry();
    geoLines.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geoLines.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geoLines.setIndex(new THREE.BufferAttribute(indices, 1));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geoLines, lineMat);
    scene.add(lines);

    const windRefLocal = windRef;
    function windVec(): { vx: number; vz: number; speed: number } {
      const w = windRefLocal.current;
      const dirDeg = w ? w.dir : 90;
      const spdMs = w ? Math.max(0.3, w.speed) : 3;
      const effDeg = (dirDeg - northRot + 360) % 360;
      const t = (effDeg * Math.PI) / 180;
      const vx = -Math.sin(t);
      const vz = Math.cos(t);
      const visSpeed = Math.min(18, 4 + spdMs * 1.2);
      return { vx: vx * visSpeed, vz: vz * visSpeed, speed: spdMs };
    }

    function spawn(i: number) {
      const w = windVec();
      const dirLen = Math.hypot(w.vx, w.vz) || 1;
      const nx = w.vx / dirLen;
      const nz = w.vz / dirLen;
      const upX = domCx - nx * (domR + 4);
      const upZ = domCz - nz * (domR + 4);
      const px = -nz, pz = nx;
      const spread = (Math.random() - 0.5) * 2 * (domR * 1.05);
      const sx = upX + px * spread;
      const sz = upZ + pz * spread;
      const sy = 0.5 + Math.random() * Math.max(8, maxBuildY * 0.95);
      const base = i * TAIL_MAX;
      for (let k = 0; k < TAIL_MAX; k++) {
        const o = (base + k) * 3;
        positions[o] = sx; positions[o + 1] = sy; positions[o + 2] = sz;
      }
      ages[i] = 0;
      maxAge[i] = 30 + Math.random() * 20;
      tailLen[i] = 1; // tumbuh secara bertahap saat partikel bergerak
      accDist[i] = 0;
      spawnX[i] = sx;
      spawnZ[i] = sz;
      paintColors(i);
    }
    for (let i = 0; i < N; i++) spawn(i);
    (geoLines.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    let lastT = performance.now();
    const clock = { t: 0 };

    function tick() {
      if (stopped) return;
      const now = performance.now();
      let dt = (now - lastT) / 1000;
      lastT = now;
      if (dt > 0.066) dt = 0.066;
      clock.t += dt;

      const w = windVec();
      const wvx = w.vx, wvz = w.vz;

      for (let i = 0; i < N; i++) {
        const base = i * TAIL_MAX;
        const headOff = (base + TAIL_MAX - 1) * 3;
        const x = positions[headOff];
        const y = positions[headOff + 1];
        const z = positions[headOff + 2];

        let vx = wvx;
        let vy = 0;
        let vz = wvz;

        for (let k = 0; k < boxes.length; k++) {
          const b = boxes[k];
          if (y < b.minY - 0.5 || y > b.maxY + 4) continue;
          const dx = x - b.cx;
          const dz = z - b.cz;
          const ex = Math.abs(dx) - b.rx;
          const ez = Math.abs(dz) - b.rz;
          const proxy = Math.max(ex, ez);
          const halo = 3.0;
          if (proxy < halo) {
            const intensity = Math.max(0, Math.min(1, (halo - proxy) / halo));
            const lenH = Math.max(0.001, Math.hypot(dx, dz));
            const pushX = (dx / lenH) * 12 * intensity;
            const pushZ = (dz / lenH) * 12 * intensity;
            const liftFactor = y < b.maxY ? 1 : 0.35;
            const pushY = 8 * intensity * liftFactor;
            vx += pushX; vy += pushY; vz += pushZ;
            if (proxy < 0) {
              if (ex > ez) {
                positions[headOff] = b.cx + Math.sign(dx || 1) * (b.rx + 0.1);
              } else {
                positions[headOff + 2] = b.cz + Math.sign(dz || 1) * (b.rz + 0.1);
              }
            }
          }
        }

        const turb = 0.6;
        vx += Math.sin(clock.t * 1.7 + i * 0.13) * turb;
        vz += Math.cos(clock.t * 1.3 + i * 0.21) * turb;
        vy += Math.sin(clock.t * 0.9 + i * 0.07) * 0.4;

        // Hitung langkah head berikutnya, lalu putuskan shift berdasarkan jarak (bukan dt)
        // agar total panjang jejak konsisten ~20 m terlepas dari kecepatan angin.
        const stepX = vx * dt;
        const stepY = vy * dt;
        const stepZ = vz * dt;
        const stepDist = Math.hypot(stepX, stepZ); // jarak horizontal yang ditempuh
        accDist[i] += stepDist;

        let nxp = positions[headOff] + stepX;
        let nyp = positions[headOff + 1] + stepY;
        let nzp = positions[headOff + 2] + stepZ;
        if (nyp < 0.3) nyp = 0.3;

        let didShift = false;
        while (accDist[i] >= SEG_LEN_M) {
          positions.copyWithin(base * 3, base * 3 + 3, (base + TAIL_MAX) * 3);
          accDist[i] -= SEG_LEN_M;
          if (tailLen[i] < TAIL_MAX) {
            tailLen[i]++;
            didShift = true;
          }
        }
        positions[headOff] = nxp;
        positions[headOff + 1] = nyp;
        positions[headOff + 2] = nzp;
        if (didShift) paintColors(i);

        ages[i] += dt;
        const dxSp = nxp - spawnX[i];
        const dzSp = nzp - spawnZ[i];
        const traveled = Math.hypot(dxSp, dzSp);
        const dxCx = nxp - domCx;
        const dzCz = nzp - domCz;
        const farOut = Math.hypot(dxCx, dzCz) > domR + TRAVEL_MAX_M + 20 || nyp > maxBuildY * 1.4 + 12;
        if (farOut || traveled >= TRAVEL_MAX_M || ages[i] > maxAge[i]) {
          spawn(i);
        }
      }

      (geoLines.attributes.color as THREE.BufferAttribute).needsUpdate = true;

      (geoLines.attributes.position as THREE.BufferAttribute).needsUpdate = true;

      // Orbit kamera lambat untuk efek sinematik.
      const ang = clock.t * 0.05;
      const radius = camDist;
      camera.position.x = domCx + Math.cos(ang) * radius * 0.65;
      camera.position.z = domCz + Math.sin(ang) * radius * 0.65;
      camera.position.y = maxBuildY + domR * 0.9;
      camera.lookAt(domCx, maxBuildY * 0.35, domCz);

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    }
    let rafId = requestAnimationFrame(tick);

    // Resize observer.
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    });
    ro.observe(host);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      // Dispose semua geometry/material agar memori tablet tetap terjaga.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: any };
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) mesh.material.forEach((m: any) => m?.dispose?.());
          else mesh.material.dispose?.();
        }
      });
      geoLines.dispose();
      lineMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch.id, sketch.updatedAt]);

  const dirLabel = wind ? `${wind.dir.toFixed(0)}°` : "—";
  const spdLabel = wind ? `${wind.speed.toFixed(1)} m/s` : "—";
  const cardinal = wind ? dirToCardinal(wind.dir) : "—";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#f5f5f5", overflow: "hidden" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      {/* Kompas arah angin */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          color: "#0b2440",
          fontFamily: "var(--font-display, Sora, sans-serif)",
          background: "rgba(255,255,255,0.78)",
          border: "1px solid rgba(0,51,102,0.25)",
          padding: "10px 14px",
          minWidth: 180,
          backdropFilter: "blur(4px)",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "#003366", fontWeight: 600 }}>
          Data Iklim
        </div>
        <div style={{ marginTop: 6, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {dirLabel} <span style={{ color: "#005588", fontSize: 14, marginLeft: 4 }}>{cardinal}</span>
        </div>
        <div style={{ fontSize: 11, color: "#52677c", marginTop: 2 }}>Arah Angin Dominan</div>
        <div style={{ marginTop: 8, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {spdLabel}
        </div>
        <div style={{ fontSize: 11, color: "#52677c", marginTop: 2 }}>Kecepatan rata-rata</div>
        <div style={{ marginTop: 8, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#7a8a9c" }}>
          {wind?.source ?? (windError ? "fallback" : "memuat…")}
        </div>
      </div>
      {/* Koordinat tapak */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          right: 18,
          color: "#52677c",
          fontFamily: "var(--font-sans, Manrope, sans-serif)",
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          background: "rgba(255,255,255,0.7)",
          padding: "6px 10px",
          border: "1px solid rgba(0,51,102,0.18)",
        }}
      >
        {lat.toFixed(4)}°, {lon.toFixed(4)}° · partikel angin konseptual
      </div>
    </div>
  );
}

function dirToCardinal(deg: number): string {
  const dirs = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"];
  const i = Math.round(((deg % 360) / 45)) % 8;
  return dirs[i];
}

// ============================================================
// Analisa Thermal Heatmap — lokal, tanpa AI
// Per-face N·L exposure + AABB shadow occlusion (CPU raycast).
// ============================================================
function ThermalBody({ sketch }: { sketch: Sketch }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [hour, setHour] = useState<number>(12);
  const [month, setMonth] = useState<number>(6); // 1..12
  const [peak, setPeak] = useState<{ side: string; hour: number; value: number } | null>(null);

  const lat = sketch.geo?.lat ?? -6.2;
  const lon = sketch.geo?.lon ?? 106.816666;
  const northRot = Number(sketch.northRotation) || 0;

  // Scene state held via refs so slider changes don't rebuild geometry.
  const sceneRef = useRef<{
    update: (h: number, m: number) => void;
    bestSidePerHour: () => { side: string; hour: number; value: number } | null;
  } | null>(null);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    let stopped = false;

    const W0 = Math.max(320, host.clientWidth);
    const H0 = Math.max(240, host.clientHeight);

    const BG_HEX = "#f4f5f7";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_HEX);

    const camera = new THREE.PerspectiveCamera(38, W0 / H0, 0.5, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W0, H0);
    host.appendChild(renderer.domElement);
    (renderer.domElement.style as any).display = "block";

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    // ---- Build massing (mirror WindBody) ----
    const mPerPx = stackMetersPerPx(sketch.scale);
    const ascLevels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
    const expanded = expandLevelsForView(ascLevels);
    const lahan = (sketch.layers ?? []).filter((l) => isLahan(l.name));
    const build = (sketch.layers ?? []).filter(
      (l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name),
    );

    let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity;
    for (const l of sketch.layers ?? []) for (const p of l.points) {
      if (p.x < minPx) minPx = p.x; if (p.y < minPy) minPy = p.y;
      if (p.x > maxPx) maxPx = p.x; if (p.y > maxPy) maxPy = p.y;
    }
    if (!Number.isFinite(minPx)) { minPx = 0; minPy = 0; maxPx = 100; maxPy = 100; }
    const ox = (minPx + maxPx) / 2;
    const oy = (minPy + maxPy) / 2;
    const toXZ = (p: { x: number; y: number }) => ({ x: (p.x - ox) * mPerPx, z: (p.y - oy) * mPerPx });

    // Ground site.
    let siteMinX = Infinity, siteMinZ = Infinity, siteMaxX = -Infinity, siteMaxZ = -Infinity;
    if (lahan.length > 0) {
      for (const ly of lahan) {
        const pts = ly.points.map(toXZ);
        if (pts.length < 3) continue;
        const shape = new THREE.Shape();
        pts.forEach((p, i) => i === 0 ? shape.moveTo(p.x, p.z) : shape.lineTo(p.x, p.z));
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: "#dfe3e8" });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = -0.01;
        scene.add(mesh);
        for (const p of pts) {
          if (p.x < siteMinX) siteMinX = p.x;
          if (p.z < siteMinZ) siteMinZ = p.z;
          if (p.x > siteMaxX) siteMaxX = p.x;
          if (p.z > siteMaxZ) siteMaxZ = p.z;
        }
      }
    }

    type Box = { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
    type FaceData = {
      mesh: THREE.Mesh;
      centroids: Float32Array; // length triCount * 3 (world)
      normals: Float32Array;   // length triCount * 3 (world, normalized)
      triCount: number;
      ownerBoxIdx: number;
    };
    const boxes: Box[] = [];
    const faceList: FaceData[] = [];

    for (const lv of expanded) {
      const layers = build.filter((l) => l.levelId === lv.sourceId);
      for (const ly of layers) {
        const pts = ly.points.map(toXZ);
        if (pts.length < 3) continue;
        const ov = roomExtrudeOverride(ly.name);
        const yBot = lv.mdpl + (ov?.baseDelta ?? 0);
        const height = ov?.height ?? lv.height;
        if (height <= 0.001) continue;
        const yTop = yBot + height;

        const shape = new THREE.Shape();
        pts.forEach((p, i) => i === 0 ? shape.moveTo(p.x, p.z) : shape.lineTo(p.x, p.z));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, yTop, 0);
        geo.computeVertexNormals();

        const posAttr = geo.attributes.position as THREE.BufferAttribute;
        const vCount = posAttr.count;
        const colorArr = new Float32Array(vCount * 3);
        for (let i = 0; i < vCount * 3; i++) colorArr[i] = 0.5;
        geo.setAttribute("color", new THREE.BufferAttribute(colorArr, 3));

        const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);

        const edges = new THREE.EdgesGeometry(geo, 25);
        const elines = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35 }),
        );
        scene.add(elines);

        let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
        for (const p of pts) {
          if (p.x < bMinX) bMinX = p.x; if (p.x > bMaxX) bMaxX = p.x;
          if (p.z < bMinZ) bMinZ = p.z; if (p.z > bMaxZ) bMaxZ = p.z;
        }
        const boxIdx = boxes.length;
        boxes.push({ minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ, minY: yBot, maxY: yTop });

        // Build per-triangle centroid & normal (world-space; geometry already in world coords since no transform).
        const triCount = Math.floor(vCount / 3);
        const centroids = new Float32Array(triCount * 3);
        const normals = new Float32Array(triCount * 3);
        const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
        const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
        for (let t = 0; t < triCount; t++) {
          pa.fromBufferAttribute(posAttr, t * 3 + 0);
          pb.fromBufferAttribute(posAttr, t * 3 + 1);
          pc.fromBufferAttribute(posAttr, t * 3 + 2);
          centroids[t * 3] = (pa.x + pb.x + pc.x) / 3;
          centroids[t * 3 + 1] = (pa.y + pb.y + pc.y) / 3;
          centroids[t * 3 + 2] = (pa.z + pb.z + pc.z) / 3;
          ab.subVectors(pb, pa);
          ac.subVectors(pc, pa);
          n.crossVectors(ab, ac).normalize();
          normals[t * 3] = n.x;
          normals[t * 3 + 1] = n.y;
          normals[t * 3 + 2] = n.z;
        }
        faceList.push({ mesh, centroids, normals, triCount, ownerBoxIdx: boxIdx });
      }
    }

    if (!Number.isFinite(siteMinX)) {
      siteMinX = Infinity; siteMinZ = Infinity; siteMaxX = -Infinity; siteMaxZ = -Infinity;
      for (const b of boxes) {
        siteMinX = Math.min(siteMinX, b.minX); siteMaxX = Math.max(siteMaxX, b.maxX);
        siteMinZ = Math.min(siteMinZ, b.minZ); siteMaxZ = Math.max(siteMaxZ, b.maxZ);
      }
      if (!Number.isFinite(siteMinX)) { siteMinX = -20; siteMaxX = 20; siteMinZ = -20; siteMaxZ = 20; }
      const padX = Math.max(8, (siteMaxX - siteMinX) * 0.25);
      const padZ = Math.max(8, (siteMaxZ - siteMinZ) * 0.25);
      siteMinX -= padX; siteMaxX += padX; siteMinZ -= padZ; siteMaxZ += padZ;
    }
    const domCx = (siteMinX + siteMaxX) / 2;
    const domCz = (siteMinZ + siteMaxZ) / 2;
    const domR = Math.hypot(siteMaxX - siteMinX, siteMaxZ - siteMinZ) / 2;
    const maxBuildY = boxes.reduce((m, b) => Math.max(m, b.maxY), 6);
    const sceneRadius = Math.max(40, domR * 2 + maxBuildY);

    const camDist = Math.max(50, domR * 2.6);
    camera.position.set(domCx + camDist * 0.7, maxBuildY + domR * 1.0, domCz + camDist * 0.7);
    camera.lookAt(domCx, maxBuildY * 0.35, domCz);

    // ---- Sun direction from local time (WIB ≈ UTC+7) ----
    function sunDir(h: number, m: number): { x: number; y: number; z: number; altDeg: number; azDeg: number } {
      const year = new Date().getUTCFullYear();
      const day = 15;
      const hourInt = Math.floor(h);
      const minute = Math.round((h - hourInt) * 60);
      // WIB → UTC: subtract 7h
      const utcHour = hourInt - 7;
      const d = new Date(Date.UTC(year, m - 1, day, utcHour, minute, 0));
      const p = SunCalc.getPosition(d, lat, lon);
      // SunCalc azimuth: 0 = south, +CW (south = 0, west = +π/2). Convert to north-CW.
      const azNorthCW = (p.azimuth + Math.PI) * (180 / Math.PI);
      const azSketch = ((azNorthCW + northRot) % 360 + 360) % 360;
      const altDeg = (p.altitude * 180) / Math.PI;
      // Vector from surface TOWARD sun. Sketch frame: north = -Z, east = +X, up = +Y.
      const altRad = (altDeg * Math.PI) / 180;
      const azRad = (azSketch * Math.PI) / 180;
      const horiz = Math.cos(altRad);
      // azimuth 0 = north (-Z); 90 = east (+X)
      const x = horiz * Math.sin(azRad);
      const z = -horiz * Math.cos(azRad);
      const y = Math.sin(altRad);
      return { x, y, z, altDeg, azDeg: azSketch };
    }

    // Ray-AABB (slab method). Returns t of first hit > tMin within [tMin, tMax], or -1.
    function rayHitsBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box, tMin: number, tMax: number): boolean {
      let tmin = tMin, tmax = tMax;
      const inv = (v: number) => v !== 0 ? 1 / v : 1e30;
      let t1 = (b.minX - ox) * inv(dx);
      let t2 = (b.maxX - ox) * inv(dx);
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmax < tmin) return false;
      t1 = (b.minY - oy) * inv(dy);
      t2 = (b.maxY - oy) * inv(dy);
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmax < tmin) return false;
      t1 = (b.minZ - oz) * inv(dz);
      t2 = (b.maxZ - oz) * inv(dz);
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmax < tmin) return false;
      return true;
    }

    // Color ramp: 0 → biru, 0.5 → kuning, 1 → merah.
    const cBlue = new THREE.Color("#1e6cff");
    const cCool = new THREE.Color("#56b4ff");
    const cYellow = new THREE.Color("#ffd23f");
    const cOrange = new THREE.Color("#ff8c1a");
    const cRed = new THREE.Color("#e63226");
    const tmpCol = new THREE.Color();
    function ramp(v: number): THREE.Color {
      const x = Math.max(0, Math.min(1, v));
      if (x < 0.25) return tmpCol.copy(cBlue).lerp(cCool, x / 0.25);
      if (x < 0.55) return tmpCol.copy(cCool).lerp(cYellow, (x - 0.25) / 0.30);
      if (x < 0.80) return tmpCol.copy(cYellow).lerp(cOrange, (x - 0.55) / 0.25);
      return tmpCol.copy(cOrange).lerp(cRed, (x - 0.80) / 0.20);
    }

    function applyHeatmap(h: number, m: number) {
      const s = sunDir(h, m);
      const isNight = s.altDeg <= 0;
      const Lx = s.x, Ly = s.y, Lz = s.z;
      const tMax = sceneRadius * 2;
      for (const fd of faceList) {
        const colAttr = fd.mesh.geometry.attributes.color as THREE.BufferAttribute;
        const arr = colAttr.array as Float32Array;
        for (let t = 0; t < fd.triCount; t++) {
          let exposure: number;
          if (isNight) {
            exposure = 0;
          } else {
            const nx = fd.normals[t * 3];
            const ny = fd.normals[t * 3 + 1];
            const nz = fd.normals[t * 3 + 2];
            const ndotl = nx * Lx + ny * Ly + nz * Lz;
            if (ndotl <= 0) {
              exposure = 0; // self-back-face: shaded
            } else {
              // Shadow occlusion: ray from centroid toward sun against other boxes.
              const cx = fd.centroids[t * 3];
              const cy = fd.centroids[t * 3 + 1];
              const cz = fd.centroids[t * 3 + 2];
              let occluded = false;
              for (let bi = 0; bi < boxes.length; bi++) {
                if (bi === fd.ownerBoxIdx) continue;
                if (rayHitsBox(cx, cy, cz, Lx, Ly, Lz, boxes[bi], 0.1, tMax)) {
                  occluded = true; break;
                }
              }
              const altFactor = Math.max(0.1, Math.min(1, s.altDeg / 60));
              exposure = occluded ? 0.05 : ndotl * altFactor;
            }
          }
          const c = ramp(exposure);
          const off = t * 9; // 3 verts * 3 channels
          for (let v = 0; v < 3; v++) {
            arr[off + v * 3 + 0] = c.r;
            arr[off + v * 3 + 1] = c.g;
            arr[off + v * 3 + 2] = c.b;
          }
        }
        colAttr.needsUpdate = true;
      }
    }

    // Precompute peak side across the day for current month.
    function computePeakSide(m: number): { side: string; hour: number; value: number } | null {
      // For each test hour, accumulate exposure per cardinal sector based on face normals (XZ).
      const sectors = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"];
      let best = { side: "", hour: 12, value: -1 };
      for (let h = 6; h <= 18; h += 1) {
        const s = sunDir(h, m);
        if (s.altDeg <= 0) continue;
        const Lx = s.x, Ly = s.y, Lz = s.z;
        const acc = new Array(8).fill(0);
        for (const fd of faceList) {
          for (let t = 0; t < fd.triCount; t++) {
            const nx = fd.normals[t * 3];
            const ny = fd.normals[t * 3 + 1];
            const nz = fd.normals[t * 3 + 2];
            // ignore near-horizontal (roof/floor): only count vertical-ish faces
            if (Math.abs(ny) > 0.8) continue;
            const ndotl = nx * Lx + ny * Ly + nz * Lz;
            if (ndotl <= 0) continue;
            // facing direction in sketch frame: nx=east, -nz=north.
            const azFace = (Math.atan2(nx, -nz) * 180) / Math.PI;
            const azPos = (azFace + 360) % 360;
            const idx = Math.round(azPos / 45) % 8;
            acc[idx] += ndotl;
          }
        }
        for (let i = 0; i < 8; i++) {
          if (acc[i] > best.value) best = { side: sectors[i], hour: h, value: acc[i] };
        }
      }
      return best.value >= 0 ? best : null;
    }

    sceneRef.current = {
      update: (h, m) => { applyHeatmap(h, m); },
      bestSidePerHour: () => computePeakSide(month),
    };

    applyHeatmap(hour, month);
    setPeak(computePeakSide(month));

    // Simple slow orbit so model reads as 3D.
    let lastT = performance.now();
    let ang = 0;
    function tick() {
      if (stopped) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      ang += dt * 0.08;
      const r = camDist;
      camera.position.x = domCx + Math.cos(ang) * r * 0.7;
      camera.position.z = domCz + Math.sin(ang) * r * 0.7;
      camera.position.y = maxBuildY + domR * 0.95;
      camera.lookAt(domCx, maxBuildY * 0.35, domCz);
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    }
    let rafId = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      if (w > 0 && h > 0) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    });
    ro.observe(host);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      sceneRef.current = null;
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: any };
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) mesh.material.forEach((m: any) => m?.dispose?.());
          else mesh.material.dispose?.();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch.id, sketch.updatedAt]);

  // Slider changes → re-paint, no rebuild.
  useEffect(() => {
    sceneRef.current?.update(hour, month);
  }, [hour, month]);

  useEffect(() => {
    const p = sceneRef.current?.bestSidePerHour();
    if (p) setPeak(p);
  }, [month]);

  const sideName = (s: string) => ({
    U: "Utara", TL: "Timur Laut", T: "Timur", TG: "Tenggara",
    S: "Selatan", BD: "Barat Daya", B: "Barat", BL: "Barat Laut",
  } as Record<string, string>)[s] ?? s;

  const monthName = (m: number) => [
    "Januari","Februari","Maret","April","Mei","Juni",
    "Juli","Agustus","September","Oktober","November","Desember",
  ][m - 1];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#f4f5f7", overflow: "hidden" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      {/* Color ramp legend */}
      <div style={{
        position: "absolute", top: 16, left: 16,
        background: "rgba(255,255,255,0.92)", border: "1px solid rgba(0,0,0,0.12)",
        padding: "10px 12px", borderRadius: 8, fontSize: 12, color: "#1a2230",
        minWidth: 180,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Intensitas Radiasi</div>
        <div style={{
          height: 10, borderRadius: 999,
          background: "linear-gradient(to right, #1e6cff, #56b4ff, #ffd23f, #ff8c1a, #e63226)",
          marginBottom: 4,
        }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#56607a" }}>
          <span>Teduh</span><span>Miring</span><span>Tegak Lurus</span>
        </div>
      </div>

      {/* Metric chip */}
      <div style={{
        position: "absolute", top: 16, right: 16,
        background: "rgba(255,255,255,0.92)", border: "1px solid rgba(0,0,0,0.12)",
        padding: "10px 12px", borderRadius: 8, fontSize: 12, color: "#1a2230",
        maxWidth: 320,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Ringkasan Paparan</div>
        {peak ? (
          <div>
            Sisi <b>{sideName(peak.side)}</b> menerima paparan tertinggi pada jam {String(peak.hour).padStart(2,"0")}.00 ({monthName(month)}).
          </div>
        ) : (
          <div>Tidak ada paparan signifikan pada bulan ini.</div>
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: "#56607a" }}>
          {lat.toFixed(3)}°, {lon.toFixed(3)}° · Utara {northRot.toFixed(0)}°
        </div>
      </div>

      {/* Slider controls */}
      <div style={{
        position: "absolute", left: 16, right: 16, bottom: 16,
        display: "flex", gap: 16, alignItems: "stretch", justifyContent: "center",
      }}>
        <div style={{
          flex: 1, maxWidth: 480,
          background: "rgba(255,255,255,0.94)", border: "1px solid rgba(0,0,0,0.12)",
          padding: "10px 14px", borderRadius: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: "#1a2230" }}>Jam (WIB)</span>
            <span style={{ color: "#1a2230" }}>{hour.toFixed(1).padStart(4, "0")}.00</span>
          </div>
          <input
            type="range" min={6} max={18} step={0.5} value={hour}
            onChange={(e) => setHour(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#56607a" }}>
            <span>06.00</span><span>12.00</span><span>18.00</span>
          </div>
        </div>
        <div style={{
          flex: 1, maxWidth: 480,
          background: "rgba(255,255,255,0.94)", border: "1px solid rgba(0,0,0,0.12)",
          padding: "10px 14px", borderRadius: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: "#1a2230" }}>Bulan</span>
            <span style={{ color: "#1a2230" }}>{monthName(month)}</span>
          </div>
          <input
            type="range" min={1} max={12} step={1} value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#56607a" }}>
            <span>Jan</span><span>Jun</span><span>Des</span>
          </div>
        </div>
      </div>
    </div>
  );
}


// ---- Exploded Axonometric (per unique layout type) ----
function ExplodedAxoBody({ sketch }: { sketch: Sketch }) {
  const mPerPx = stackMetersPerPx(sketch.scale);
  const ascLevels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const displayNames = computeLevelDisplayNames(ascLevels, sketch.layers ?? []);

  // Signature per source level: nama ruang + luas (m²) yang dibulatkan.
  const buildLayersOf = (levelId: string) =>
    (sketch.layers ?? []).filter(
      (l) => l.levelId === levelId && !isLahan(l.name) && !isVoid(l.name),
    );
  const sigOf = (levelId: string) => {
    const ls = buildLayersOf(levelId);
    if (!ls.length) return "";
    return ls
      .map((l) => `${l.name.toLowerCase().trim()}|${Math.round(l.areaM2 || 0)}`)
      .sort()
      .join(";");
  };

  // Group level dengan layout identik → 1 representatif (mdpl terendah).
  const groupOrder: string[] = [];
  const groups = new Map<string, { rep: Level; members: Level[] }>();
  for (const lv of ascLevels) {
    const s = sigOf(lv.id);
    if (!s) continue;
    const g = groups.get(s);
    if (!g) {
      groups.set(s, { rep: lv, members: [lv] });
      groupOrder.push(s);
    } else {
      g.members.push(lv);
    }
  }
  const reps = groupOrder.map((s) => groups.get(s)!);

  if (reps.length === 0) {
    return (
      <div style={{ color: "#999", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        Belum ada level untuk diproyeksikan.
      </div>
    );
  }

  // Plan origin = bbox centroid of all layer points (px space)
  let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity;
  for (const l of sketch.layers ?? []) for (const p of l.points) {
    if (p.x < minPx) minPx = p.x; if (p.y < minPy) minPy = p.y;
    if (p.x > maxPx) maxPx = p.x; if (p.y > maxPy) maxPy = p.y;
  }
  if (!Number.isFinite(minPx)) { minPx = 0; minPy = 0; maxPx = 0; maxPy = 0; }
  const ox = (minPx + maxPx) / 2;
  const oy = (minPy + maxPy) / 2;
  const planSizeM = Math.max(maxPx - minPx, maxPy - minPy) * mPerPx;

  const COS = Math.cos(Math.PI / 6);
  const SIN = Math.sin(Math.PI / 6);
  const project = (mx: number, mz: number, my: number) => ({
    x: (mx - mz) * COS,
    y: (mx + mz) * SIN - my,
  });
  const toPm = (l: { points: { x: number; y: number }[] }) =>
    l.points.map((p) => ({ x: -(p.x - ox) * mPerPx, z: -(p.y - oy) * mPerPx }));

  const floorH = 3;
  const gap = Math.max(4, planSizeM * 0.35);

  type Face = {
    pts: { x: number; y: number }[];
    holes?: { x: number; y: number }[][];
    fill: string; stroke: string; depth: number; sw: number;
    kind: "top" | "side";
  };
  type Anno = { at: { x: number; y: number }; label: string; floorIdx: number; num: number };

  const faces: Face[] = [];
  const annos: Anno[] = [];
  const tipeRooms: { name: string; num: number }[][] = reps.map(() => []);

  type VConnEntry = { floorIdx: number; baseY: number; topY: number; kind: "tangga" | "lift" };
  const vconnMap = new Map<string, Map<string, VConnEntry[]>>();
  const isTangga = (n: string) => /tangga/i.test(n);
  const isLift = (n: string) => /lift/i.test(n);
  const ptKey = (x: number, z: number) => `${x.toFixed(3)}|${z.toFixed(3)}`;

  const ABU_HEX = "#bebebe", ABU_SIDE = "#9a9a9a";
  const HIJAU_HEX = "#22c55e", HIJAU_SIDE = "#16a34a";

  reps.forEach((g, idx) => {
    const yBot = idx * (floorH + gap);
    const color = levelColor(idx, reps.length);
    const side = shadeHsl(color, -18);
    const layers = buildLayersOf(g.rep.id);
    let roomCounter = 0;
    for (const ly of layers) {
      const pm = toPm(ly);
      if (pm.length < 3) continue;
      const ov = roomExtrudeOverride(ly.name);
      const baseY = yBot + (ov?.baseDelta ?? 0);
      const topY = baseY + (ov?.height ?? floorH);
      const topFill = ov
        ? (isAtapHijau(ly.name) || isTaman(ly.name) ? HIJAU_HEX : ABU_HEX)
        : color;
      const sideFill = ov
        ? (isAtapHijau(ly.name) || isTaman(ly.name) ? HIJAU_SIDE : ABU_SIDE)
        : side;
      for (let i = 0; i < pm.length; i++) {
        const a = pm[i];
        const b = pm[(i + 1) % pm.length];
        const quad = [
          project(a.x, a.z, baseY),
          project(b.x, b.z, baseY),
          project(b.x, b.z, topY),
          project(a.x, a.z, topY),
        ];
        const depth = (a.x + b.x + a.z + b.z) / 2 + baseY * 0.01;
        faces.push({ pts: quad, fill: sideFill, stroke: "rgba(0,0,0,0.45)", depth, sw: 0.5, kind: "side" });
      }
      const topPts = pm.map((p) => project(p.x, p.z, topY));
      const avg = pm.reduce((s, p) => s + p.x + p.z, 0) / pm.length;
      faces.push({
        pts: topPts, fill: topFill, stroke: "rgba(0,0,0,0.55)",
        depth: avg + topY * 0.01, sw: 0.7, kind: "top",
      });

      // Hanya beri nomor untuk ruang dengan luas ≥ 50 m².
      if ((ly.areaM2 || 0) >= 50) {
        roomCounter += 1;
        const cx = pm.reduce((s, p) => s + p.x, 0) / pm.length;
        const cz = pm.reduce((s, p) => s + p.z, 0) / pm.length;
        annos.push({ at: project(cx, cz, topY), label: ly.name, floorIdx: idx, num: roomCounter });
        tipeRooms[idx].push({ name: ly.name, num: roomCounter });
      }

      if (isTangga(ly.name) || isLift(ly.name)) {
        const key = ly.name.toLowerCase().trim();
        const kind: "tangga" | "lift" = isTangga(ly.name) ? "tangga" : "lift";
        let perPt = vconnMap.get(key);
        if (!perPt) { perPt = new Map(); vconnMap.set(key, perPt); }
        for (const p of pm) {
          const k = ptKey(p.x, p.z);
          const arr = perPt.get(k) ?? [];
          arr.push({ floorIdx: idx, baseY, topY, kind });
          perPt.set(k, arr);
        }
      }
    }
  });


  type VLine = { x: number; z: number; yLo: number; yHi: number; kind: "tangga" | "lift" };
  const vlines: VLine[] = [];
  for (const [, perPt] of vconnMap) {
    for (const [k, entries] of perPt) {
      if (entries.length < 2) continue;
      const [xs, zs] = k.split("|").map(Number);
      const yLo = Math.min(...entries.map((e) => e.baseY));
      const yHi = Math.max(...entries.map((e) => e.topY));
      vlines.push({ x: xs, z: zs, yLo, yHi, kind: entries[0].kind });
    }
  }

  // Slab lantai pada lantai representatif.
  // Pemetaan: levelId di tiap floor → idx grup representatif (atau anggotanya).
  const SLAB_TOP_R = "#cfcfcf", SLAB_SIDE_R = "#9c9c9c";
  const slabThk = FLOOR_THICKNESS_MM / 1000;
  const groupIdxOf = (levelId: string): number => {
    for (let i = 0; i < reps.length; i++) {
      if (reps[i].members.some((m) => m.id === levelId)) return i;
    }
    return -1;
  };
  // Pilih 1 floor per grup (yang levelId-nya adalah rep, atau fallback floor pertama yang termasuk grup).
  const floorByGroup = new Map<number, Floor>();
  for (const fl of sketch.floors ?? []) {
    const gi = groupIdxOf(fl.levelId);
    if (gi < 0) continue;
    const cur = floorByGroup.get(gi);
    if (!cur || fl.levelId === reps[gi].rep.id) floorByGroup.set(gi, fl);
  }
  for (const [gi, fl] of floorByGroup) {
    const topY = gi * (floorH + gap);
    const botY = topY - slabThk;
    const outerPm = fl.outer.map((p) => ({ x: -(p.x - ox) * mPerPx, z: -(p.y - oy) * mPerPx }));
    if (outerPm.length < 3) continue;
    const holesPm = (fl.holes ?? [])
      .map((h) => h.map((p) => ({ x: -(p.x - ox) * mPerPx, z: -(p.y - oy) * mPerPx })))
      .filter((h) => h.length >= 3);
    for (let i = 0; i < outerPm.length; i++) {
      const a = outerPm[i];
      const b = outerPm[(i + 1) % outerPm.length];
      const quad = [
        project(a.x, a.z, botY),
        project(b.x, b.z, botY),
        project(b.x, b.z, topY),
        project(a.x, a.z, topY),
      ];
      const depth = (a.x + b.x + a.z + b.z) / 2 + botY * 0.01;
      faces.push({ pts: quad, fill: SLAB_SIDE_R, stroke: "rgba(0,0,0,0.4)", depth, sw: 0.4, kind: "side" });
    }
    const topPts = outerPm.map((p) => project(p.x, p.z, topY));
    const holesTop = holesPm.map((h) => h.map((p) => project(p.x, p.z, topY)));
    const avg = outerPm.reduce((s, p) => s + p.x + p.z, 0) / outerPm.length;
    faces.push({
      pts: topPts,
      holes: holesTop.length ? holesTop : undefined,
      fill: SLAB_TOP_R,
      stroke: "rgba(0,0,0,0.5)",
      depth: avg + topY * 0.01 - 0.001,
      sw: 0.5,
      kind: "top",
    });
  }

  const faceLayer = (k: Face["kind"]) => (k === "top" ? 1 : 2);
  faces.sort((a, b) => faceLayer(a.kind) - faceLayer(b.kind) || a.depth - b.depth);

  // viewBox dari faces + vlines
  let vx0 = Infinity, vy0 = Infinity, vx1 = -Infinity, vy1 = -Infinity;
  for (const f of faces) for (const p of f.pts) {
    if (p.x < vx0) vx0 = p.x; if (p.y < vy0) vy0 = p.y;
    if (p.x > vx1) vx1 = p.x; if (p.y > vy1) vy1 = p.y;
  }
  for (const vl of vlines) {
    const pa = project(vl.x, vl.z, vl.yLo);
    const pb = project(vl.x, vl.z, vl.yHi);
    for (const p of [pa, pb]) {
      if (p.x < vx0) vx0 = p.x; if (p.y < vy0) vy0 = p.y;
      if (p.x > vx1) vx1 = p.x; if (p.y > vy1) vy1 = p.y;
    }
  }
  if (!Number.isFinite(vx0)) { vx0 = -10; vy0 = -10; vx1 = 10; vy1 = 10; }
  const w = vx1 - vx0, h = vy1 - vy0;
  const pad = Math.max(w, h, 1) * 0.04;
  // Tambahan ruang kiri untuk label level agar tidak menumpuk gambar.
  const leftLabelPad = Math.max(w, h, 1) * 0.28;
  const vb = `${vx0 - pad - leftLabelPad} ${vy0 - pad} ${w + pad * 2 + leftLabelPad} ${h + pad * 2}`;
  const baseStroke = Math.max(w, h) * 0.0015;
  const fontPx = Math.max(w, h) * 0.014;

  // Label level di kiri tiap lantai (digeser keluar dari bounding gambar).
  type FloorLabel = { x: number; y: number; text: string };
  const floorLabels: FloorLabel[] = reps.map((g, idx) => {
    const yMid = idx * (floorH + gap) + floorH / 2;
    return {
      x: vx0 - pad - leftLabelPad * 0.05,
      y: project(0, 0, yMid).y,
      text: `Tipe ${idx + 1} · ${displayNames[g.rep.id] ?? g.rep.name}`,
    };
  });


  const COLOR_TANGGA = "#2563eb";
  const COLOR_LIFT = "#7f1d1d";
  const numR = fontPx * 0.9;

  return (
    <div style={{ display: "flex", gap: 20, width: "100%", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, border: "1px solid #ececec", background: "#fafafa", padding: 10, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", display: "block" }}>
          {faces.map((f, i) => {
            if (f.holes && f.holes.length) {
              const ring = (pts: { x: number; y: number }[]) =>
                `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ") + " Z";
              const d = [f.pts, ...f.holes].map(ring).join(" ");
              return (
                <path
                  key={i}
                  d={d}
                  fill={f.fill}
                  fillRule="evenodd"
                  stroke={f.stroke}
                  strokeWidth={baseStroke * f.sw * 2}
                  strokeLinejoin="round"
                />
              );
            }
            return (
              <polygon
                key={i}
                points={f.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={f.fill}
                stroke={f.stroke}
                strokeWidth={baseStroke * f.sw * 2}
                strokeLinejoin="round"
              />
            );
          })}
          {vlines.map((vl, i) => {
            const a = project(vl.x, vl.z, vl.yLo);
            const b = project(vl.x, vl.z, vl.yHi);
            const stroke = vl.kind === "tangga" ? COLOR_TANGGA : COLOR_LIFT;
            return (
              <line
                key={`vl-${i}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={stroke}
                strokeWidth={baseStroke * 0.9}
                strokeDasharray={`${baseStroke * 2.5} ${baseStroke * 2}`}
                strokeLinecap="round"
              />
            );
          })}
          {annos.map((a, i) => (
            <g key={`an-${i}`}>
              <circle cx={a.at.x} cy={a.at.y} r={numR} fill="#0a0a0a" stroke="#fff" strokeWidth={baseStroke * 0.6} />
              <text
                x={a.at.x}
                y={a.at.y}
                fontSize={numR * 1.25}
                fontFamily="var(--font-display, Sora, sans-serif)"
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
              >
                {a.num}
              </text>
            </g>
          ))}
          {floorLabels.map((fl, i) => (
            <text
              key={`fl-${i}`}
              x={fl.x}
              y={fl.y}
              fontSize={fontPx * 1.1}
              fontFamily="var(--font-display, Sora, sans-serif)"
              fontWeight={600}
              letterSpacing="0.04em"
              fill="#0a0a0a"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {fl.text.toUpperCase()}
            </text>
          ))}

        </svg>
      </div>

      {(() => {
        const totalNumbered = tipeRooms.reduce((s, r) => s + r.length, 0);
        const legendCols = totalNumbered > 24 ? 3 : totalNumbered > 10 ? 2 : 1;
        const panelWidth = legendCols === 3 ? 460 : legendCols === 2 ? 360 : 270;
        return (
          <div style={{ width: panelWidth, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "hidden" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: "#777", fontWeight: 600 }}>
              Legenda Ruang
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${legendCols}, minmax(0, 1fr))`, gap: 8, alignContent: "start" }}>
              {reps.map((g, idx) => {
                const repName = displayNames[g.rep.id] ?? g.rep.name;
                const memberNames = g.members.map((m) => displayNames[m.id] ?? m.name);
                const color = levelColor(idx, reps.length);
                const k = Math.max(1, Math.round(g.rep.typicalCount ?? 1));
                const rooms = tipeRooms[idx] ?? [];
                return (
                  <div key={g.rep.id} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, padding: "7px 9px", border: "1px solid #ececec", borderRadius: 3, background: "#fff", breakInside: "avoid" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 11, height: 11, background: color, border: "1px solid rgba(0,0,0,0.3)", flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>
                        Tipe {idx + 1} · {repName}
                      </span>
                    </div>
                    {(g.members.length > 1 || k > 1) && (
                      <div style={{ fontSize: 9.5, color: "#888", marginLeft: 17, lineHeight: 1.35 }}>
                        {g.members.length > 1 && <>mewakili {memberNames.join(", ")}</>}
                        {g.members.length > 1 && k > 1 && " · "}
                        {k > 1 && <>×{k} tipikal</>}
                      </div>
                    )}
                    {rooms.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: 17, marginTop: 2 }}>
                        {rooms.map((r) => (
                          <div key={r.num} style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 9.8, lineHeight: 1.3 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 16, height: 14, padding: "0 4px", background: "#0a0a0a", color: "#fff", borderRadius: 7, fontWeight: 700, fontSize: 8.8 }}>
                              {r.num}
                            </span>
                            <span style={{ color: "#222" }}>{r.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 9.5, color: "#444", paddingTop: 6, borderTop: "1px solid #ececec" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-block", width: 22, borderTop: `2px dashed ${COLOR_TANGGA}` }} />
                <span>Sirkulasi vertikal · Tangga</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-block", width: 22, borderTop: `2px dashed ${COLOR_LIFT}` }} />
                <span>Sirkulasi vertikal · Lift</span>
              </div>
            </div>
            <div style={{ fontSize: 9, color: "#999", letterSpacing: "0.18em", textTransform: "uppercase", lineHeight: 1.5 }}>
              Hanya ruang ≥ 50 m² yang diberi nomor · Level dengan layout berbeda.
            </div>
          </div>
        );
      })()}

    </div>
  );
}


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

// ---- Diffable global ----
// Bangun obstacle untuk satu level (mobil/parking aware).
function buildLevelObstacles(sketch: Sketch, levelId: string): ParkingObstacle[] {
  const pxPerM = 1 / sketchMetersPerSketchPx(sketch.scale);
  const mmRotRad = ((Number(sketch.mmGridRotation) || 0) * Math.PI) / 180;
  const levels = sketch.levels ?? [];
  const level = levels.find((l) => l.id === levelId);
  if (!level) return [];
  const layers = (sketch.layers ?? []).filter((l) => l.levelId === levelId);
  const lines = (sketch.lines ?? []).filter((l) => l.levelId === levelId);
  const obs: ParkingObstacle[] = [];
  const wallBuf = 0.075 * pxPerM;
  for (const ln of lines) {
    if ((ln.kind ?? "straight") !== "straight") continue;
    obs.push({ kind: "wall", a: ln.a, b: ln.b, bufferPx: wallBuf });
  }
  for (const ly of layers) {
    if (!Array.isArray(ly.points) || ly.points.length < 3) continue;
    if (isParkingName(ly.name)) continue;
    obs.push({ kind: "polygon", poly: ly.points });
  }
  for (const grid of collectGrids(sketch.structuralGrid, sketch.structuralGridExtras)) {
    if (grid.lineOnly || !levelInRange(grid, level, levels)) continue;
    const { spansX, spansY } = spansForLevel(grid, level.id);
    const xsM = axisPositions(spansX);
    const ysM = axisPositions(spansY);
    const halfCol = ((grid.colSizeCm / 100) * pxPerM) / 2;
    const rotRad = ((Number(grid.rotation) || 0) * Math.PI) / 180;
    const cs = Math.cos(rotRad), sn = Math.sin(rotRad);
    for (let j = 0; j < ysM.length; j++) {
      for (let i = 0; i < xsM.length; i++) {
        if (!isColumnVisible(grid, level.id, i, j, spansX, spansY)) continue;
        const lx = xsM[i] * pxPerM;
        const lyv = ysM[j] * pxPerM;
        const cx = grid.origin.x + lx * cs - lyv * sn;
        const cy = grid.origin.y + lx * sn + lyv * cs;
        const poly = [
          { x: -halfCol, y: -halfCol }, { x: halfCol, y: -halfCol },
          { x: halfCol, y: halfCol }, { x: -halfCol, y: halfCol },
        ].map((p) => ({ x: cx + p.x * cs - p.y * sn, y: cy + p.x * sn + p.y * cs }));
        obs.push({ kind: "polygon", poly });
      }
    }
  }
  const areasLv = (sketch.parkingAreas ?? []).filter((p) => p.levelId === levelId);
  obs.push(...parkingPathsToObstacles(areasLv, pxPerM, mmRotRad));
  return obs;
}

// Hitung set lot diffable efektif per area (manual + auto), identik dengan
// logika di sketch.tsx. Output: Map<areaId, Set<"row,col">>.
function computeDiffableEffective(sketch: Sketch): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const areas = (sketch.parkingAreas ?? []).filter((a) => (a.kind ?? "mobil") === "mobil");
  if (!areas.length) return out;
  const pxPerM = 1 / sketchMetersPerSketchPx(sketch.scale);
  const mmRotRad = ((Number(sketch.mmGridRotation) || 0) * Math.PI) / 180;
  const levels = sketch.levels ?? [];
  // Group per level
  const areasByLvl = new Map<string, ParkingArea[]>();
  for (const a of areas) {
    const lid = a.levelId ?? "";
    if (!lid) continue;
    const arr = areasByLvl.get(lid) ?? [];
    arr.push(a);
    areasByLvl.set(lid, arr);
  }
  // Pass-1 stalls (manual diffable only)
  const stallsByArea = new Map<string, ReturnType<typeof generateStalls>>();
  for (const [lid, lvAreas] of areasByLvl) {
    const obs = buildLevelObstacles(sketch, lid);
    for (const a of lvAreas) {
      const manual = new Set(a.diffable ?? []);
      stallsByArea.set(a.id, generateStalls(a, pxPerM, mmRotRad, obs, manual));
    }
  }
  const baseByLevel = new Map<string, number>();
  let baseTotal = 0;
  for (const [lid, lvAreas] of areasByLvl) {
    let n = 0;
    for (const a of lvAreas) {
      const ss = stallsByArea.get(a.id) ?? [];
      for (const s of ss) if (s.valid) n++;
    }
    baseByLevel.set(lid, n);
    baseTotal += n;
  }
  const diffableTotal = computeDiffableTotal(baseTotal);
  const lvlsAsc = [...areasByLvl.keys()]
    .map((id) => levels.find((l) => l.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x && (baseByLevel.get(x.id) ?? 0) > 0)
    .sort((a, b) => a.mdpl - b.mdpl)
    .map((l) => l.id);
  const targetByLevel = distributeDiffableAcrossLevels(lvlsAsc, diffableTotal);
  for (const [lid, lvAreas] of areasByLvl) {
    let need = Math.min(targetByLevel.get(lid) ?? 0, baseByLevel.get(lid) ?? 0);
    const pickedByArea = new Map<string, Set<string>>();
    for (const a of lvAreas) pickedByArea.set(a.id, new Set());
    if (need > 0) {
      const validKeysByArea = new Map<string, Set<string>>();
      const orderSlots: Array<{ areaId: string; key: string }> = [];
      for (const a of lvAreas) {
        const set = new Set<string>();
        const ss = stallsByArea.get(a.id) ?? [];
        for (const s of ss) {
          if (!s.valid) continue;
          const k = `${s.row},${s.col}`;
          set.add(k);
          orderSlots.push({ areaId: a.id, key: k });
        }
        validKeysByArea.set(a.id, set);
      }
      const seen = new Set<string>();
      for (const a of lvAreas) {
        const validSet = validKeysByArea.get(a.id) ?? new Set<string>();
        for (const k of a.diffable ?? []) {
          if (!validSet.has(k)) continue;
          const tag = `${a.id}|${k}`;
          if (seen.has(tag)) continue;
          seen.add(tag);
          if (need <= 0) break;
          pickedByArea.get(a.id)!.add(k);
          need--;
        }
        if (need <= 0) break;
      }
      for (const s of orderSlots) {
        if (need <= 0) break;
        const tag = `${s.areaId}|${s.key}`;
        if (seen.has(tag)) continue;
        seen.add(tag);
        pickedByArea.get(s.areaId)!.add(s.key);
        need--;
      }
    }
    for (const [aid, set] of pickedByArea) out.set(aid, set);
  }
  return out;
}

// ---- Rekap ----
function computeTotalParkingLots(sketch: Sketch): { mobil: number; motor: number; diffable: number } {
  const areas = sketch.parkingAreas ?? [];
  if (!areas.length) return { mobil: 0, motor: 0, diffable: 0 };
  const pxPerM = 1 / sketchMetersPerSketchPx(sketch.scale);
  const mmRotRad = ((Number(sketch.mmGridRotation) || 0) * Math.PI) / 180;
  const levels = sketch.levels ?? [];
  let mobil = 0;
  let motor = 0;
  let diffable = 0;
  const diffEff = computeDiffableEffective(sketch);
  for (const level of levels) {
    const areasLv = areas.filter((p) => p.levelId === level.id);
    if (!areasLv.length) continue;
    const obs = buildLevelObstacles(sketch, level.id);
    for (const area of areasLv) {
      const diffKeys = diffEff.get(area.id);
      const stalls = generateStalls(area, pxPerM, mmRotRad, obs, diffKeys);
      const validStalls = stalls.filter((s) => s.valid);
      if (area.kind === "motor") {
        motor += validStalls.length;
      } else {
        for (const s of validStalls) {
          if (diffKeys && diffKeys.has(`${s.row},${s.col}`)) diffable++;
          else mobil++;
        }
      }
    }
  }
  return { mobil, motor, diffable };
}

function RekapBody({ data, sketch }: { data: Stats; sketch: Sketch }) {
  const totalParking = computeTotalParkingLots(sketch);
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
      <GridStat label="Total Terhitung" value={`${fmt(data.totalTerhitungM2)} m²`} hint="tanpa Lahan, Void & Taman" />
      <GridStat label="Luas Efektif" value={`${fmt(data.totalEfektifM2)} m²`} />
      <GridStat label="Luas Semi" value={`${fmt(data.totalSetengahM2)} m²`} />
      <GridStat label="Luas Sarana" value={`${fmt(data.totalSaranaM2)} m²`} />
      <GridStat label="KLB Rencana" value={`${fmt(data.klbRencanaM2)} m²`} />
      {data.totalKolom > 0 && (
        <GridStat label="Modul Struktur" value={`${data.totalKolom} kolom`} hint={`Volume beton ${fmt(data.volumeBetonM3, 2)} m³`} />
      )}
      {totalParking.mobil > 0 && (
        <GridStat label="Total Lot Parkir Mobil" value={`${totalParking.mobil} mobil`} hint="lot reguler, akumulasi seluruh level" />
      )}
      {totalParking.diffable > 0 && (
        <GridStat label="Total Lot Diffable" value={`${totalParking.diffable} lot`} hint="akumulasi seluruh level" />
      )}
      {totalParking.motor > 0 && (
        <GridStat label="Total Lot Parkir Motor" value={`${totalParking.motor} motor`} hint="akumulasi seluruh level" />
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
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name));
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

// ---- Komposisi Ruang ----
const KOMPOSISI_PALETTE = [
  "#0a0a0a", "#e85d3a", "#1e3a8a", "#0f766e", "#b45309",
  "#7c3aed", "#be123c", "#0369a1", "#15803d", "#a16207",
  "#9333ea", "#dc2626", "#0891b2", "#65a30d", "#c2410c",
];

function normalizeRoomName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[._\-/()]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function roomGroupKey(name: string): { key: string; label: string } {
  const norm = normalizeRoomName(name);
  if (!norm) return { key: "lainnya", label: "Lainnya" };
  // Pengelompokan berdasarkan nama PERSIS (termasuk angka). Contoh:
  // "Unit 1 Htl" → satu kelompok; "Unit 2 Htl" → kelompok berbeda.
  const key = norm;
  const label = key
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { key, label };
}

type RoomGroup = {
  key: string;
  label: string;
  count: number;
  areaM2: number;
  perLevel: Record<string, number>; // levelId -> area (with typical mul)
  color: string;
};

function computeRoomGroups(sketch: Sketch): {
  groups: RoomGroup[];
  totalArea: number;
  totalCount: number;
} {
  const layers = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name));
  const levels = sketch.levels ?? [];
  const mul: Record<string, number> = {};
  for (const lv of levels) mul[lv.id] = Math.max(1, Math.round(lv.typicalCount ?? 1));
  const byKey = new Map<string, RoomGroup>();
  for (const l of layers) {
    const { key, label } = roomGroupKey(l.name);
    const k = (l.levelId && mul[l.levelId]) || 1;
    const a = (l.areaM2 || 0) * k;
    let g = byKey.get(key);
    if (!g) {
      g = { key, label, count: 0, areaM2: 0, perLevel: {}, color: "#000" };
      byKey.set(key, g);
    }
    g.count += k;
    g.areaM2 += a;
    if (l.levelId) g.perLevel[l.levelId] = (g.perLevel[l.levelId] || 0) + a;
  }
  const groups = [...byKey.values()].sort((a, b) => b.areaM2 - a.areaM2);
  groups.forEach((g, i) => { g.color = KOMPOSISI_PALETTE[i % KOMPOSISI_PALETTE.length]; });
  const totalArea = groups.reduce((s, g) => s + g.areaM2, 0);
  const totalCount = groups.reduce((s, g) => s + g.count, 0);
  return { groups, totalArea, totalCount };
}

function loadModel3DShot(sketchId: string): string | null {
  try {
    const raw = localStorage.getItem(`dabidabis_model3d_shots_${sketchId}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr[0]?.dataUrl) return arr[0].dataUrl as string;
    return null;
  } catch { return null; }
}

function KomposisiBody({ data: _data, sketch }: { data: Stats; sketch: Sketch }) {
  void _data;
  const { groups, totalArea, totalCount } = useMemo(() => computeRoomGroups(sketch), [sketch]);
  const [shot, setShot] = useState<string | null>(() => loadModel3DShot(sketch.id));
  useEffect(() => {
    setShot(loadModel3DShot(sketch.id));
    const onStorage = (e: StorageEvent) => {
      if (e.key === `dabidabis_model3d_shots_${sketch.id}`) setShot(loadModel3DShot(sketch.id));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [sketch.id]);

  const layers = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name));
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const displayNames = computeLevelDisplayNames(levels, sketch.layers ?? []);
  const mul: Record<string, number> = {};
  for (const lv of levels) mul[lv.id] = Math.max(1, Math.round(lv.typicalCount ?? 1));

  // Koefisien grouping
  const coefBuckets = [
    { key: "ef", label: "Efektif", coef: 1, color: "#0a0a0a" },
    { key: "se", label: "Semi", coef: 0.5, color: "#999999" },
    { key: "sa", label: "Sarana", coef: 0, color: "#dddddd" },
  ];
  const coefData = coefBuckets.map((b) => {
    const items = layers.filter((l) => (l.coefficient ?? 1) === b.coef);
    const area = items.reduce((s, l) => s + l.areaM2 * ((l.levelId && mul[l.levelId]) || 1), 0);
    return { ...b, count: items.reduce((s, l) => s + ((l.levelId && mul[l.levelId]) || 1), 0), area };
  });
  const coefTotal = coefData.reduce((s, b) => s + b.area, 0) || 1;

  // Tipikalitas grouping (by typicalCount)
  const tipMap = new Map<number, { count: number; area: number; levels: string[] }>();
  for (const lv of levels) {
    const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
    const area = layers.filter((l) => l.levelId === lv.id).reduce((s, l) => s + l.areaM2 * k, 0);
    const cnt = layers.filter((l) => l.levelId === lv.id).length * k;
    const e = tipMap.get(k) || { count: 0, area: 0, levels: [] };
    e.count += cnt; e.area += area; e.levels.push(displayNames[lv.id] ?? lv.name);
    tipMap.set(k, e);
  }
  const tipData = [...tipMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v], i) => ({
      key: `tip-${k}`, label: k > 1 ? `Tipikal ×${k}` : "Non-tipikal",
      count: v.count, area: v.area, color: KOMPOSISI_PALETTE[(i + 3) % KOMPOSISI_PALETTE.length],
      sub: v.levels.join(", "),
    }));
  const tipTotal = tipData.reduce((s, b) => s + b.area, 0) || 1;

  // Per-level distribution (use group colors for stacked bar by group)
  const perLevelTotals = levels.map((lv) => {
    const area = layers.filter((l) => l.levelId === lv.id).reduce(
      (s, l) => s + l.areaM2 * mul[lv.id],
      0,
    );
    return { lv, area, name: displayNames[lv.id] ?? lv.name };
  });
  const maxLevelArea = Math.max(1, ...perLevelTotals.map((p) => p.area));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1.1fr", gap: 18, width: "100%", height: "100%", minHeight: 0 }}>
      {/* Kiri: Aksonometri (besar) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        <Panel title="Aksonometri · Screenshot Model 3D">
          <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#f4f4f4", border: "1px solid #e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {shot ? (
              <img src={shot} alt="Aksonometri" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ fontSize: 12, color: "#888", textAlign: "center", padding: 24, lineHeight: 1.5 }}>
                Belum ada screenshot di halaman <strong>3D Model</strong>.<br />
                Ambil screenshot pertama untuk menampilkan aksonometri di sini.
              </div>
            )}
          </div>
        </Panel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flexShrink: 0 }}>
          <KStat label="Total Kelompok" value={`${groups.length}`} hint="kelompok ruang" />
          <KStat label="Total Item" value={`${totalCount}`} hint="termasuk tipikal" />
          <KStat label="Total Luas" value={`${fmt(totalArea)} m²`} hint="setelah pengali tipikal" />
          <KStat label="Lantai" value={`${levels.length}`} hint="level pada sketsa" />
        </div>
      </div>

      {/* Tengah: tiga donut/diagram bertumpuk */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        <Panel title="Tipe Koefisien">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Donut
              size={110} thickness={10}
              segments={coefData.map((b) => ({ value: (b.area / coefTotal) * 100, color: b.color }))}
              centerValue={`${coefData.length}`} centerLabel="tipe"
            />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
              {coefData.map((b) => (
                <KLegend key={b.key} color={b.color} label={b.label}
                  count={b.count} area={b.area} pct={(b.area / coefTotal) * 100} />
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Tipikalitas Lantai">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Donut
              size={110} thickness={10}
              segments={tipData.map((b) => ({ value: (b.area / tipTotal) * 100, color: b.color }))}
              centerValue={`${tipData.length}`} centerLabel="tipe"
            />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
              {tipData.map((b) => (
                <KLegend key={b.key} color={b.color} label={b.label}
                  count={b.count} area={b.area} pct={(b.area / tipTotal) * 100} />
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Distribusi per Lantai">
          <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
            {perLevelTotals.map(({ lv, area, name }) => {
              const pct = (area / maxLevelArea) * 100;
              return (
                <div key={lv.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    <span style={{ color: "#888", fontVariantNumeric: "tabular-nums" }}>{fmt(area)} m²</span>
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

      {/* Kanan: tabel pengelompokkan ruang */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Panel title="Pengelompokkan Ruang">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", minHeight: 0 }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Donut
                size={150} thickness={13}
                segments={groups.map((g) => ({ value: (g.areaM2 / (totalArea || 1)) * 100, color: g.color }))}
                centerValue={`${groups.length}`} centerLabel="kelompok"
              />
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead>
                  <tr style={{ background: "#fafafa", color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 8 }}>
                    <th style={kth}>Kelompok</th>
                    <th style={{ ...kth, textAlign: "right" }}>n</th>
                    <th style={{ ...kth, textAlign: "right" }}>m²</th>
                    <th style={{ ...kth, textAlign: "right" }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const pct = (g.areaM2 / (totalArea || 1)) * 100;
                    return (
                      <tr key={g.key} style={{ borderTop: "1px solid #eee" }}>
                        <td style={ktd}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 2, background: g.color, display: "inline-block" }} />
                            <span style={{ fontWeight: 600 }}>{g.label}</span>
                          </span>
                        </td>
                        <td style={{ ...ktd, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{g.count}</td>
                        <td style={{ ...ktd, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(g.areaM2)}</td>
                        <td style={{ ...ktd, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(pct, 1)}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: "1px solid #111", background: "#fafafa", fontWeight: 700 }}>
                    <td style={ktd}>Total</td>
                    <td style={{ ...ktd, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{totalCount}</td>
                    <td style={{ ...ktd, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(totalArea)}</td>
                    <td style={{ ...ktd, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>100</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

const kth: React.CSSProperties = { padding: "6px 8px", textAlign: "left", fontWeight: 700 };
const ktd: React.CSSProperties = { padding: "6px 8px", verticalAlign: "middle" };

function KStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ border: "1px solid #ececec", borderRadius: 4, background: "#fafafa", padding: 12 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "#888", fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display, Sora, sans-serif)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function KLegend({ color, label, count, area, pct }: { color: string; label: string; count: number; area: number; pct: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, lineHeight: 1.3 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, fontWeight: 600, color: "#333" }}>{label}</span>
      <span style={{ color: "#666", fontVariantNumeric: "tabular-nums", fontSize: 10 }}>
        {count} · {fmt(area, 0)} m² · {fmt(pct, 0)}%
      </span>
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
        <GridStat label="Total Luas Terhitung" value={`${fmt(data.totalTerhitungM2)} m²`} hint="tanpa Lahan, Void & Taman" />
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
  "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10, "1:1200": 12, "1:1500": 15, "1:2000": 20,
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
  E: { fill: "#7a1f1f", stroke: "#3a0d0d", label: "Timur", kind: "massif" },
  W: { fill: "#7a1f1f", stroke: "#3a0d0d", label: "Barat", kind: "massif" },
  N: { fill: "#7ec8e3", stroke: "#2a5e7a", label: "Utara", kind: "glaze" },
  S: { fill: "#7ec8e3", stroke: "#2a5e7a", label: "Selatan", kind: "glaze" },
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

  // Kumpulkan semua bidang, lalu render atap sebelum dinding agar sisi yang menghadap kamera tetap terlihat penuh.
  type Quad = { pts: { x: number; y: number }[]; depth: number; fill: string; stroke: string; sw: number; kind: "base" | "top" | "wall"; dir?: FacadeDir };
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
      kind: "base",
    });
  }

  for (const layer of buildLayers) {
    const own = expanded.filter((e) => e.sourceId === layer.levelId);
    if (own.length === 0) continue;
    const baseMdpl = Math.min(...own.map((e) => e.mdpl));
    const topMdplFloor = Math.max(...own.map((e) => e.mdpl + e.height));
    // Override: Atap/Balkon/Atap Hijau pakai tinggi & shift sesuai Model 3D.
    const ov = roomExtrudeOverride(layer.name);
    const minExp = Math.min(...expanded.map((e) => e.mdpl));
    const baseRel = (ov ? baseMdpl + ov.baseDelta : baseMdpl) - minExp;
    const topRel = (ov ? baseMdpl + ov.baseDelta + ov.height : topMdplFloor) - minExp;

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
        kind: "wall",
        dir,
      });
    }
    // Top face polygon (atap rata).
    const topPts = layer.points.map((p) => project(p.x, p.y, topRel));
    quads.push({
      pts: topPts,
      depth: avgDepthForPoints(layer.points, cx, cy),
      fill: "#3a3a3a",
      stroke: "#0a0a0a",
      sw: 1.4,
      kind: "top",
    });
  }

  // Slab lantai (entitas Floor) — 150mm di bawah MDPL level. Konsisten dgn Model 3D.
  {
    const slabThk = FLOOR_THICKNESS_MM / 1000;
    const minExp = expanded.length ? Math.min(...expanded.map((e) => e.mdpl)) : 0;
    for (const fl of sketch.floors ?? []) {
      const copies = expanded.filter((e) => e.sourceId === fl.levelId);
      if (!copies.length) continue;
      if (fl.outer.length < 3) continue;
      for (const cp of copies) {
        const topRel = cp.mdpl - minExp;
        const botRel = topRel - slabThk;
        for (let i = 0; i < fl.outer.length; i++) {
          const a = fl.outer[i];
          const b = fl.outer[(i + 1) % fl.outer.length];
          const p1 = project(a.x, a.y, botRel);
          const p2 = project(b.x, b.y, botRel);
          const p3 = project(b.x, b.y, topRel);
          const p4 = project(a.x, a.y, topRel);
          const mxv = (a.x + b.x) / 2 - cx;
          const myv = (a.y + b.y) / 2 - cy;
          quads.push({
            pts: [p1, p2, p3, p4],
            depth: mxv + myv + botRel * 0.01,
            fill: "#9c9c9c",
            stroke: "rgba(0,0,0,0.45)",
            sw: 1.0,
            kind: "wall",
          });
        }
        const topPts = fl.outer.map((p) => project(p.x, p.y, topRel));
        quads.push({
          pts: topPts,
          depth: avgDepthForPoints(fl.outer, cx, cy) + topRel * 0.01 - 0.001,
          fill: "#cfcfcf",
          stroke: "rgba(0,0,0,0.5)",
          sw: 1.0,
          kind: "top",
        });
      }
    }
  }



  const quadLayer = (kind: Quad["kind"]) => kind === "base" ? 0 : kind === "top" ? 1 : 2;
  quads.sort((a, b) => quadLayer(a.kind) - quadLayer(b.kind) || a.depth - b.depth);

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

      {/* Kanan: legenda + analisa WWR + rantai logika */}
      <div style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ border: "1px solid #111", padding: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700, marginBottom: 6 }}>
            Legenda Strategi Pasif
          </div>
          <LegendRow swatch="#7a1f1f" border="#3a0d0d"
            title="Dinding Masif (Massive Wall)"
            body="Timur & Barat ditutup masa solid memblokir radiasi pagi & sore." />
          <LegendRow swatch="#7ec8e3" border="#2a5e7a"
            title="Bukaan Kaca (Glazing)"
            body="Utara & Selatan untuk pencahayaan alami tak langsung." />
        </div>

        <WwrPanel sketch={sketch} />

        <div style={{ border: "1px solid #0a0a0a", background: "#0a0a0a", color: "#fff", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#e85d3a", fontWeight: 800 }}>
            Rantai Logika
          </div>
          <ChainStep n={1} body="Koordinat & rotasi peta menetapkan arah Utara nyata." />
          <ChainStep n={2} body="Normal tiap sisi poligon dievaluasi terhadap kompas." />
          <ChainStep n={3} body="E/W → masif. N/S → bukaan kaca dengan WWR terukur." />
        </div>
      </div>
    </div>
  );
}

function avgDepthForPoints(points: Point[], cx: number, cy: number): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + (p.x - cx) + (p.y - cy), 0) / points.length;
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

function WwrPanel({ sketch }: { sketch: Sketch }) {
  const northDeg = effectiveNorthDeg(sketch);
  const pxPerM = pxPerMeterFor(sketch.scale);
  const lat = sketch.geo?.lat ?? -6.2;
  const buildLayers = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name));

  // Total panjang fasad per arah (meter).
  const lenByDir: Record<FacadeDir, number> = { N: 0, S: 0, E: 0, W: 0 };
  for (const layer of buildLayers) {
    const ccw = polygonSignedArea(layer.points) > 0;
    for (let i = 0; i < layer.points.length; i++) {
      const a = layer.points[i];
      const b = layer.points[(i + 1) % layer.points.length];
      const n = outwardNormal(a, b, ccw);
      const dir = classifyBearing(bearingFromSketchVec(n.x, n.y, northDeg));
      lenByDir[dir] += Math.hypot(b.x - a.x, b.y - a.y) / pxPerM;
    }
  }

  // Rekomendasi WWR (SNI 6389:2020 & ASHRAE 90.1 dasar tropis lembap).
  // Untuk lintang selatan (Indonesia), Utara menerima radiasi lebih tinggi
  // sepanjang tahun → WWR lebih konservatif. Selatan paling teduh.
  const south = lat < 0;
  const wwr: Record<FacadeDir, { min: number; max: number; target: number; note: string }> = south
    ? {
        N: { min: 20, max: 35, target: 28, note: "Sun-path utama; pakai overhang 0.6 m" },
        S: { min: 40, max: 60, target: 50, note: "Paling teduh, fasad bukaan utama" },
        E: { min: 10, max: 20, target: 15, note: "Radiasi pagi tinggi; louvre vertikal" },
        W: { min: 8,  max: 15, target: 12, note: "Silau sore; secondary skin wajib" },
      }
    : {
        N: { min: 40, max: 60, target: 50, note: "Paling teduh, fasad bukaan utama" },
        S: { min: 20, max: 35, target: 28, note: "Sun-path utama; pakai overhang 0.6 m" },
        E: { min: 10, max: 20, target: 15, note: "Radiasi pagi tinggi; louvre vertikal" },
        W: { min: 8,  max: 15, target: 12, note: "Silau sore; secondary skin wajib" },
      };

  // Asumsi tinggi fasad efektif 3.6 m per lantai × jumlah lantai (heuristik).
  const levels = (sketch.levels ?? []).length || 1;
  const hFasad = 3.6 * Math.max(1, levels);

  const order: FacadeDir[] = ["N", "E", "S", "W"];
  const dirLabel: Record<FacadeDir, string> = { N: "Utara", S: "Selatan", E: "Timur", W: "Barat" };

  return (
    <div style={{ border: "1px solid #111", padding: 10, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#666", fontWeight: 700 }}>
          Rekomendasi WWR
        </div>
        <div style={{ fontSize: 10, color: "#888" }}>lat {lat.toFixed(2)}° · h≈{hFasad.toFixed(1)} m</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", columnGap: 8, rowGap: 6, fontSize: 11.5 }}>
        <div style={{ fontWeight: 800, color: "#666", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>Arah</div>
        <div style={{ fontWeight: 800, color: "#666", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>Catatan</div>
        <div style={{ fontWeight: 800, color: "#666", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "right" }}>WWR</div>
        <div style={{ fontWeight: 800, color: "#666", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "right" }}>Kaca m²</div>
        {order.map((d) => {
          const w = wwr[d];
          const L = lenByDir[d];
          const areaFasad = L * hFasad;
          const areaKaca = areaFasad * (w.target / 100);
          const isGlaze = d === "N" || d === "S";
          const accent = isGlaze ? "#2a5e7a" : "#7a1f1f";
          return (
            <Fragment key={d}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, background: accent, display: "inline-block", borderRadius: 2 }} />
                <span style={{ fontWeight: 800, color: "#0a0a0a" }}>{dirLabel[d]}</span>
              </div>
              <div style={{ color: "#444", fontSize: 11 }}>{w.note}</div>
              <div style={{ textAlign: "right", fontWeight: 700, color: accent, fontVariantNumeric: "tabular-nums" }}>
                {w.min}–{w.max}% <span style={{ color: "#888", fontWeight: 500 }}>· {w.target}%</span>
              </div>
              <div style={{ textAlign: "right", color: "#0a0a0a", fontVariantNumeric: "tabular-nums" }}>
                {areaKaca.toFixed(1)}
              </div>
            </Fragment>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 10.5, color: "#555", lineHeight: 1.4, borderTop: "1px dashed #ccc", paddingTop: 6 }}>
        Acuan: SNI 6389:2020 selubung bangunan tropis lembap. WWR rendah pada E/W menekan OTTV;
        WWR tinggi pada {south ? "Selatan" : "Utara"} memaksimalkan daylight tanpa beban termal puncak.
      </div>
    </div>
  );
}

// ---------- Master Plan Slide ----------
function MasterPlanBody({ plan, analysis }: { plan: import("@/lib/masterplan").MasterPlan; analysis: MasterplanAnalysis | null }) {
  if (analysis && (analysis.buildings.length > 0 || analysis.lahanPolygonsPx.length > 0)) {
    return <MasterPlanBodyFromSketch a={analysis} />;
  }
  return <MasterPlanBodyLegacy plan={plan} />;
}

// ---------- Ring infographic ----------
function RingStat({ pct, color, size = 78, label, value, sub }: {
  pct: number; color: string; size?: number; label: string; value: string; sub?: string;
}) {
  const p = Math.max(0, Math.min(100, pct));
  const r = (size / 2) - 6;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${(p / 100) * c} ${c}`} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fontSize={14} fontWeight={700} fill="#0f172a">
          {p.toFixed(0)}%
        </text>
      </svg>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#64748b", fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap" }}>{value}</div>
        {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ---------- Top-view helpers ----------
function computeViewport(a: MasterplanAnalysis, w: number, h: number, pad = 16) {
  const bx = a.boundsPx;
  const bw = Math.max(1, bx.maxX - bx.minX);
  const bh = Math.max(1, bx.maxY - bx.minY);
  const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = pad + ((w - pad * 2) - bw * s) / 2 - bx.minX * s;
  const oy = pad + ((h - pad * 2) - bh * s) / 2 - bx.minY * s;
  return { s, ox, oy };
}
function toPath(pts: { x: number; y: number }[], s: number, ox: number, oy: number): string {
  if (pts.length === 0) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${(p.x * s + ox).toFixed(1)},${(p.y * s + oy).toFixed(1)}`).join(" ") + " Z";
}

function TopView({ a, w, h, showLabels = true, showRoads = true, showLahan = true, numbered = false }: {
  a: MasterplanAnalysis; w: number; h: number; showLabels?: boolean; showRoads?: boolean; showLahan?: boolean; numbered?: boolean;
}) {
  const vp = computeViewport(a, w, h);
  return (
    <svg width={w} height={h} style={{ background: "#fff", border: "1px solid #e2e8f0", display: "block" }}>
      {/* Lahan */}
      {showLahan && a.lahanPolygonsPx.map((poly, i) => (
        <path key={`la-${i}`} d={toPath(poly, vp.s, vp.ox, vp.oy)} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" />
      ))}
      {/* Roads */}
      {showRoads && a.roadRingsPx.map((r, i) => (
        <g key={`r-${i}`}>
          <path d={toPath(r.outer, vp.s, vp.ox, vp.oy)} fill="#cbd5e1" stroke="#64748b" strokeWidth={0.6} fillRule="evenodd" />
          {r.holes.map((h, j) => (
            <path key={j} d={toPath(h, vp.s, vp.ox, vp.oy)} fill="#f8fafc" stroke="none" />
          ))}
        </g>
      ))}
      {/* Buildings (root + subs) */}
      {a.buildings.map((b, i) => {
        const cx = b.centroidPx.x * vp.s + vp.ox;
        const cy = b.centroidPx.y * vp.s + vp.oy;
        return (
          <g key={b.id}>
            <path d={toPath(b.polygonPx, vp.s, vp.ox, vp.oy)} fill={b.color} fillOpacity={0.75} stroke="#0f172a" strokeWidth={0.8} />
            {b.subMasses.map((s, k) => (
              <path key={k} d={toPath(s.polygonPx, vp.s, vp.ox, vp.oy)} fill={b.color} fillOpacity={0.45} stroke="#0f172a" strokeWidth={0.5} />
            ))}
            {showLabels && (
              numbered ? (
                <g>
                  <circle cx={cx} cy={cy} r={11} fill="#fff" stroke="#0f172a" strokeWidth={1.2} />
                  <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#0f172a">{i + 1}</text>
                </g>
              ) : (
                <text x={cx} y={cy + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#0f172a" style={{ textShadow: "0 0 3px #fff, 0 0 2px #fff" }}>
                  {b.name}
                </text>
              )
            )}
          </g>
        );
      })}
      {/* Compass */}
      <g transform={`translate(${w - 34},26)`}>
        <circle r={16} fill="#fff" stroke="#0f172a" />
        <text textAnchor="middle" y={4} fontSize={11} fontWeight={700} fill="#0f172a">U</text>
      </g>
    </svg>
  );
}

// ---------- New MasterPlan slide body sourced from the masterplan sketch ----------
function MasterPlanBodyFromSketch({ a }: { a: MasterplanAnalysis }) {
  const totalHardArea = a.totalFootprintM2 + a.totalRoadAreaM2;
  const kdbPct = a.kdbKawasanPct;
  const footprintPct = a.totalLahanM2 > 0 ? (a.totalFootprintM2 / a.totalLahanM2) * 100 : 0;
  const roadPct = a.totalLahanM2 > 0 ? (a.totalRoadAreaM2 / a.totalLahanM2) * 100 : 0;
  const gfaOfPlot = a.totalLahanM2 > 0 ? (a.totalGfaM2 / a.totalLahanM2) * 100 : 0;

  // Skyline (south elevation, +Y downward = south)
  const skyW = 1300, skyH = 300;
  const bx = a.boundsPx;
  const bw = Math.max(1, bx.maxX - bx.minX);
  const maxH = Math.max(12, ...a.buildings.map((b) => b.heightM));
  const sxSky = (skyW - 40) / bw;
  const sy = (skyH - 40) / maxH;
  // Draw far → near using centroid Y
  const orderedForSky = [...a.buildings].sort((p, q) => p.centroidPx.y - q.centroidPx.y);
  const groundY = skyH - 22;

  const totalBuildings = a.buildings.length;
  const totalBlok = totalBuildings + a.lahanPolygonsPx.length;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Ring stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <RingStat pct={100} color="#0f766e" label="Total Blok" value={String(totalBlok)} sub={`${a.buildings.length} bangunan · ${a.lahanPolygonsPx.length} area`} />
        <RingStat pct={100} color="#334155" label="Luas Tapak" value={`${(a.totalLahanM2 / 10000).toFixed(2)} ha`} sub={`${a.totalLahanM2.toFixed(0)} m² · ${a.lahanPolygonsPx.length} persil`} />
        <RingStat pct={kdbPct} color="#dc2626" label="KDB Kawasan" value={`${kdbPct.toFixed(1)}%`} sub={`${totalHardArea.toFixed(0)} m² terbangun+jalan`} />
        <RingStat pct={Math.min(100, gfaOfPlot)} color="#2563eb" label="Total GFA" value={`${a.totalGfaM2.toFixed(0)} m²`} sub={`${gfaOfPlot.toFixed(0)}% dari tapak`} />
      </div>

      {/* Footprint breakdown row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <RingStat pct={footprintPct} color="#f97316" label={`Footprint Bangunan (${totalBuildings})`} value={`${a.totalFootprintM2.toFixed(0)} m²`} sub={`${footprintPct.toFixed(1)}% dari tapak`} />
        <RingStat pct={roadPct} color="#64748b" label="Perkerasan/Jalan" value={`${a.totalRoadAreaM2.toFixed(0)} m²`} sub={`${roadPct.toFixed(1)}% dari tapak`} />
        <RingStat pct={kdbPct} color="#0f766e" label="Total Terbangun (KDB)" value={`${totalHardArea.toFixed(0)} m²`} sub={`${kdbPct.toFixed(1)}% (Footprint+Jalan)`} />
      </div>

      {/* Main grid: Top view + Skyline & buildings list */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, flex: 1, minHeight: 0 }}>
        {/* Top view */}
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Tata Letak Kawasan (Top View)</div>
          <TopView a={a} w={520} h={520} showLabels showRoads showLahan />
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {/* Skyline */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Skyline Kawasan (Tampak Selatan)</div>
            <svg width={skyW} height={skyH} style={{ background: "linear-gradient(to bottom, #fef9c3 0%, #ffedd5 60%, #fef3c7 100%)", border: "1px solid #e2e8f0", display: "block" }}>
              <rect x={0} y={groundY} width={skyW} height={skyH - groundY} fill="#475569" />
              <circle cx={skyW - 60} cy={40} r={18} fill="#fbbf24" opacity={0.85} />
              {orderedForSky.map((b, i) => {
                // Bounds of building footprint on X axis
                const xs = b.polygonPx.map((p) => p.x);
                const minPx = Math.min(...xs), maxPx = Math.max(...xs);
                const x = (minPx - bx.minX) * sxSky + 20;
                const w = Math.max(6, (maxPx - minPx) * sxSky);
                const h = b.heightM * sy;
                const y = groundY - h;
                // Depth attenuation (front buildings darker)
                const depth = 1 - (b.centroidPx.y - bx.minY) / Math.max(1, bx.maxY - bx.minY);
                const fade = 0.55 + 0.45 * depth;
                return (
                  <g key={b.id}>
                    <rect x={x} y={y} width={w} height={h} fill={b.color} opacity={fade} stroke="#0f172a" strokeWidth={0.6} />
                    {h > 26 && (
                      <text x={x + w / 2} y={y - 4} textAnchor="middle" fontSize={9} fill="#0f172a">
                        {b.heightM.toFixed(0)}m
                      </text>
                    )}
                    <rect x={x + w} y={groundY - 1} width={h * 0.35} height={2} fill="#0f172a" opacity={0.25} />
                    <text x={x + w / 2} y={groundY + 14} textAnchor="middle" fontSize={8} fill="#f8fafc">
                      #{i + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Per-building GFA rincian */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Rincian GFA per Bangunan</div>
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 4 }}>
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <thead style={{ background: "#f1f5f9", position: "sticky", top: 0 }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "5px 8px", width: 34 }}>#</th>
                    <th style={{ textAlign: "left", padding: "5px 8px" }}>Nama</th>
                    <th style={{ textAlign: "right", padding: "5px 8px" }}>Lantai Dasar (m²)</th>
                    <th style={{ textAlign: "right", padding: "5px 8px" }}>Lapis</th>
                    <th style={{ textAlign: "right", padding: "5px 8px" }}>GFA (m²)</th>
                    <th style={{ textAlign: "right", padding: "5px 8px" }}>% GFA</th>
                  </tr>
                </thead>
                <tbody>
                  {a.buildings.map((b, i) => {
                    const pct = a.totalGfaM2 > 0 ? (b.totalGfaM2 / a.totalGfaM2) * 100 : 0;
                    return (
                      <tr key={b.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "4px 8px", fontFamily: "monospace", color: "#64748b" }}>{i + 1}</td>
                        <td style={{ padding: "4px 8px", fontWeight: 500 }}>
                          <span style={{ display: "inline-block", width: 8, height: 8, background: b.color, borderRadius: 2, marginRight: 6 }} />
                          {b.name}
                        </td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{b.footprintM2.toFixed(2)}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{b.totalFloors}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{b.totalGfaM2.toFixed(2)}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace", color: "#2563eb" }}>{pct.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                    <td colSpan={2} style={{ padding: "5px 8px" }}>Total</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{a.totalFootprintM2.toFixed(2)}</td>
                    <td />
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{a.totalGfaM2.toFixed(2)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Siteplan slide ----------
function SiteplanBody({ analysis: a }: { analysis: MasterplanAnalysis }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1fr 340px", gap: 14 }}>
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Siteplan Kawasan · {a.title}</div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <TopView a={a} w={900} h={720} showLabels showRoads showLahan numbered />
        </div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>Skala referensi: {a.scale}</div>
      </div>
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Legenda</div>

        {/* Global legend swatches */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 14, background: "#f1f5f9", border: "1px dashed #94a3b8" }} />
            Area Persil (Lahan) · <b>{a.totalLahanM2.toFixed(2)} m²</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 14, background: "#cbd5e1", border: "1px solid #64748b" }} />
            Jalan · <b>{a.totalRoadAreaM2.toFixed(2)} m²</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 14, background: "#94a3b8", border: "1px solid #0f172a" }} />
            Bangunan · Total GFA <b>{a.totalGfaM2.toFixed(2)} m²</b>
          </div>
        </div>

        <div style={{ height: 1, background: "#e2e8f0" }} />
        <div style={{ fontSize: 12, fontWeight: 700 }}>Bangunan (Nomor · GFA)</div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 4, background: "#fff" }}>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <tbody>
              {a.buildings.map((b, i) => (
                <tr key={b.id} style={{ borderTop: i === 0 ? "none" : "1px solid #e2e8f0" }}>
                  <td style={{ padding: "5px 8px", width: 30 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 20, height: 20, borderRadius: 999, background: "#fff",
                      border: "1.2px solid #0f172a", fontSize: 10, fontWeight: 700,
                    }}>{i + 1}</span>
                  </td>
                  <td style={{ padding: "5px 8px" }}>
                    <div style={{ fontWeight: 600 }}>{b.name}</div>
                    <div style={{ fontSize: 9, color: "#64748b" }}>
                      {b.totalFloors} lapis · dasar {b.footprintM2.toFixed(2)} m²
                    </div>
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#2563eb" }}>
                    {b.totalGfaM2.toFixed(2)} m²
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 10, color: "#334155" }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 6, borderRadius: 4 }}>
            <div style={{ color: "#64748b" }}>Persil</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{a.totalLahanM2.toFixed(2)} m²</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 6, borderRadius: 4 }}>
            <div style={{ color: "#64748b" }}>Jalan</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{a.totalRoadAreaM2.toFixed(2)} m²</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 6, borderRadius: 4, gridColumn: "span 2" }}>
            <div style={{ color: "#64748b" }}>Total GFA</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{a.totalGfaM2.toFixed(2)} m²</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Legacy masterplan slide (fallback: MasterPlan model, no sketch analysis) ----------
function MasterPlanBodyLegacy({ plan }: { plan: import("@/lib/masterplan").MasterPlan }) {
  const { FUNCTION_META, totalsByFunction, blockGFA } = { FUNCTION_META: MP_FUNCTION_META, totalsByFunction: mpTotalsByFunction, blockGFA: mpBlockGFA };
  const totals = totalsByFunction(plan);
  const totalGFA = totals.komersial.gfa + totals.fasum.gfa + totals.rth.gfa;
  const totalFootprint = totals.komersial.footprint + totals.fasum.footprint + totals.rth.footprint;
  const skyW = 1300;
  const skyH = 380;
  const half = plan.siteSize / 2;
  const sx = skyW / plan.siteSize;
  const maxH = Math.max(20, ...plan.blocks.map((b) => b.height));
  const sy = (skyH - 30) / Math.max(maxH, 1);
  const ordered = [...plan.blocks].sort((a, b) => b.z - a.z);
  const planSize = 580;
  const ps = planSize / plan.siteSize;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KpiCard label="Total Blok" value={String(plan.blocks.length)} sub="massing" />
        <KpiCard label="Luas Tapak" value={`${(plan.siteSize * plan.siteSize / 10000).toFixed(2)} ha`} sub={`${plan.siteSize}×${plan.siteSize} m`} />
        <KpiCard label="Total Footprint" value={`${Math.round(totalFootprint).toLocaleString("id-ID")} m²`} sub={`${((totalFootprint / (plan.siteSize * plan.siteSize)) * 100).toFixed(1)}% KDB makro`} />
        <KpiCard label="Total GFA" value={`${Math.round(totalGFA).toLocaleString("id-ID")} m²`} sub="seluruh fungsi" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 20, flex: 1, minHeight: 0 }}>
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Tata Letak Kawasan (Top View)</div>
          <svg width={planSize} height={planSize} style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
            {plan.blocks.map((b) => {
              const m = FUNCTION_META[b.fn];
              const x = (b.x + half - b.w / 2) * ps;
              const y = (b.z + half - b.d / 2) * ps;
              return (
                <g key={b.id}>
                  <rect x={x} y={y} width={b.w * ps} height={b.d * ps} fill={m.color} fillOpacity={b.fn === "rth" ? 0.4 : 0.85} stroke="#0f172a" strokeWidth={0.7} />
                  <text x={x + (b.w * ps) / 2} y={y + (b.d * ps) / 2 + 3} textAnchor="middle" fontSize={9} fill="#fff" fontWeight={600}>
                    {b.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Skyline Kawasan (Tampak Selatan)</div>
            <svg width={skyW} height={skyH} style={{ background: "linear-gradient(to bottom, #fef9c3 0%, #ffedd5 50%, #fef3c7 100%)", border: "1px solid #e2e8f0", display: "block" }}>
              <rect x={0} y={skyH - 20} width={skyW} height={20} fill="#475569" />
              {ordered.map((b) => {
                const m = FUNCTION_META[b.fn];
                const x = (b.x + half - b.w / 2) * sx;
                const w = b.w * sx;
                const h = b.height * sy;
                const y = skyH - 20 - h;
                const depth = (b.z + half) / plan.siteSize;
                const fade = 0.45 + 0.55 * depth;
                return <rect key={b.id} x={x} y={y} width={w} height={h} fill={m.color} opacity={fade} stroke="#0f172a" strokeWidth={0.6} />;
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}



