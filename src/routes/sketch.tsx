import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Pencil,
  Trash2,
  Magnet,
  Ruler,
  Undo2,
  Redo2,
  Layers,
  Pencil as PencilIcon,
  Check,
  MapPin,
  Lock,
  LockOpen,
  ChevronDown,
  ChevronUp,
  Save,
  Plus,
  Maximize2,
  Minimize2,
  X,
  RotateCcw,
  Minus,
  Spline,
  PenTool,
  Square,
  Move,
  GripHorizontal,
  Copy,
  Waypoints,
  Scissors,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import polygonClipping from "polygon-clipping";
import { drawOsmTiles, nominatimSearch, type Geo, DEFAULT_GEO } from "@/lib/geo";

export const Route = createFileRoute("/sketch")({
  head: () => ({
    meta: [
      { title: "Sketsa Konseptual — Dabidabi's" },
      {
        name: "description",
        content:
          "Sketsa batas lahan presisi di kertas milimeter block digital. Multi-tab, skala 1:100 hingga 1:1000, snap to grid, dan rekapitulasi luas otomatis dalam m².",
      },
    ],
  }),
  component: SketchPage,
});

type Point = { x: number; y: number };
type LineKind = "straight" | "arc" | "bezier";
type Line = {
  a: Point;
  b: Point;
  kind?: LineKind;
  bulge?: number; // for arc: perpendicular sagitta (signed)
  c1?: Point; // for bezier: tangent control near a
  c2?: Point; // for bezier: tangent control near b
  levelId?: string;
};
type Scale = "1:100" | "1:200" | "1:500" | "1:1000";

type Layer = {
  id: string;
  name: string;
  points: Point[];
  areaM2: number;
  color: string;
  locked?: boolean;
  levelId?: string;
  coefficient?: number; // 1 | 0.5 | 0 — pengali luas efektif
  gsb?: number[]; // GSB offset (meter) per sisi, hanya untuk layer "lahan"
};

type Level = {
  id: string;
  name: string;
  mdpl: number;
  opacity: number; // 0..1 — opacity ketika level ini tidak aktif
  typicalCount?: number; // ≥1, jumlah lantai tipikal yang menggandakan luas + koefisien
  typicalHeight?: number; // m, tinggi tiap lantai tipikal (default TYPICAL_FLOOR_H)
};

// Tinggi default per lantai tipikal (m). Setiap tambahan tipikal menumpuk 3 m.
const TYPICAL_FLOOR_H = 3;
function tipicalHeightOf(lv: { typicalHeight?: number }): number {
  const h = Number(lv.typicalHeight);
  return Number.isFinite(h) && h > 0 ? h : TYPICAL_FLOOR_H;
}

// Hitung nama tampilan tiap level (Level N atau Level N–M) berdasarkan urutan MDPL
// dan jumlah tipikal di tiap level. Jika user sudah mengganti nama (tidak cocok pola
// "Level <angka>" / "Level <angka>-<angka>"), nama kustom tersebut dipertahankan.
function isAutoLevelName(name: string): boolean {
  return /^Level\s+\d+(?:\s*[-–]\s*\d+)?$/i.test(name.trim());
}
function computeLevelDisplayNames(levels: { id: string; name: string; mdpl: number; typicalCount?: number }[]): Record<string, string> {
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const out: Record<string, string> = {};
  let idx = 1;
  for (const lv of sorted) {
    const k = Math.max(1, lv.typicalCount ?? 1);
    const start = idx;
    const end = idx + k - 1;
    const auto = k > 1 ? `Level ${start}–${end}` : `Level ${start}`;
    out[lv.id] = isAutoLevelName(lv.name) ? auto : lv.name;
    idx = end + 1;
  }
  return out;
}

type SectionCut = {
  p1: Point;
  p2: Point;
  label?: string;
  updatedAt?: number;
};

// Label otomatis: A-A, B-B, ..., Z-Z, AA-AA, AB-AB, ...
function sectionLabelFor(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${s}-${s}`;
}
function nextSectionLabel(existing: SectionCut[]): string {
  const used = new Set(existing.map((c) => (c.label || "").toUpperCase()));
  for (let i = 0; i < 500; i++) {
    const lbl = sectionLabelFor(i);
    if (!used.has(lbl.toUpperCase())) return lbl;
  }
  return `X-${existing.length + 1}`;
}

type Sketch = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  scale: Scale;
  snap: boolean;
  lines: Line[];
  layers: Layer[];
  levels: Level[];
  activeLevelId: string | null;
  kdbPct?: number; // 0..100, prosentase KDB terhadap luas lahan
  klbCoef?: number; // koefisien KLB, pengali luas lahan
  fungsi?: string; // fungsi bangunan: Hotel, Apartment, Komersil, Rumah Sakit, Bandara, Bangunan Khusus
  northRotation?: number; // derajat rotasi arah utara, 0 = atas (CW positif)
  geo?: Geo; // koordinat lokasi (single source of truth peta/matahari/slide)
  sectionCut?: SectionCut; // legacy single cut (kompatibilitas)
  sectionCuts?: SectionCut[]; // Garis Potong A-A, B-B, ... (dinamis, men-trigger slide potongan)
};

type StoreShape = {
  sketches: Sketch[];
  openId: string | null;
};

const STORAGE_KEY = "dabidabis_sketch_v2";
const LEGACY_KEY = "dabidabis_sketch_v1";

const METERS_PER_MAJOR: Record<Scale, number> = {
  "1:100": 1,
  "1:200": 2,
  "1:500": 5,
  "1:1000": 10,
};
const MINOR_PX = 8;
const MAJOR_EVERY = 10;
const SNAP_TOL = MINOR_PX * 0.9;

const LAYER_COLORS = [
  "rgba(232, 93, 58, ALPHA)",
  "rgba(34, 197, 94, ALPHA)",
  "rgba(59, 130, 246, ALPHA)",
  "rgba(168, 85, 247, ALPHA)",
  "rgba(234, 179, 8, ALPHA)",
  "rgba(236, 72, 153, ALPHA)",
];

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function keyOf(p: Point) {
  return `${Math.round(p.x / SNAP_TOL)}_${Math.round(p.y / SNAP_TOL)}`;
}
function polygonAreaPx(pts: Point[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(s) / 2;
}
function pointInPolygon(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Convert points -> polygon-clipping ring (closed). Drop near-duplicate consecutive points.
function ptsToRing(pts: Point[]): [number, number][] {
  const ring: [number, number][] = [];
  for (const p of pts) {
    const last = ring[ring.length - 1];
    if (!last || Math.hypot(last[0] - p.x, last[1] - p.y) > 0.001) ring.push([p.x, p.y]);
  }
  if (ring.length >= 2) {
    const f = ring[0], l = ring[ring.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) > 0.001) ring.push([f[0], f[1]]);
  }
  return ring;
}
function ringToPts(ring: [number, number][]): Point[] {
  const out: Point[] = ring.map(([x, y]) => ({ x, y }));
  // remove last if it equals first (closing point)
  if (out.length >= 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 0.001) out.pop();
  }
  return out;
}

// Subtract `subtractor` polygon from `subject` polygon. Returns the largest
// resulting outer ring (holes are dropped). Returns null if nothing remains.
function subtractPolygon(subject: Point[], subtractor: Point[]): Point[] | null {
  if (subject.length < 3 || subtractor.length < 3) return subject;
  try {
    const result = polygonClipping.difference(
      [[ptsToRing(subject)]],
      [[ptsToRing(subtractor)]],
    );
    if (!result || result.length === 0) return null;
    // Pick the polygon with the largest outer ring area.
    let bestPts: Point[] | null = null;
    let bestArea = 0;
    for (const poly of result) {
      const outer = poly[0];
      if (!outer || outer.length < 4) continue;
      const pts = ringToPts(outer);
      const a = polygonAreaPx(pts);
      if (a > bestArea) {
        bestArea = a;
        bestPts = pts;
      }
    }
    return bestPts;
  } catch {
    return subject;
  }
}

function isLahanLayerName(n: string) {
  return n.trim().toLowerCase().startsWith("lahan");
}
function isVoidLayerName(n: string) {
  return n.trim().toLowerCase() === "void";
}

const DEFAULT_GSB_M = 4;
function getGsbMeters(layer: Layer, sideIndex: number): number {
  const v = layer.gsb?.[sideIndex];
  return Number.isFinite(v) && (v as number) >= 0 ? (v as number) : DEFAULT_GSB_M;
}
function inwardOffsetSegmentPx(
  pts: Point[],
  i: number,
  distPx: number,
): { a: Point; b: Point; mid: Point; nx: number; ny: number } {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len, ny = dx / len;
  const probe = { x: (a.x + b.x) / 2 + nx * 0.5, y: (a.y + b.y) / 2 + ny * 0.5 };
  if (!pointInPolygon(probe, pts)) { nx = -nx; ny = -ny; }
  return {
    a: { x: a.x + nx * distPx, y: a.y + ny * distPx },
    b: { x: b.x + nx * distPx, y: b.y + ny * distPx },
    mid: { x: (a.x + b.x) / 2 + nx * distPx, y: (a.y + b.y) / 2 + ny * distPx },
    nx, ny,
  };
}

function perpUnit(a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}
function defaultBulgePx(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y) / 5; // sagitta ~20% of chord
}
function arcControlPoint(ln: Line): Point {
  const mid = { x: (ln.a.x + ln.b.x) / 2, y: (ln.a.y + ln.b.y) / 2 };
  const n = perpUnit(ln.a, ln.b);
  const bulge = ln.bulge ?? 0;
  // Quadratic Bezier midpoint (t=0.5) sits at (a + 2C + b)/4.
  // To place that midpoint at mid + n*bulge, control C = 2*(mid + n*bulge) - (a+b)/2 = mid + 2*n*bulge.
  return { x: mid.x + 2 * n.x * bulge, y: mid.y + 2 * n.y * bulge };
}
function defaultBezierHandles(a: Point, b: Point): { c1: Point; c2: Point } {
  const n = perpUnit(a, b);
  const bulge = defaultBulgePx(a, b);
  return {
    c1: { x: a.x + (b.x - a.x) / 3 + n.x * bulge, y: a.y + (b.y - a.y) / 3 + n.y * bulge },
    c2: { x: b.x - (b.x - a.x) / 3 + n.x * bulge, y: b.y - (b.y - a.y) / 3 + n.y * bulge },
  };
}
function sampleLine(ln: Line, steps = 24): Point[] {
  const kind = ln.kind ?? "straight";
  if (kind === "straight") return [ln.a, ln.b];
  const out: Point[] = [];
  if (kind === "arc") {
    const C = arcControlPoint(ln);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      out.push({
        x: mt * mt * ln.a.x + 2 * mt * t * C.x + t * t * ln.b.x,
        y: mt * mt * ln.a.y + 2 * mt * t * C.y + t * t * ln.b.y,
      });
    }
  } else {
    const c1 = ln.c1 ?? ln.a;
    const c2 = ln.c2 ?? ln.b;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      out.push({
        x: mt * mt * mt * ln.a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * ln.b.x,
        y: mt * mt * mt * ln.a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * ln.b.y,
      });
    }
  }
  return out;
}
function lineLengthPx(ln: Line): number {
  if ((ln.kind ?? "straight") === "straight") return dist(ln.a, ln.b);
  const pts = sampleLine(ln, 32);
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}
function pointToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}
function projectOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function pointToLine(p: Point, ln: Line): number {
  if ((ln.kind ?? "straight") === "straight") return pointToSegment(p, ln.a, ln.b);
  const pts = sampleLine(ln, 20);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = pointToSegment(p, pts[i - 1], pts[i]);
    if (d < best) best = d;
  }
  return best;
}

function findCycleWithLine(lines: Line[], newLineIdx: number): Point[] | null {
  if (lines.length < 3) return null;
  const nodes = new Map<string, Point>();
  const adj = new Map<string, { to: string; lineIdx: number }[]>();
  const addNode = (p: Point) => {
    const k = keyOf(p);
    if (!nodes.has(k)) {
      nodes.set(k, p);
      adj.set(k, []);
    }
    return k;
  };
  lines.forEach((ln, i) => {
    const ka = addNode(ln.a);
    const kb = addNode(ln.b);
    if (ka === kb) return;
    adj.get(ka)!.push({ to: kb, lineIdx: i });
    adj.get(kb)!.push({ to: ka, lineIdx: i });
  });
  const newLine = lines[newLineIdx];
  const startK = keyOf(newLine.a);
  const goalK = keyOf(newLine.b);
  if (startK === goalK) return null;
  const prev = new Map<string, { from: string; lineIdx: number } | null>();
  prev.set(startK, null);
  const queue: string[] = [startK];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === goalK) break;
    for (const e of adj.get(cur) || []) {
      if (e.lineIdx === newLineIdx) continue;
      if (prev.has(e.to)) continue;
      prev.set(e.to, { from: cur, lineIdx: e.lineIdx });
      queue.push(e.to);
    }
  }
  if (!prev.has(goalK)) return null;

  // Reconstruct ordered edges start -> ... -> goal
  const edges: { lineIdx: number; from: string; to: string }[] = [];
  let cur: string | null = goalK;
  while (cur && cur !== startK) {
    const entry = prev.get(cur);
    if (!entry) return null;
    edges.push({ lineIdx: entry.lineIdx, from: entry.from, to: cur });
    cur = entry.from;
  }
  edges.reverse();
  // Closing edge: goal -> start via newLine
  edges.push({ lineIdx: newLineIdx, from: goalK, to: startK });
  if (edges.length < 3) return null;

  // Densify each edge using sampleLine in the correct direction.
  const points: Point[] = [];
  for (const e of edges) {
    const ln = lines[e.lineIdx];
    const reversed = keyOf(ln.a) !== e.from;
    const sampled = sampleLine(ln, 24);
    const seq = reversed ? sampled.slice().reverse() : sampled;
    for (let i = 0; i < seq.length - 1; i++) points.push(seq[i]);
  }
  return points;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function newSketch(idx: number): Sketch {
  const now = Date.now();
  const lvl: Level = {
    id: `LV${now}_${Math.random().toString(36).slice(2, 6)}`,
    name: "Level 1",
    mdpl: 0,
    opacity: 0.5,
  };
  return {
    id: `S${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: `Sketsa ${idx}`,
    createdAt: now,
    updatedAt: now,
    scale: "1:100",
    snap: true,
    lines: [],
    layers: [],
    levels: [lvl],
    activeLevelId: lvl.id,
  };
}

function normalizeSketch(s: any): Sketch {
  let levels: Level[] = Array.isArray(s?.levels)
    ? s.levels.map((lv: any) => ({
        id: String(lv.id),
        name: String(lv.name || "Level"),
        mdpl: Number.isFinite(Number(lv.mdpl)) ? Number(lv.mdpl) : 0,
        opacity: typeof lv.opacity === "number" ? Math.max(0, Math.min(1, lv.opacity)) : 0.5,
        typicalCount: Number.isFinite(Number(lv.typicalCount)) ? Math.max(1, Math.round(Number(lv.typicalCount))) : 1,
        typicalHeight: Number.isFinite(Number(lv.typicalHeight)) && Number(lv.typicalHeight) > 0 ? Number(lv.typicalHeight) : undefined,
      }))
    : [];
  let lines: Line[] = Array.isArray(s?.lines) ? s.lines : [];
  let layers: Layer[] = Array.isArray(s?.layers) ? s.layers : [];
  let activeLevelId: string | null = s?.activeLevelId ?? null;
  if (levels.length === 0) {
    const lvl: Level = {
      id: `LV${s?.id || Date.now()}_1`,
      name: "Level 1",
      mdpl: 0,
      opacity: 0.5,
    };
    levels = [lvl];
    activeLevelId = lvl.id;
    lines = lines.map((ln) => ({ ...ln, levelId: ln.levelId ?? lvl.id }));
    layers = layers.map((ly) => ({ ...ly, levelId: ly.levelId ?? lvl.id }));
  } else if (!activeLevelId || !levels.some((l) => l.id === activeLevelId)) {
    activeLevelId = levels[0].id;
  }
  // Assign any orphan line/layer to first level
  const fallback = levels[0].id;
  lines = lines.map((ln) => (ln.levelId && levels.some((l) => l.id === ln.levelId) ? ln : { ...ln, levelId: fallback }));
  layers = layers.map((ly) => {
    const base = ly.levelId && levels.some((l) => l.id === ly.levelId) ? ly : { ...ly, levelId: fallback };
    const c = typeof (base as any).coefficient === "number" ? (base as any).coefficient : 1;
    const coef = c === 0 || c === 0.5 || c === 1 ? c : 1;
    return { ...base, coefficient: coef };
  });
  return {
    id: s?.id,
    title: s?.title ?? "Sketsa",
    createdAt: s?.createdAt ?? Date.now(),
    updatedAt: s?.updatedAt ?? Date.now(),
    scale: s?.scale ?? "1:100",
    snap: s?.snap ?? true,
    lines,
    layers,
    levels,
    activeLevelId,
    kdbPct: Number.isFinite(Number(s?.kdbPct)) ? Math.max(0, Math.min(100, Number(s.kdbPct))) : undefined,
    klbCoef: Number.isFinite(Number(s?.klbCoef)) ? Math.max(0, Number(s.klbCoef)) : undefined,
    fungsi: typeof s?.fungsi === "string" ? s.fungsi : undefined,
    northRotation: Number.isFinite(Number(s?.northRotation)) ? Number(s.northRotation) : 0,
    geo: s?.geo && Number.isFinite(Number(s.geo.lat)) && Number.isFinite(Number(s.geo.lon))
      ? {
          lat: Number(s.geo.lat),
          lon: Number(s.geo.lon),
          locked: Boolean(s.geo.locked),
          mapOpacity: Number.isFinite(Number(s.geo.mapOpacity)) ? Math.max(0, Math.min(1, Number(s.geo.mapOpacity))) : 0.55,
          mapRotation: Number.isFinite(Number(s.geo.mapRotation)) ? Number(s.geo.mapRotation) : 0,
          label: typeof s.geo.label === "string" ? s.geo.label : "",
        }
      : undefined,
    sectionCuts: (() => {
      const valid = (c: any): SectionCut | null => {
        if (!c || !c.p1 || !c.p2) return null;
        if (!Number.isFinite(Number(c.p1.x)) || !Number.isFinite(Number(c.p1.y))) return null;
        if (!Number.isFinite(Number(c.p2.x)) || !Number.isFinite(Number(c.p2.y))) return null;
        return {
          p1: { x: Number(c.p1.x), y: Number(c.p1.y) },
          p2: { x: Number(c.p2.x), y: Number(c.p2.y) },
          label: typeof c.label === "string" && c.label.trim() ? c.label : "A-A",
          updatedAt: Number.isFinite(Number(c.updatedAt)) ? Number(c.updatedAt) : Date.now(),
        };
      };
      const arr: SectionCut[] = [];
      if (Array.isArray(s?.sectionCuts)) {
        for (const c of s.sectionCuts) { const v = valid(c); if (v) arr.push(v); }
      }
      // migrasi legacy: single sectionCut → array
      if (arr.length === 0) {
        const v = valid(s?.sectionCut);
        if (v) arr.push(v);
      }
      // pastikan label unik & berurutan jika duplikat/kosong
      const seen = new Set<string>();
      return arr.map((c, i) => {
        let lbl = (c.label || "").trim() || sectionLabelFor(i);
        const key = lbl.toUpperCase();
        if (seen.has(key)) lbl = sectionLabelFor(i);
        seen.add(lbl.toUpperCase());
        return { ...c, label: lbl };
      });
    })(),
    sectionCut: undefined,
  };
}

function SketchPage() {
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as StoreShape;
        if (s && Array.isArray(s.sketches)) {
          const normalized = s.sketches.map((x) => normalizeSketch(x));
          setSketches(normalized);
          setOpenId(s.openId ?? normalized[0]?.id ?? null);
          setLoaded(true);
          return;
        }
      }
      // Migrate legacy single-sketch
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const ls = JSON.parse(legacy);
        const migrated = normalizeSketch({
          id: `S${Date.now()}`,
          title: ls.title ?? "Sketsa 1",
          createdAt: ls.createdAt ?? Date.now(),
          updatedAt: ls.updatedAt ?? Date.now(),
          scale: ls.scale ?? "1:100",
          snap: ls.snap ?? true,
          lines: Array.isArray(ls.lines) ? ls.lines : [],
          layers: Array.isArray(ls.layers) ? ls.layers : [],
        });
        setSketches([migrated]);
        setOpenId(migrated.id);
      } else {
        const first = newSketch(1);
        setSketches([first]);
        setOpenId(first.id);
      }
    } catch {
      const first = newSketch(1);
      setSketches([first]);
      setOpenId(first.id);
    }
    setLoaded(true);
  }, []);

  // Save
  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sketches, openId } as StoreShape));
      } catch {
        // ignore
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [sketches, openId, loaded]);

  const updateSketch = useCallback((id: string, patch: Partial<Sketch>) => {
    setSketches((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)),
    );
  }, []);

  const openSketch = useCallback((id: string) => {
    setOpenId(id);
  }, []);

  const minimizeSketch = useCallback((id: string) => {
    setOpenId((cur) => (cur === id ? null : cur));
    setFullscreenId((cur) => (cur === id ? null : cur));
  }, []);

  const addSketch = () => {
    const next = newSketch(sketches.length + 1);
    setSketches((prev) => [...prev, next]);
    setOpenId(next.id);
    toast.success(`${next.title} ditambahkan`);
  };

  const deleteSketch = (id: string) => {
    setSketches((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const first = newSketch(1);
        setOpenId(first.id);
        return [first];
      }
      if (openId === id) setOpenId(next[0].id);
      return next;
    });
    setFullscreenId((cur) => (cur === id ? null : cur));
    setConfirmDeleteId(null);
    toast.success("Sketsa dihapus");
  };

  const fullscreenSketch = fullscreenId ? sketches.find((s) => s.id === fullscreenId) : null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Sketsa Konseptual
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Kertas milimeter block digital — multi-tab, tersimpan otomatis di perangkat ini.
        </p>
      </div>

      <div className="space-y-4">
        {sketches.map((s) => (
          <SketchCard
            key={s.id}
            sketch={s}
            isOpen={openId === s.id && fullscreenId !== s.id}
            isFullscreen={false}
            onOpen={() => openSketch(s.id)}
            onMinimize={() => minimizeSketch(s.id)}
            onChange={(patch) => updateSketch(s.id, patch)}
            onRequestDelete={() => setConfirmDeleteId(s.id)}
            onEnterFullscreen={() => {
              setOpenId(s.id);
              setFullscreenId(s.id);
            }}
            onExitFullscreen={() => setFullscreenId(null)}
          />
        ))}

        <button
          onClick={addSketch}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/60 bg-surface/30 px-4 py-5 text-sm font-medium text-muted-foreground transition hover:border-ember/60 hover:bg-ember/5 hover:text-ember"
        >
          <Plus className="h-4 w-4" /> Tambah Sketsa
        </button>
      </div>

      {fullscreenSketch && (
        <FullscreenSketch
          sketch={fullscreenSketch}
          onChange={(patch) => updateSketch(fullscreenSketch.id, patch)}
          onExit={() => setFullscreenId(null)}
        />
      )}

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(v) => !v && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus sketsa ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Sketsa "{sketches.find((s) => s.id === confirmDeleteId)?.title}" beserta seluruh garis
              dan layer akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteId && deleteSketch(confirmDeleteId)}
              className="bg-ember text-white hover:bg-ember/90"
            >
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

// ============================================================
// SketchCard — single sketch with header + (optional) canvas
// ============================================================

type SketchCardProps = {
  sketch: Sketch;
  isOpen: boolean;
  isFullscreen: boolean;
  onOpen: () => void;
  onMinimize: () => void;
  onChange: (patch: Partial<Sketch>) => void;
  onRequestDelete: () => void;
  onEnterFullscreen: () => void;
  onExitFullscreen: () => void;
};

function SketchCard(props: SketchCardProps) {
  const { sketch, isOpen, onOpen, onMinimize, onChange, onRequestDelete, onEnterFullscreen } = props;
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(sketch.title);

  const isLahanName = (n: string) => n.trim().toLowerCase().startsWith("lahan");
  const lahanLayers = sketch.layers.filter((l) => isLahanName(l.name));
  const totalAreaM2 = sketch.layers.reduce((s, l) => s + l.areaM2, 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-surface/40 shadow-soft">
      {/* Title bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 bg-surface/60 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            onClick={isOpen ? onMinimize : onOpen}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground transition hover:text-foreground"
            aria-label={isOpen ? "Minimize" : "Buka"}
            title={isOpen ? "Minimize" : "Buka sketsa"}
          >
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  onChange({ title: titleDraft.trim() || "Sketsa Tanpa Judul" });
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onChange({ title: titleDraft.trim() || "Sketsa Tanpa Judul" });
                    setEditingTitle(false);
                  }
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="h-8 font-display text-base font-semibold"
              />
            ) : (
              <button
                onClick={() => {
                  if (!isOpen) onOpen();
                  setTitleDraft(sketch.title);
                  setEditingTitle(true);
                }}
                className="group flex min-w-0 items-center gap-2 text-left"
                title="Klik untuk ganti judul"
              >
                <span className="truncate font-display text-lg font-semibold">{sketch.title}</span>
                <PencilIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
              </button>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>Mulai: {formatDate(sketch.createdAt)}</span>
              <span>•</span>
              <span>Diedit: {formatDate(sketch.updatedAt)}</span>
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <Save className="h-3 w-3" /> tersimpan otomatis
              </span>
              {!isOpen && (
                <>
                  <span>•</span>
                  <span>
                    {sketch.layers.length} ruang · {lahanLayers.length} lahan ·{" "}
                    {totalAreaM2.toFixed(2)} m²
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isOpen && (
            <Button
              variant="outline"
              size="sm"
              onClick={onEnterFullscreen}
              title="Mode layar penuh"
            >
              <Maximize2 className="mr-1.5 h-4 w-4" /> Full
            </Button>
          )}
          {!isOpen && (
            <Button variant="outline" size="sm" onClick={onOpen}>
              Buka
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRequestDelete}
            className="border-ember/40 text-ember hover:bg-ember/10 hover:text-ember"
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Hapus
          </Button>
        </div>
      </div>

      {isOpen && <SketchEditor sketch={sketch} onChange={onChange} fullscreen={false} />}
    </section>
  );
}

// ============================================================
// FullscreenSketch — overlay mode
// ============================================================

function FullscreenSketch({
  sketch,
  onChange,
  onExit,
}: {
  sketch: Sketch;
  onChange: (patch: Partial<Sketch>) => void;
  onExit: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <SketchEditor sketch={sketch} onChange={onChange} fullscreen onExitFullscreen={onExit} />
    </div>
  );
}

// ============================================================
// SketchEditor — drawing surface + side panel
// ============================================================

function CompassMarker({ rotation, size = 64 }: { rotation: number; size?: number }) {
  const r = ((rotation % 360) + 360) % 360;
  return (
    <div
      style={{
        width: size,
        height: size,
        transform: `rotate(${r}deg)`,
        transition: "transform 120ms ease-out",
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block" }}>
        <circle cx="50" cy="50" r="46" fill="rgba(255,255,255,0.92)" stroke="#0a0a0a" strokeWidth="2" />
        <circle cx="50" cy="50" r="2.5" fill="#0a0a0a" />
        {/* North arrow */}
        <polygon points="50,8 42,52 50,46 58,52" fill="#e85d3a" stroke="#0a0a0a" strokeWidth="1.5" strokeLinejoin="round" />
        {/* South tail */}
        <polygon points="50,92 44,54 50,58 56,54" fill="#ffffff" stroke="#0a0a0a" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Cardinal labels */}
        <text x="50" y="22" textAnchor="middle" fontSize="14" fontWeight="800" fill="#0a0a0a" fontFamily="Sora, sans-serif">U</text>
        <text x="50" y="86" textAnchor="middle" fontSize="9" fontWeight="700" fill="#555" fontFamily="Sora, sans-serif">S</text>
        <text x="84" y="54" textAnchor="middle" fontSize="9" fontWeight="700" fill="#555" fontFamily="Sora, sans-serif">T</text>
        <text x="16" y="54" textAnchor="middle" fontSize="9" fontWeight="700" fill="#555" fontFamily="Sora, sans-serif">B</text>
      </svg>
    </div>
  );
}

function GeoPanel({
  geo,
  onChange,
}: {
  geo: Geo | undefined;
  onChange: (g: Geo | undefined) => void;
}) {
  const g = geo ?? DEFAULT_GEO;
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const setG = (patch: Partial<Geo>) => onChange({ ...g, ...patch });
  const doSearch = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await nominatimSearch(q.trim(), 6);
      setHits(res);
      if (!res.length) toast.info("Lokasi tidak ditemukan.");
    } catch {
      toast.error("Gagal mencari lokasi (OSM Nominatim).");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Lokasi (Peta OSM)</Label>
      <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2.5">
        <div className="flex gap-1.5">
          <Input
            placeholder="Cari nama wilayah / alamat"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
            className="h-8 text-sm"
          />
          <Button size="sm" variant="outline" className="h-8 px-2" onClick={doSearch} disabled={busy}>
            {busy ? "…" : "Cari"}
          </Button>
        </div>
        {hits.length > 0 && (
          <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border/60 bg-background/60 p-1">
            {hits.map((h, i) => (
              <button
                key={i}
                type="button"
                className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] hover:bg-muted"
                onClick={() => {
                  setG({ lat: parseFloat(h.lat), lon: parseFloat(h.lon), label: h.display_name, locked: true });
                  setHits([]);
                  setQ("");
                  toast.success("Lokasi dikunci ke koordinat OSM.");
                }}
                title={h.display_name}
              >
                {h.display_name}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Latitude</Label>
            <Input
              type="number"
              step="0.000001"
              value={g.lat}
              onChange={(e) => setG({ lat: parseFloat(e.target.value) || 0 })}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Longitude</Label>
            <Input
              type="number"
              step="0.000001"
              value={g.lon}
              onChange={(e) => setG({ lon: parseFloat(e.target.value) || 0 })}
              className="h-8 text-sm"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant={g.locked ? "default" : "outline"}
            className={cn("h-7 flex-1 text-[11px]", g.locked && "bg-gradient-ember shadow-ember")}
            onClick={() => setG({ locked: !g.locked })}
          >
            {g.locked ? <><Lock className="mr-1 h-3 w-3" /> Terkunci</> : <><LockOpen className="mr-1 h-3 w-3" /> Kunci koordinat</>}
          </Button>
          {geo && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onChange(undefined)}>
              <X className="mr-1 h-3 w-3" /> Hapus
            </Button>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Opacity peta</span>
            <span className="font-medium text-foreground">{Math.round(g.mapOpacity * 100)}%</span>
          </div>
          <Slider
            value={[Math.round(g.mapOpacity * 100)]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => setG({ mapOpacity: (v[0] ?? 0) / 100 })}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Rotasi peta</span>
            <span className="font-medium text-foreground">{Math.round(((Number(g.mapRotation) || 0) % 360 + 360) % 360)}°</span>
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={Number(g.mapRotation) || 0}
              onChange={(e) => setG({ mapRotation: Number(e.target.value) || 0 })}
              className="h-7 w-16 text-xs"
              step={1}
            />
            <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]"
              onClick={() => setG({ mapRotation: (Number(g.mapRotation) || 0) - 15 })}>−15°</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]"
              onClick={() => setG({ mapRotation: 0 })}>0°</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]"
              onClick={() => setG({ mapRotation: (Number(g.mapRotation) || 0) + 15 })}>+15°</Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Hanya merotasi peta. Skala & grid milimeter block tidak berubah.
          </p>
        </div>
        {g.label && (
          <p className="truncate text-[10px] text-muted-foreground" title={g.label}>
            {g.label}
          </p>
        )}
        <p className="text-[10px] leading-snug text-muted-foreground">
          Skala kanvas = meter riil. Grid milimeter block berfungsi sebagai meter di atas peta OSM. Origin peta = titik (0,0) kanvas.
        </p>
      </div>
    </div>
  );
}

type EditorProps = {
  sketch: Sketch;
  onChange: (patch: Partial<Sketch>) => void;
  fullscreen: boolean;
  onExitFullscreen?: () => void;
};

function SketchEditor({ sketch, onChange, fullscreen, onExitFullscreen }: EditorProps) {
  const { id, scale, snap, lines, layers, levels, activeLevelId, kdbPct, klbCoef, fungsi } = sketch;
  const northRotation = Number.isFinite(Number(sketch.northRotation)) ? Number(sketch.northRotation) : 0;
  const activeLvlId = activeLevelId ?? levels[0]?.id ?? null;
  const [rekapMinimized, setRekapMinimized] = useState(false);
  const [sideMinimized, setSideMinimized] = useState(false);
  const [sideOffset, setSideOffset] = useState({ x: 0, y: 0 });
  const [rekapOffset, setRekapOffset] = useState({ x: 0, y: 0 });
  const [rekapBtnOffset, setRekapBtnOffset] = useState({ x: 0, y: 0 });

  const sideDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const rekapDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const rekapBtnDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const makeDragHandlers = (
    ref: React.MutableRefObject<{ sx: number; sy: number; ox: number; oy: number } | null>,
    getOffset: () => { x: number; y: number },
    setOffset: (v: { x: number; y: number }) => void,
  ) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const o = getOffset();
      ref.current = { sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = ref.current;
      if (!s) return;
      setOffset({ x: s.ox + e.clientX - s.sx, y: s.oy + e.clientY - s.sy });
    },
    onPointerUp: (e: React.PointerEvent) => {
      ref.current = null;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    },
    onPointerCancel: () => { ref.current = null; },
  });

  const sideDragHandlers = makeDragHandlers(sideDragRef, () => sideOffset, setSideOffset);
  const rekapDragHandlers = makeDragHandlers(rekapDragRef, () => rekapOffset, setRekapOffset);
  const rekapBtnDragHandlers = makeDragHandlers(rekapBtnDragRef, () => rekapBtnOffset, setRekapBtnOffset);

  // Level management helpers
  const ensureLevels = useCallback((): { levels: Level[]; activeId: string } => {
    if (levels.length > 0 && activeLvlId) {
      return { levels, activeId: activeLvlId };
    }
    if (levels.length > 0) {
      return { levels, activeId: levels[0].id };
    }
    const lvl: Level = {
      id: `LV${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: "Level 1",
      mdpl: 0,
      opacity: 0.5,
    };
    return { levels: [lvl], activeId: lvl.id };
  }, [levels, activeLvlId]);

  const setActiveLevel = useCallback(
    (lvlId: string) => onChange({ activeLevelId: lvlId }),
    [onChange],
  );

  const addLevel = useCallback(() => {
    const maxMdpl = levels.reduce((m, l) => Math.max(m, l.mdpl), 0);
    const lvl: Level = {
      id: `LV${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `Level ${levels.length + 1}`,
      mdpl: Math.round((maxMdpl + 3) * 100) / 100,
      opacity: 0.5,
    };
    onChange({ levels: [...levels, lvl], activeLevelId: lvl.id });
    toast.success(`${lvl.name} ditambahkan`);
  }, [levels, onChange]);

  const renameLevel = useCallback(
    (lvlId: string, name: string) => {
      onChange({
        levels: levels.map((l) =>
          l.id === lvlId ? { ...l, name: name.trim() || l.name } : l,
        ),
      });
    },
    [levels, onChange],
  );

  const updateLevelMdpl = useCallback(
    (lvlId: string, mdpl: number) => {
      onChange({
        levels: levels.map((l) => (l.id === lvlId ? { ...l, mdpl } : l)),
      });
    },
    [levels, onChange],
  );

  const updateLevelOpacity = useCallback(
    (lvlId: string, opacity: number) => {
      onChange({
        levels: levels.map((l) =>
          l.id === lvlId ? { ...l, opacity: Math.max(0, Math.min(1, opacity)) } : l,
        ),
      });
    },
    [levels, onChange],
  );

  const deleteLevel = useCallback(
    (lvlId: string) => {
      if (levels.length <= 1) {
        toast.error("Minimal harus ada satu level");
        return;
      }
      const remaining = levels.filter((l) => l.id !== lvlId);
      const fallback = remaining[0].id;
      onChange({
        levels: remaining,
        activeLevelId: activeLvlId === lvlId ? fallback : activeLvlId,
        lines: lines.filter((ln) => ln.levelId !== lvlId),
        layers: layers.filter((ly) => ly.levelId !== lvlId),
      });
      toast.success("Level dihapus");
    },
    [levels, lines, layers, activeLvlId, onChange],
  );

  const duplicateLevel = useCallback(
    (lvlId: string) => {
      const src = levels.find((l) => l.id === lvlId);
      if (!src) return;
      const maxMdpl = levels.reduce((m, l) => Math.max(m, l.mdpl), 0);
      const newId = `LV${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newLvl: Level = {
        id: newId,
        name: `Level ${levels.length + 1}`,
        mdpl: Math.round((maxMdpl + TYPICAL_FLOOR_H) * 100) / 100,
        opacity: src.opacity,
        typicalCount: 1,
      };
      const idMap = new Map<string, string>();
      const newLayers: Layer[] = layers
        .filter((ly) => ly.levelId === lvlId)
        .map((ly) => {
          const nid = `L${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          idMap.set(ly.id, nid);
          return { ...ly, id: nid, levelId: newId, points: ly.points.map((p) => ({ ...p })) };
        });
      const newLines: Line[] = lines
        .filter((ln) => ln.levelId === lvlId)
        .map((ln) => ({ ...ln, a: { ...ln.a }, b: { ...ln.b }, c1: ln.c1 ? { ...ln.c1 } : undefined, c2: ln.c2 ? { ...ln.c2 } : undefined, levelId: newId }));
      onChange({
        levels: [...levels, newLvl],
        layers: [...layers, ...newLayers],
        lines: [...lines, ...newLines],
        activeLevelId: newId,
      });
      toast.success(`${newLvl.name} hasil duplikat`);
    },
    [levels, layers, lines, onChange],
  );

  const setLevelTypical = useCallback(
    (lvlId: string, count: number) => {
      const k = Math.max(1, Math.min(99, Math.round(count)));
      onChange({
        levels: levels.map((l) => (l.id === lvlId ? { ...l, typicalCount: k } : l)),
      });
    },
    [levels, onChange],
  );

  const setLevelTypicalHeight = useCallback(
    (lvlId: string, meters: number) => {
      if (!Number.isFinite(meters) || meters <= 0) return;
      const h = Math.round(Math.max(0.1, Math.min(99, meters)) * 100) / 100;
      onChange({
        levels: levels.map((l) => (l.id === lvlId ? { ...l, typicalHeight: h } : l)),
      });
    },
    [levels, onChange],
  );

  const incrementTypical = useCallback(
    (lvlId: string) => {
      const src = levels.find((l) => l.id === lvlId);
      if (!src) return;
      const next = Math.min(99, (src.typicalCount ?? 1) + 1);
      onChange({
        levels: levels.map((l) => (l.id === lvlId ? { ...l, typicalCount: next } : l)),
      });
      toast.success(`Lantai tipikal: ${next}×`);
    },
    [levels, onChange],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const [tool, setTool] = useState<"line" | "rect" | "polyline" | "erase" | "edit" | "section">("line");
  const [lineKind, setLineKind] = useState<LineKind>("straight");
  const [drawing, setDrawing] = useState<{ a: Point; b: Point } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  // Pending bezier curve (after endpoints set, awaiting tangent adjustment + commit)
  const [pendingCurve, setPendingCurve] = useState<
    | { a: Point; b: Point; c1: Point; c2: Point }
    | null
  >(null);
  const [draggingHandle, setDraggingHandle] = useState<null | "c1" | "c2">(null);
  // Editing an existing vertex (drag to move). Tracks current key as it moves.
  type EditTarget =
    | { kind: "layer"; layerId: string; idx: number }
    | { kind: "line"; lineIdx: number; end: "a" | "b" };
  const [editDrag, setEditDrag] = useState<{ key: string; coord: Point; target: EditTarget } | null>(null);
  const [editHover, setEditHover] = useState<Point | null>(null);
  const [editMode, setEditMode] = useState<"move" | "addPoint" | "delete" | "fillet">("move");
  const [filletRadiusM, setFilletRadiusM] = useState<number>(0.5);
  const [filletSegments] = useState<number>(10);
  const [addPointPreview, setAddPointPreview] = useState<Point | null>(null);
  // Polyline live-draw: stylus turuns membentuk vertex baru otomatis saat berbelok.
  // points = vertex yang sudah ter-commit; lastSample = posisi stylus terbaru sebelum cursor;
  // cursor = posisi stylus saat ini. Selesai saat pointer up atau cursor menyentuh points[0].
  const [polyDraft, setPolyDraft] = useState<
    | { points: Point[]; lastSample: Point; cursor: Point; closed?: boolean }
    | null
  >(null);

  // Undo/redo history snapshots: {lines, layers}
  type Snap = { lines: Line[]; layers: Layer[] };
  const [past, setPast] = useState<Snap[]>([]);
  const [future, setFuture] = useState<Snap[]>([]);
  // Reset history when switching sketch
  useEffect(() => {
    setPast([]);
    setFuture([]);
  }, [id]);

  const pushHistory = useCallback(() => {
    setPast((p) => [...p.slice(-49), { lines, layers }]);
    setFuture([]);
  }, [lines, layers]);

  // ===== Viewport transform (pan/zoom/rotate) =====
  // World (where lines/layers are stored) -> screen via: rotate(r) -> scale(s) -> translate(tx,ty)
  const [view, setView] = useState({ s: 1, r: 0, tx: 0, ty: 0 });
  // Force re-render when OSM tile finishes loading
  const [tileTick, setTileTick] = useState(0);
  const onTileLoad = useCallback(() => setTileTick((n) => n + 1), []);
  // Reset view when switching sketch
  useEffect(() => {
    setView({ s: 1, r: 0, tx: 0, ty: 0 });
  }, [id]);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const screenToWorld = useCallback((p: Point): Point => {
    const v = viewRef.current;
    const dx = p.x - v.tx;
    const dy = p.y - v.ty;
    const cos = Math.cos(-v.r), sin = Math.sin(-v.r);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return { x: rx / v.s, y: ry / v.s };
  }, []);

  // Multi-pointer gesture tracking (pinch zoom + rotate)
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const gestureRef = useRef<null | {
    startDist: number;
    startAngle: number;
    startMid: Point;
    startView: { s: number; r: number; tx: number; ty: number };
    startWorldMid: Point;
  }>(null);

  const startGesture = useCallback(() => {
    const pts = Array.from(pointersRef.current.values());
    if (pts.length < 2) return;
    const [p1, p2] = pts;
    const startMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const startDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const startAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    gestureRef.current = {
      startDist,
      startAngle,
      startMid,
      startView: { ...viewRef.current },
      startWorldMid: screenToWorld(startMid),
    };
  }, [screenToWorld]);

  const updateGesture = useCallback(() => {
    const g = gestureRef.current;
    if (!g) return;
    const pts = Array.from(pointersRef.current.values());
    if (pts.length < 2) return;
    const [p1, p2] = pts;
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const a = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const newS = Math.max(0.2, Math.min(8, g.startView.s * (d / g.startDist)));
    const newR = g.startView.r + (a - g.startAngle);
    // Keep startWorldMid under the current finger midpoint:
    // screen = rotate(r) -> scale(s) -> translate(tx,ty)
    const cos = Math.cos(newR), sin = Math.sin(newR);
    const wx = g.startWorldMid.x * newS, wy = g.startWorldMid.y * newS;
    const rotX = wx * cos - wy * sin;
    const rotY = wx * sin + wy * cos;
    setView({ s: newS, r: newR, tx: mid.x - rotX, ty: mid.y - rotY });
  }, []);

  const resetView = () => setView({ s: 1, r: 0, tx: 0, ty: 0 });

  const pxPerMeter = (MINOR_PX * MAJOR_EVERY) / METERS_PER_MAJOR[scale];

  // Recompute layer areas on scale change (preserve relative geometry)
  const prevScaleRef = useRef(scale);
  useEffect(() => {
    if (prevScaleRef.current !== scale) {
      const next = layers.map((l) => ({
        ...l,
        areaM2: polygonAreaPx(l.points) / (pxPerMeter * pxPerMeter),
      }));
      onChange({ layers: next });
      prevScaleRef.current = scale;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.max(420, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const snapPoint = useCallback(
    (p: Point): Point => {
      if (!snap) return p;
      return {
        x: Math.round(p.x / MINOR_PX) * MINOR_PX,
        y: Math.round(p.y / MINOR_PX) * MINOR_PX,
      };
    },
    [snap],
  );

  const lockedLineKeys = useMemo(() => {
    const s = new Set<string>();
    layers.forEach((l) => {
      if (!l.locked) return;
      const pts = l.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const ka = keyOf(a), kb = keyOf(b);
        s.add(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`);
      }
    });
    return s;
  }, [layers]);

  const isLineLocked = useCallback(
    (ln: Line) => {
      const ka = keyOf(ln.a), kb = keyOf(ln.b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      return lockedLineKeys.has(k);
    },
    [lockedLineKeys],
  );

  // Redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // Paper background fills full screen (drawn before transform)
    ctx.fillStyle = "#f6efe3";
    ctx.fillRect(0, 0, size.w, size.h);

    // Apply world transform: translate -> rotate -> scale
    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.rotate(view.r);
    ctx.scale(view.s, view.s);

    const s = view.s;

    // Compute visible world bounds (inverse-transform the 4 screen corners)
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: size.w, y: 0 },
      { x: size.w, y: size.h },
      { x: 0, y: size.h },
    ].map((c) => {
      const dx = c.x - view.tx, dy = c.y - view.ty;
      const cos = Math.cos(-view.r), sin = Math.sin(-view.r);
      return { x: (dx * cos - dy * sin) / s, y: (dx * sin + dy * cos) / s };
    });
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));
    const major = MINOR_PX * MAJOR_EVERY;
    const x0 = Math.floor(minX / MINOR_PX) * MINOR_PX;
    const y0 = Math.floor(minY / MINOR_PX) * MINOR_PX;

    // OSM tile underlay (anchored at geo lat/lon → world 0,0).
    // mapRotation hanya berdampak pada peta; grid milimeter block & skala tetap.
    if (sketch.geo && sketch.geo.locked && sketch.geo.mapOpacity > 0.01) {
      const rotDeg = Number(sketch.geo.mapRotation) || 0;
      const rotRad = (rotDeg * Math.PI) / 180;
      // Rotated bounds: corners of the world-space viewport, rotated by -rotRad
      // (peta-frame). Cari AABB-nya supaya semua tile yang terlihat ter-render.
      const cos = Math.cos(-rotRad), sin = Math.sin(-rotRad);
      const cs = [
        { x: minX, y: minY }, { x: maxX, y: minY },
        { x: maxX, y: maxY }, { x: minX, y: maxY },
      ].map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
      const rb = {
        minX: Math.min(...cs.map((p) => p.x)),
        maxX: Math.max(...cs.map((p) => p.x)),
        minY: Math.min(...cs.map((p) => p.y)),
        maxY: Math.max(...cs.map((p) => p.y)),
      };
      ctx.save();
      ctx.rotate(rotRad);
      drawOsmTiles(ctx, {
        lat: sketch.geo.lat,
        lon: sketch.geo.lon,
        worldPxPerMeter: pxPerMeter,
        bounds: rb,
        opacity: sketch.geo.mapOpacity,
        onTileLoad,
      });
      ctx.restore();
    }

    // Minor grid (in world units)
    ctx.strokeStyle = "rgba(180, 90, 60, 0.22)";
    ctx.lineWidth = 1 / s;
    ctx.beginPath();
    for (let x = x0; x <= maxX; x += MINOR_PX) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    for (let y = y0; y <= maxY; y += MINOR_PX) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();

    // Major grid
    ctx.strokeStyle = "rgba(160, 60, 30, 0.55)";
    ctx.lineWidth = 1.2 / s;
    ctx.beginPath();
    const xm0 = Math.floor(minX / major) * major;
    const ym0 = Math.floor(minY / major) * major;
    for (let x = xm0; x <= maxX; x += major) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    for (let y = ym0; y <= maxY; y += major) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();

    // Group + sort by Level MDPL (lowest = bottom, highest = top)
    const sortedLevels = [...levels].sort((a, b) => a.mdpl - b.mdpl);
    const fallbackLvl = sortedLevels[0]?.id ?? "";
    const layersByLvl = new Map<string, Layer[]>();
    layers.forEach((ly) => {
      const k = ly.levelId && sortedLevels.some((l) => l.id === ly.levelId) ? ly.levelId : fallbackLvl;
      if (!layersByLvl.has(k)) layersByLvl.set(k, []);
      layersByLvl.get(k)!.push(ly);
    });
    const linesByLvl = new Map<string, Line[]>();
    lines.forEach((ln) => {
      const k = ln.levelId && sortedLevels.some((l) => l.id === ln.levelId) ? ln.levelId : fallbackLvl;
      if (!linesByLvl.has(k)) linesByLvl.set(k, []);
      linesByLvl.get(k)!.push(ln);
    });

    for (const lvl of sortedLevels) {
      const alpha = activeLvlId == null || lvl.id === activeLvlId ? 1 : lvl.opacity;
      if (alpha <= 0.001) continue;
      ctx.globalAlpha = alpha;

      // Layers
      (layersByLvl.get(lvl.id) || []).forEach((layer) => {
        if (layer.points.length < 3) return;
        ctx.beginPath();
        ctx.moveTo(layer.points[0].x, layer.points[0].y);
        for (let i = 1; i < layer.points.length; i++) {
          ctx.lineTo(layer.points[i].x, layer.points[i].y);
        }
        ctx.closePath();
        const isLahan = isLahanLayerName(layer.name);
        const isVoidLy = isVoidLayerName(layer.name);
        if (isVoidLy) {
          // Void: no fill, thin border, plus diagonal crossing lines (bbox X)
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.lineWidth = 1 / s;
          ctx.stroke();
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of layer.points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = "rgba(0,0,0,0.7)";
          ctx.lineWidth = 0.7 / s;
          ctx.beginPath();
          ctx.moveTo(minX, minY);
          ctx.lineTo(maxX, maxY);
          ctx.moveTo(maxX, minY);
          ctx.lineTo(minX, maxY);
          ctx.stroke();
          ctx.restore();
        } else if (isLahan) {
          ctx.fillStyle = layer.locked ? "rgba(200,200,200,0.35)" : "rgba(210,210,210,0.28)";
          ctx.fill();
          ctx.strokeStyle = "rgba(170,170,170,0.95)";
          ctx.lineWidth = (layer.locked ? 3 : 2.5) / s;
          ctx.stroke();
        } else {
          ctx.fillStyle = layer.color.replace("ALPHA", layer.locked ? "0.4" : "0.28");
          ctx.fill();
          ctx.strokeStyle = layer.color.replace("ALPHA", "0.95");
          ctx.lineWidth = (layer.locked ? 3 : 2.5) / s;
          ctx.stroke();
        }


        // GSB inward offset (dashed) untuk layer lahan
        if (isLahan) {
          const n = layer.points.length;
          ctx.save();
          ctx.strokeStyle = "rgba(0,0,0,0.9)";
          ctx.lineWidth = 1.3 / s;
          ctx.setLineDash([6 / s, 4 / s]);
          for (let i = 0; i < n; i++) {
            const m = getGsbMeters(layer, i);
            if (m <= 0) continue;
            const seg = inwardOffsetSegmentPx(layer.points, i, m * pxPerMeter);
            ctx.beginPath();
            ctx.moveTo(seg.a.x, seg.a.y);
            ctx.lineTo(seg.b.x, seg.b.y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          // Label "GSB i (x m)" — teks hitam, tanpa background
          const fontPx = 11 / s;
          ctx.font = `600 ${fontPx}px var(--font-display), sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(0,0,0,1)";
          for (let i = 0; i < n; i++) {
            const m = getGsbMeters(layer, i);
            if (m <= 0) continue;
            const seg = inwardOffsetSegmentPx(layer.points, i, m * pxPerMeter);
            const label = `GSB ${i + 1} (${m}m)`;
            ctx.fillText(label, seg.mid.x, seg.mid.y);
          }
          ctx.restore();
        }

        // "Tangga EVK" — radius 38 m lingkaran putus-putus + label
        if (layer.name.trim().toLowerCase() === "tangga evk") {
          const cx = layer.points.reduce((a, p) => a + p.x, 0) / layer.points.length;
          const cy = layer.points.reduce((a, p) => a + p.y, 0) / layer.points.length;
          const rPx = 38 * pxPerMeter;
          ctx.save();
          ctx.strokeStyle = "rgba(232,93,58,0.95)";
          ctx.lineWidth = 1.5 / s;
          ctx.setLineDash([8 / s, 5 / s]);
          ctx.beginPath();
          ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          // Garis tipis dari tepi ke pusat
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.lineWidth = 0.8 / s;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + rPx, cy);
          ctx.stroke();
          // Label "38 m"
          const fontPx = 11 / s;
          ctx.font = `600 ${fontPx}px var(--font-display), sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = "rgba(0,0,0,1)";
          ctx.fillText("38 m", cx + rPx / 2, cy - 2 / s);
          ctx.restore();
        }
      });

      // Lines
      ctx.lineCap = "round";
      const lvlLines = linesByLvl.get(lvl.id) || [];
      for (const ln of lvlLines) {
        const locked = isLineLocked(ln);
        const kind = ln.kind ?? "straight";
        ctx.strokeStyle = locked ? "#2d2d2d" : "#1a1a1a";
        ctx.lineWidth = (locked ? 2.6 : 2) / s;
        ctx.beginPath();
        ctx.moveTo(ln.a.x, ln.a.y);
        if (kind === "straight") {
          ctx.lineTo(ln.b.x, ln.b.y);
        } else if (kind === "arc") {
          const C = arcControlPoint(ln);
          ctx.quadraticCurveTo(C.x, C.y, ln.b.x, ln.b.y);
        } else {
          const c1 = ln.c1 ?? ln.a;
          const c2 = ln.c2 ?? ln.b;
          ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, ln.b.x, ln.b.y);
        }
        ctx.stroke();
      }

      // Endpoints
      ctx.fillStyle = "#1a1a1a";
      for (const ln of lvlLines) {
        for (const p of [ln.a, ln.b]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3 / s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;

    // Active drawing preview (during drag)
    if (drawing) {
      ctx.strokeStyle = "rgba(232, 93, 58, 0.9)";
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.beginPath();
      if (tool === "rect") {
        const x = Math.min(drawing.a.x, drawing.b.x);
        const y = Math.min(drawing.a.y, drawing.b.y);
        const w = Math.abs(drawing.b.x - drawing.a.x);
        const h = Math.abs(drawing.b.y - drawing.a.y);
        ctx.rect(x, y, w, h);
        ctx.stroke();
        ctx.fillStyle = "rgba(232, 93, 58, 0.10)";
        ctx.fill();
      } else {
        ctx.moveTo(drawing.a.x, drawing.a.y);
        if (lineKind === "arc") {
          const C = arcControlPoint({
            a: drawing.a, b: drawing.b, kind: "arc",
            bulge: defaultBulgePx(drawing.a, drawing.b),
          });
          ctx.quadraticCurveTo(C.x, C.y, drawing.b.x, drawing.b.y);
        } else {
          ctx.lineTo(drawing.b.x, drawing.b.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Polyline draft preview
    if (polyDraft) {
      const pts = polyDraft.points;
      const closing =
        pts.length >= 3 &&
        dist(polyDraft.cursor, pts[0]) <= 14 / s;
      ctx.strokeStyle = "rgba(232, 93, 58, 0.95)";
      ctx.lineWidth = 2 / s;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      // Garis aktif ke cursor (dashed)
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.lineTo(polyDraft.cursor.x, polyDraft.cursor.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Vertex markers
      ctx.fillStyle = "rgba(232, 93, 58, 1)";
      for (const v of pts) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 4 / s, 0, Math.PI * 2);
        ctx.fill();
      }
      // Highlight titik awal saat siap ditutup
      if (closing) {
        ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
        ctx.lineWidth = 2.5 / s;
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 10 / s, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(232, 93, 58, 0.7)";
        ctx.lineWidth = 1.5 / s;
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 8 / s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Garis Potong persisten (semua cuts A-A, B-B, …) — gaya bold dashed
    // dengan label di kedua ujung & panah arah pandang (tegak lurus ke kanan
    // dari arah awal→akhir).
    {
      const cuts = sketch.sectionCuts ?? [];
      type CutDraw = { a: Point; b: Point; label: string; isLive: boolean };
      const items: CutDraw[] = cuts.map((c) => ({
        a: c.p1, b: c.p2, label: c.label || "A-A", isLive: false,
      }));
      if (drawing && tool === "section") {
        const liveLabel = nextSectionLabel(cuts);
        items.push({ a: drawing.a, b: drawing.b, label: liveLabel, isLive: true });
      }
      for (const it of items) {
        const cutA = it.a, cutB = it.b;
        if (!cutA || !cutB || dist(cutA, cutB) <= 1) continue;
        const dx = cutB.x - cutA.x, dy = cutB.y - cutA.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux;
        const color = it.isLive ? "rgba(232, 93, 58, 0.95)" : "#111111";
        ctx.save();
        ctx.lineWidth = 2.5 / s;
        ctx.strokeStyle = color;
        ctx.setLineDash([14 / s, 6 / s, 4 / s, 6 / s]);
        ctx.beginPath();
        ctx.moveTo(cutA.x, cutA.y);
        ctx.lineTo(cutB.x, cutB.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label: pakai huruf depan saja (sebelum "-"), tambah ' di ujung kedua
        const base = (it.label.split("-")[0] || "A").trim();
        const labelR = 14 / s;
        const labelFont = `bold ${Math.round(14 / s)}px Manrope, sans-serif`;
        const drawCap = (p: Point, txt: string) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, labelR, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.font = labelFont;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(txt, p.x, p.y);
        };
        drawCap(cutA, base);
        drawCap(cutB, `${base}'`);
        // Panah arah pandang
        const mid = { x: (cutA.x + cutB.x) / 2, y: (cutA.y + cutB.y) / 2 };
        const arrowLen = Math.min(48, len * 0.18) / s;
        const tip = { x: mid.x + nx * arrowLen, y: mid.y + ny * arrowLen };
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6 / s;
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        const headSize = 7 / s;
        const hx1 = tip.x - nx * headSize - ux * (headSize * 0.6);
        const hy1 = tip.y - ny * headSize - uy * (headSize * 0.6);
        const hx2 = tip.x - nx * headSize + ux * (headSize * 0.6);
        const hy2 = tip.y - ny * headSize + uy * (headSize * 0.6);
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(hx1, hy1);
        ctx.lineTo(hx2, hy2);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }
    }

    // Edit-mode vertex markers — hanya pada level aktif
    if (tool === "edit") {
      const seen = new Set<string>();
      const verts: { p: Point; locked: boolean }[] = [];
      const lockedKeys = new Set<string>();
      layers.forEach((l) => {
        if (!l.locked) return;
        if (activeLvlId && l.levelId !== activeLvlId) return;
        l.points.forEach((p) => lockedKeys.add(keyOf(p)));
      });
      const pushVert = (p: Point) => {
        const k = keyOf(p);
        if (seen.has(k)) return;
        seen.add(k);
        verts.push({ p, locked: lockedKeys.has(k) });
      };
      lines.forEach((ln) => {
        if (activeLvlId && ln.levelId !== activeLvlId) return;
        pushVert(ln.a); pushVert(ln.b);
      });
      layers.forEach((l) => {
        if (activeLvlId && l.levelId !== activeLvlId) return;
        l.points.forEach(pushVert);
      });
      const deleteMode = editMode === "delete";
      verts.forEach((v) => {
        ctx.beginPath();
        ctx.arc(v.p.x, v.p.y, 6 / s, 0, Math.PI * 2);
        ctx.fillStyle = v.locked ? "rgba(120,120,120,0.85)" : (deleteMode ? "rgba(220,40,40,0.95)" : "#fff");
        ctx.fill();
        ctx.lineWidth = 2 / s;
        ctx.strokeStyle = v.locked ? "#666" : (deleteMode ? "#7a1010" : "rgba(232,93,58,1)");
        ctx.stroke();
      });
      if (editHover) {
        ctx.beginPath();
        ctx.arc(editHover.x, editHover.y, 10 / s, 0, Math.PI * 2);
        ctx.strokeStyle = deleteMode ? "rgba(220,40,40,0.95)" : "rgba(232,93,58,0.9)";
        ctx.lineWidth = 2 / s;
        ctx.stroke();
      }
      if (addPointPreview) {
        ctx.beginPath();
        ctx.arc(addPointPreview.x, addPointPreview.y, 7 / s, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(232,93,58,0.9)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(addPointPreview.x, addPointPreview.y, 12 / s, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(232,93,58,0.7)";
        ctx.lineWidth = 1.5 / s;
        ctx.setLineDash([4 / s, 3 / s]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Pending bezier (with two adjustable tangent handles)
    if (pendingCurve) {
      const { a, b, c1, c2 } = pendingCurve;
      ctx.strokeStyle = "rgba(232, 93, 58, 0.95)";
      ctx.lineWidth = 2.2 / s;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(232, 93, 58, 0.55)";
      ctx.lineWidth = 1 / s;
      ctx.setLineDash([4 / s, 4 / s]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(c1.x, c1.y);
      ctx.moveTo(b.x, b.y); ctx.lineTo(c2.x, c2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#1a1a1a";
      for (const p of [a, b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 / s, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const h of [c1, c2]) {
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "rgba(232, 93, 58, 1)";
        ctx.lineWidth = 2 / s;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 7 / s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (hover && tool === "line" && !drawing) {
      ctx.fillStyle = "rgba(232,93,58,0.9)";
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 4 / s, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // ----- Screen-space overlays (labels, so they stay upright & legible) -----
    const worldToScreen = (p: Point): Point => {
      const cos = Math.cos(view.r), sin = Math.sin(view.r);
      const wx = p.x * view.s, wy = p.y * view.s;
      return { x: wx * cos - wy * sin + view.tx, y: wx * sin + wy * cos + view.ty };
    };

    // Layer labels (vertical: name on top, area below) drawn upright
    layers.forEach((layer) => {
      if (layer.points.length < 3) return;
      const lvl = levels.find((l) => l.id === layer.levelId);
      const labelAlpha = !lvl || activeLvlId == null || lvl.id === activeLvlId ? 1 : lvl.opacity;
      if (labelAlpha <= 0.001) return;
      ctx.globalAlpha = labelAlpha;
      let cx = 0, cy = 0;
      layer.points.forEach((p) => { cx += p.x; cy += p.y; });
      cx /= layer.points.length;
      cy /= layer.points.length;
      const sp = worldToScreen({ x: cx, y: cy });
      const isLahan = isLahanLayerName(layer.name);
      const nameText = layer.locked ? `🔒 ${layer.name}` : layer.name;
      const areaText = `${layer.areaM2.toFixed(2)} m²`;
      ctx.font = "600 13px Manrope, sans-serif";
      const nameW = ctx.measureText(nameText).width;
      ctx.font = "700 12px Manrope, sans-serif";
      const areaW = ctx.measureText(areaText).width;
      const boxW = Math.max(nameW, areaW) + 16;
      const boxH = 38;
      const boxR = 8;
      if (isLahan) {
        // Lahan: teks abu-abu muda, tanpa background
        ctx.fillStyle = "rgba(160,160,160,0.95)";
        ctx.font = "600 13px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(nameText, sp.x, sp.y - 3);
        ctx.fillStyle = "rgba(160,160,160,0.8)";
        ctx.font = "700 12px Manrope, sans-serif";
        ctx.fillText(areaText, sp.x, sp.y + 14);
      } else {
        // Ruang: teks hitam, latar putih opacity 50%, sudut curve
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath();
        const bx = sp.x - boxW / 2, by = sp.y - boxH / 2;
        ctx.moveTo(bx + boxR, by);
        ctx.lineTo(bx + boxW - boxR, by);
        ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + boxR);
        ctx.lineTo(bx + boxW, by + boxH - boxR);
        ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - boxR, by + boxH);
        ctx.lineTo(bx + boxR, by + boxH);
        ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - boxR);
        ctx.lineTo(bx, by + boxR);
        ctx.quadraticCurveTo(bx, by, bx + boxR, by);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.font = "600 13px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(nameText, sp.x, sp.y - 3);
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.font = "700 12px Manrope, sans-serif";
        ctx.fillText(areaText, sp.x, sp.y + 14);
      }
      ctx.textAlign = "start";
    });
    ctx.globalAlpha = 1;

    // Active line length label, screen-space
    if (drawing) {
      const meters = dist(drawing.a, drawing.b) / pxPerMeter;
      const midW = { x: (drawing.a.x + drawing.b.x) / 2, y: (drawing.a.y + drawing.b.y) / 2 };
      const sp = worldToScreen(midW);
      const label = `${meters.toFixed(2)} m`;
      ctx.font = "600 12px Manrope, sans-serif";
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = "rgba(26,26,26,0.92)";
      ctx.fillRect(sp.x + 8, sp.y - 22, w, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, sp.x + 14, sp.y - 8);
    }
  }, [size, lines, drawing, hover, layers, tool, lineKind, pendingCurve, polyDraft, pxPerMeter, isLineLocked, view, editHover, addPointPreview, levels, activeLvlId, editMode, sketch.geo, sketch.sectionCuts, tileTick, onTileLoad]);

  const getScreenPos = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const getWorldPos = (e: React.PointerEvent): Point => {
    const sp = getScreenPos(e);
    return snapPoint(screenToWorld(sp));
  };
  const getWorldPosRaw = (e: React.PointerEvent): Point => screenToWorld(getScreenPos(e));

  // Commit a finished line into state, run cycle detection, push history.
  // Apply boolean subtraction: new polygon carves out overlapping area from
  // any existing same-level non-lahan layer.
  const applySubtractionToLayers = useCallback(
    (existing: Layer[], newPoly: Point[], levelId: string | undefined): Layer[] => {
      if (newPoly.length < 3) return existing;
      const out: Layer[] = [];
      for (const ly of existing) {
        const sameLevel = (ly.levelId ?? undefined) === (levelId ?? undefined);
        if (!sameLevel || isLahanLayerName(ly.name) || ly.points.length < 3) {
          out.push(ly);
          continue;
        }
        const before = polygonAreaPx(ly.points);
        const result = subtractPolygon(ly.points, newPoly);
        if (!result || result.length < 3) {
          // Fully covered — remove.
          toast.message(`${ly.name} terhapus karena tertutup ruang baru`);
          continue;
        }
        const after = polygonAreaPx(result);
        if (Math.abs(after - before) < 0.5) {
          out.push(ly);
          continue;
        }
        const newArea = after / (pxPerMeter * pxPerMeter);
        out.push({ ...ly, points: result, areaM2: newArea });
      }
      return out;
    },
    [pxPerMeter],
  );

  const commitLine = useCallback(
    (newLine: Line) => {
      const { levels: nextLevelsBase, activeId } = ensureLevels();
      const taggedLine: Line = { ...newLine, levelId: newLine.levelId ?? activeId };
      const nextLines = [...lines, taggedLine];
      const newIdx = nextLines.length - 1;
      const cycle = findCycleWithLine(nextLines, newIdx);
      let nextLayers = layers;
      if (cycle && cycle.length >= 3) {
        const areaPx = polygonAreaPx(cycle);
        if (areaPx > 25) {
          const areaM2 = areaPx / (pxPerMeter * pxPerMeter);
          const idx = layers.length + 1;
          const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];
          const layer: Layer = {
            id: `L${Date.now()}`,
            name: `Ruang ${idx}`,
            points: cycle,
            areaM2,
            color,
            locked: false,
            levelId: activeId,
            coefficient: 1,
          };
          const carved = applySubtractionToLayers(layers, cycle, activeId);
          nextLayers = [...carved, layer];
          toast.success(`${layer.name} terbentuk — ${areaM2.toFixed(2)} m²`);
        }
      }
      pushHistory();
      const patch: Partial<Sketch> = { lines: nextLines, layers: nextLayers };
      if (nextLevelsBase !== levels) {
        patch.levels = nextLevelsBase;
        patch.activeLevelId = activeId;
      } else if (!activeLvlId) {
        patch.activeLevelId = activeId;
      }
      onChange(patch);
    },
    [lines, layers, levels, activeLvlId, pxPerMeter, pushHistory, onChange, ensureLevels, applySubtractionToLayers],
  );

  const commitPendingCurve = useCallback(() => {
    if (!pendingCurve) return;
    commitLine({
      a: pendingCurve.a,
      b: pendingCurve.b,
      kind: "bezier",
      c1: pendingCurve.c1,
      c2: pendingCurve.c2,
    });
    setPendingCurve(null);
  }, [pendingCurve, commitLine]);

  const cancelPendingCurve = useCallback(() => {
    setPendingCurve(null);
    setDraggingHandle(null);
  }, []);

  // Commit a rectangle from two diagonal corners
  const commitRect = useCallback(
    (a: Point, b: Point) => {
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      if (maxX - minX < 4 || maxY - minY < 4) return;
      const p1 = { x: minX, y: minY };
      const p2 = { x: maxX, y: minY };
      const p3 = { x: maxX, y: maxY };
      const p4 = { x: minX, y: maxY };
      const { levels: nextLevelsBase, activeId } = ensureLevels();
      const newLines: Line[] = [
        { a: p1, b: p2, kind: "straight", levelId: activeId },
        { a: p2, b: p3, kind: "straight", levelId: activeId },
        { a: p3, b: p4, kind: "straight", levelId: activeId },
        { a: p4, b: p1, kind: "straight", levelId: activeId },
      ];
      const pts = [p1, p2, p3, p4];
      const areaPx = polygonAreaPx(pts);
      const areaM2 = areaPx / (pxPerMeter * pxPerMeter);
      const idx = layers.length + 1;
      const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];
      const layer: Layer = {
        id: `L${Date.now()}`,
        name: `Ruang ${idx}`,
        points: pts,
        areaM2,
        color,
        locked: false,
        levelId: activeId,
        coefficient: 1,
      };
      pushHistory();
      const carved = applySubtractionToLayers(layers, pts, activeId);
      const patch: Partial<Sketch> = {
        lines: [...lines, ...newLines],
        layers: [...carved, layer],
      };
      if (nextLevelsBase !== levels) {
        patch.levels = nextLevelsBase;
        patch.activeLevelId = activeId;
      } else if (!activeLvlId) {
        patch.activeLevelId = activeId;
      }
      onChange(patch);
      toast.success(`${layer.name} terbentuk — ${areaM2.toFixed(2)} m²`);
    },
    [lines, layers, levels, activeLvlId, pxPerMeter, pushHistory, onChange, ensureLevels, applySubtractionToLayers],
  );

  // Commit sebuah polyline. `closed` = true bila berakhir di titik awal,
  // membentuk polygon tertutup (otomatis menjadi Ruang baru).
  const commitPolyline = useCallback(
    (pts: Point[], closed: boolean) => {
      if (pts.length < 2) return;
      const { levels: nextLevelsBase, activeId } = ensureLevels();
      const segCount = closed ? pts.length : pts.length - 1;
      const newLines: Line[] = [];
      for (let i = 0; i < segCount; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (dist(a, b) < 1) continue;
        newLines.push({ a, b, kind: "straight", levelId: activeId });
      }
      if (newLines.length === 0) return;
      pushHistory();
      let nextLayers = layers;
      const patch: Partial<Sketch> = { lines: [...lines, ...newLines] };
      if (closed && pts.length >= 3) {
        const areaPx = polygonAreaPx(pts);
        if (areaPx > 25) {
          const areaM2 = areaPx / (pxPerMeter * pxPerMeter);
          const idx = layers.length + 1;
          const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];
          const layer: Layer = {
            id: `L${Date.now()}`,
            name: `Ruang ${idx}`,
            points: pts,
            areaM2,
            color,
            locked: false,
            levelId: activeId,
            coefficient: 1,
          };
          const carved = applySubtractionToLayers(layers, pts, activeId);
          nextLayers = [...carved, layer];
          toast.success(`${layer.name} terbentuk — ${areaM2.toFixed(2)} m²`);
        }
      } else {
        toast.success(`Polyline: ${newLines.length} ruas tersimpan`);
      }
      patch.layers = nextLayers;
      if (nextLevelsBase !== levels) {
        patch.levels = nextLevelsBase;
        patch.activeLevelId = activeId;
      } else if (!activeLvlId) {
        patch.activeLevelId = activeId;
      }
      onChange(patch);
    },
    [lines, layers, levels, activeLvlId, pxPerMeter, pushHistory, onChange, ensureLevels, applySubtractionToLayers],
  );



  // Find nearest vertex on the ACTIVE level (line endpoint or layer point) within tolerance
  const findVertexAt = useCallback(
    (p: Point, tol: number): Point | null => {
      let best: Point | null = null;
      let bestD = tol;
      const consider = (v: Point) => {
        const d = dist(p, v);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      };
      lines.forEach((ln) => {
        if (activeLvlId && ln.levelId !== activeLvlId) return;
        consider(ln.a);
        consider(ln.b);
      });
      layers.forEach((l) => {
        if (activeLvlId && l.levelId !== activeLvlId) return;
        l.points.forEach(consider);
      });
      return best;
    },
    [lines, layers, activeLvlId],
  );

  // Pick a vertex while remembering which polygon (layer) or free line it
  // belongs to, so subsequent edits affect only that occurrence — vertices
  // from other polygons or other levels that share the same coordinate are
  // left untouched.
  const findVertexTargetAt = useCallback(
    (p: Point, tol: number): { coord: Point; target: EditTarget } | null => {
      let best: { coord: Point; target: EditTarget } | null = null;
      let bestD = tol;
      layers.forEach((l) => {
        if (activeLvlId && l.levelId !== activeLvlId) return;
        l.points.forEach((pt, i) => {
          const d = dist(p, pt);
          if (d < bestD) {
            bestD = d;
            best = { coord: pt, target: { kind: "layer", layerId: l.id, idx: i } };
          }
        });
      });
      lines.forEach((ln, i) => {
        if (activeLvlId && ln.levelId !== activeLvlId) return;
        const da = dist(p, ln.a);
        if (da < bestD) {
          bestD = da;
          best = { coord: ln.a, target: { kind: "line", lineIdx: i, end: "a" } };
        }
        const db = dist(p, ln.b);
        if (db < bestD) {
          bestD = db;
          best = { coord: ln.b, target: { kind: "line", lineIdx: i, end: "b" } };
        }
      });
      return best;
    },
    [lines, layers, activeLvlId],
  );

  const lockedVertexKeys = useMemo(() => {
    const s = new Set<string>();
    layers.forEach((l) => {
      if (!l.locked) return;
      l.points.forEach((p) => s.add(keyOf(p)));
    });
    return s;
  }, [layers]);

  // Move a single targeted vertex to newPos. For a layer target, only that
  // polygon's vertex at the recorded index is moved; lines on the same level
  // are updated only when their endpoint matches the old coordinate AND the
  // other endpoint coincides with an adjacent vertex of the target polygon
  // (so it can be considered an edge of THAT polygon). Lines on other levels
  // and vertices on other polygons that happen to share the same coordinate
  // are left untouched.
  const moveVertexTarget = useCallback(
    (target: EditTarget, oldPos: Point, newPos: Point) => {
      const oldKey = keyOf(oldPos);
      let nextLayers = layers;
      let layerLevelId: string | null | undefined = null;
      const neighborKeys = new Set<string>();
      if (target.kind === "layer") {
        nextLayers = layers.map((l) => {
          if (l.id !== target.layerId) return l;
          const n = l.points.length;
          if (target.idx < 0 || target.idx >= n) return l;
          const prev = l.points[(target.idx - 1 + n) % n];
          const nxt = l.points[(target.idx + 1) % n];
          neighborKeys.add(keyOf(prev));
          neighborKeys.add(keyOf(nxt));
          layerLevelId = l.levelId;
          const pts = l.points.slice();
          pts[target.idx] = newPos;
          return { ...l, points: pts, areaM2: polygonAreaPx(pts) / (pxPerMeter * pxPerMeter) };
        });
      }
      const nextLines = lines.map((ln, i) => {
        if (target.kind === "line") {
          if (i !== target.lineIdx) return ln;
          if (target.end === "a") {
            let next: Line = { ...ln, a: newPos };
            if (ln.kind === "bezier" && ln.c1) {
              next = { ...next, c1: { x: ln.c1.x + (newPos.x - ln.a.x), y: ln.c1.y + (newPos.y - ln.a.y) } };
            }
            return next;
          }
          let next: Line = { ...ln, b: newPos };
          if (ln.kind === "bezier" && ln.c2) {
            next = { ...next, c2: { x: ln.c2.x + (newPos.x - ln.b.x), y: ln.c2.y + (newPos.y - ln.b.y) } };
          }
          return next;
        }
        // layer target: only same-level lines that form an edge of the target polygon
        if (layerLevelId && ln.levelId !== layerLevelId) return ln;
        let next: Line = ln;
        if (keyOf(ln.a) === oldKey && neighborKeys.has(keyOf(ln.b))) {
          next = { ...next, a: newPos };
          if (next.kind === "bezier" && ln.c1) {
            next = { ...next, c1: { x: ln.c1.x + (newPos.x - ln.a.x), y: ln.c1.y + (newPos.y - ln.a.y) } };
          }
        }
        if (keyOf(ln.b) === oldKey && neighborKeys.has(keyOf(ln.a))) {
          next = { ...next, b: newPos };
          if (next.kind === "bezier" && ln.c2) {
            next = { ...next, c2: { x: ln.c2.x + (newPos.x - ln.b.x), y: ln.c2.y + (newPos.y - ln.b.y) } };
          }
        }
        return next;
      });
      onChange({ lines: nextLines, layers: nextLayers });
    },
    [lines, layers, pxPerMeter, onChange],
  );

  // Insert a new vertex at `p` along line at index `idx` (straight lines only).
  const splitLineAt = useCallback(
    (idx: number, p: Point) => {
      const ln = lines[idx];
      if (!ln) return;
      if ((ln.kind ?? "straight") !== "straight") {
        toast.error("Tambah titik hanya untuk garis lurus");
        return;
      }
      if (isLineLocked(ln)) {
        toast.error("Garis terkunci");
        return;
      }
      // Avoid duplicates near endpoints
      const tol = 4;
      if (dist(p, ln.a) < tol || dist(p, ln.b) < tol) return;
      pushHistory();
      const left: Line = { ...ln, a: ln.a, b: p, kind: "straight" };
      const right: Line = { ...ln, a: p, b: ln.b, kind: "straight" };
      const nextLines = [...lines.slice(0, idx), left, right, ...lines.slice(idx + 1)];
      const ka = keyOf(ln.a);
      const kb = keyOf(ln.b);
      const nextLayers = layers.map((l) => {
        const n = l.points.length;
        let inserted = false;
        const out: Point[] = [];
        for (let i = 0; i < n; i++) {
          const cur = l.points[i];
          const nxt = l.points[(i + 1) % n];
          out.push(cur);
          const kc = keyOf(cur);
          const kn = keyOf(nxt);
          if (!inserted && ((kc === ka && kn === kb) || (kc === kb && kn === ka))) {
            out.push(p);
            inserted = true;
          }
        }
        if (!inserted) return l;
        return { ...l, points: out, areaM2: polygonAreaPx(out) / (pxPerMeter * pxPerMeter) };
      });
      onChange({ lines: nextLines, layers: nextLayers });
    },
    [lines, layers, pxPerMeter, pushHistory, onChange, isLineLocked],
  );

  // Delete a vertex on the active level: removes it from layer polygons
  // (recomputing area, dropping the layer if it collapses) and removes any
  // active-level lines that touch it.
  const deleteVertexAt = useCallback(
    (key: string) => {
      if (lockedVertexKeys.has(key)) {
        toast.error("Titik terkunci");
        return;
      }
      pushHistory();
      const nextLines = lines.filter((ln) => {
        if (activeLvlId && ln.levelId !== activeLvlId) return true;
        return keyOf(ln.a) !== key && keyOf(ln.b) !== key;
      });
      const nextLayers: Layer[] = [];
      let removedLayer: string | null = null;
      for (const l of layers) {
        if (activeLvlId && l.levelId !== activeLvlId) {
          nextLayers.push(l);
          continue;
        }
        const pts = l.points.filter((pt) => keyOf(pt) !== key);
        if (pts.length === l.points.length) {
          nextLayers.push(l);
          continue;
        }
        if (pts.length < 3) {
          removedLayer = l.name;
          continue;
        }
        nextLayers.push({ ...l, points: pts, areaM2: polygonAreaPx(pts) / (pxPerMeter * pxPerMeter) });
      }
      onChange({ lines: nextLines, layers: nextLayers });
      if (removedLayer) toast.message(`${removedLayer} dihapus karena titiknya tidak cukup`);
      else toast.success("Titik dihapus");
    },
    [lines, layers, activeLvlId, lockedVertexKeys, pxPerMeter, pushHistory, onChange],
  );

  // Delete the nearest active-level edge/line near point p (within tolerance px in world)
  const deleteEdgeAt = useCallback(
    (p: Point, tolPx: number): boolean => {
      let bestIdx = -1;
      let bestD = Infinity;
      lines.forEach((ln, i) => {
        if (activeLvlId && ln.levelId !== activeLvlId) return;
        if (isLineLocked(ln)) return;
        const d = pointToLine(p, ln);
        if (d < bestD) { bestD = d; bestIdx = i; }
      });
      if (bestIdx < 0 || bestD > tolPx) return false;
      pushHistory();
      onChange({ lines: lines.filter((_, i) => i !== bestIdx) });
      toast.success("Edge dihapus");
      return true;
    },
    [lines, activeLvlId, isLineLocked, pushHistory, onChange],
  );

  // Fillet a vertex: replace it with a smooth arc of `filletRadiusM` between
  // the two adjacent polygon edges. Approximated as N short line segments.
  const filletVertexAt = useCallback(
    (target: EditTarget, coord: Point) => {
      const key = keyOf(coord);
      if (lockedVertexKeys.has(key)) { toast.error("Titik terkunci"); return; }
      if (target.kind !== "layer") { toast.error("Pilih titik pada poligon"); return; }
      const layer = layers.find((l) => l.id === target.layerId);
      if (!layer || layer.points.length < 3) { toast.error("Pilih titik pada poligon"); return; }
      const idx = target.idx;
      const n = layer.points.length;
      if (idx < 0 || idx >= n) return;
      const V = layer.points[idx];
      const A = layer.points[(idx - 1 + n) % n];
      const B = layer.points[(idx + 1) % n];
      const vax = A.x - V.x, vay = A.y - V.y;
      const vbx = B.x - V.x, vby = B.y - V.y;
      const la = Math.hypot(vax, vay), lb = Math.hypot(vbx, vby);
      if (la < 1 || lb < 1) { toast.error("Edge terlalu pendek"); return; }
      const uax = vax / la, uay = vay / la;
      const ubx = vbx / lb, uby = vby / lb;
      const cosA = Math.max(-1, Math.min(1, uax * ubx + uay * uby));
      const ang = Math.acos(cosA);
      if (ang < 0.05 || Math.PI - ang < 0.05) { toast.error("Sudut tidak bisa difillet"); return; }
      const rPxRaw = Math.max(0.01, filletRadiusM) * pxPerMeter;
      const halfTan = Math.tan(ang / 2);
      let d = rPxRaw / halfTan;
      d = Math.min(d, la * 0.49, lb * 0.49);
      const rEff = d * halfTan;
      const P1 = { x: V.x + uax * d, y: V.y + uay * d };
      const P2 = { x: V.x + ubx * d, y: V.y + uby * d };
      const bx = uax + ubx, by = uay + uby;
      const bl = Math.hypot(bx, by) || 1;
      const nbx = bx / bl, nby = by / bl;
      const cDist = rEff / Math.sin(ang / 2);
      const C = { x: V.x + nbx * cDist, y: V.y + nby * cDist };
      const a1 = Math.atan2(P1.y - C.y, P1.x - C.x);
      const a2 = Math.atan2(P2.y - C.y, P2.x - C.x);
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const seg = Math.max(2, filletSegments);
      const arcPts: Point[] = [];
      for (let i = 1; i < seg; i++) {
        const t = i / seg;
        const a = a1 + da * t;
        arcPts.push({ x: C.x + rEff * Math.cos(a), y: C.y + rEff * Math.sin(a) });
      }
      const newPts: Point[] = [P1, ...arcPts, P2];
      pushHistory();
      const ka = keyOf(A), kb = keyOf(B);
      // Only modify the target polygon — other polygons sharing this vertex
      // (even on the same level) are left untouched.
      const nextLayers = layers.map((l) => {
        if (l.id !== target.layerId) return l;
        const out = [...l.points.slice(0, idx), ...newPts, ...l.points.slice(idx + 1)];
        return { ...l, points: out, areaM2: polygonAreaPx(out) / (pxPerMeter * pxPerMeter) };
      });
      // Snap only same-level lines that form an edge of THIS polygon
      // (endpoint equals the filleted vertex AND other endpoint equals an
      // adjacent vertex of this polygon).
      const layerLevel = layer.levelId;
      let nextLines = lines.map((ln) => {
        if (layerLevel && ln.levelId !== layerLevel) return ln;
        const aIsV = keyOf(ln.a) === key;
        const bIsV = keyOf(ln.b) === key;
        if (!aIsV && !bIsV) return ln;
        let na = ln.a, nb = ln.b;
        if (aIsV) {
          const ko = keyOf(ln.b);
          if (ko === ka) na = P1;
          else if (ko === kb) na = P2;
          else return ln;
        }
        if (bIsV) {
          const ko = keyOf(ln.a);
          if (ko === ka) nb = P1;
          else if (ko === kb) nb = P2;
          else return ln;
        }
        return { ...ln, a: na, b: nb };
      });
      // Tambahkan garis hitam untuk setiap segmen lengkung fillet
      const arcLinePts = [P1, ...arcPts, P2];
      for (let i = 0; i < arcLinePts.length - 1; i++) {
        nextLines.push({
          a: arcLinePts[i],
          b: arcLinePts[i + 1],
          kind: "straight" as const,
          levelId: layer.levelId,
        });
      }
      onChange({ layers: nextLayers, lines: nextLines });
      toast.success("Titik difillet");
    },
    [layers, lines, lockedVertexKeys, pxPerMeter, filletRadiusM, filletSegments, pushHistory, onChange],
  );


  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, getScreenPos(e));

    // Two or more fingers => gesture (pinch zoom + rotate). Abort any draw.
    if (pointersRef.current.size >= 2) {
      if (drawing) setDrawing(null);
      setDraggingHandle(null);
      startGesture();
      return;
    }

    // Pending bezier handle drag has top priority
    if (pendingCurve) {
      const wp = getWorldPosRaw(e);
      const tol = 14 / view.s;
      if (dist(wp, pendingCurve.c1) <= tol) {
        setDraggingHandle("c1");
        return;
      }
      if (dist(wp, pendingCurve.c2) <= tol) {
        setDraggingHandle("c2");
        return;
      }
      // Tap outside handles: do nothing (use Selesai button to commit)
      return;
    }

    const p = getWorldPos(e);
    if (tool === "line" || tool === "rect" || tool === "section") {
      setDrawing({ a: p, b: p });
    } else if (tool === "polyline") {
      setPolyDraft({ points: [p], lastSample: p, cursor: p });
    } else if (tool === "edit") {
      const raw = getWorldPosRaw(e);
      const tol = 14 / view.s;
      if (editMode === "addPoint") {
        // Find nearest straight line on the active level within tolerance and split there
        const tolPx = 12 / view.s;
        let bestIdx = -1;
        let bestD = Infinity;
        let bestProj: Point | null = null;
        lines.forEach((ln, i) => {
          if (activeLvlId && ln.levelId !== activeLvlId) return;
          if ((ln.kind ?? "straight") !== "straight") return;
          if (isLineLocked(ln)) return;
          const proj = projectOnSegment(raw, ln.a, ln.b);
          const d = dist(raw, proj);
          if (d < bestD) {
            bestD = d;
            bestIdx = i;
            bestProj = proj;
          }
        });
        if (bestIdx >= 0 && bestProj && bestD <= tolPx) {
          splitLineAt(bestIdx, bestProj);
        }
        return;
      }
      if (editMode === "delete") {
        // Prefer hitting a vertex first; fall back to edges on the active level
        const v = findVertexAt(raw, tol);
        if (v) {
          deleteVertexAt(keyOf(v));
          return;
        }
        const tolPx = 10 / view.s;
        deleteEdgeAt(raw, tolPx);
        return;
      }
      if (editMode === "fillet") {
        const hit = findVertexTargetAt(raw, tol);
        if (!hit) return;
        filletVertexAt(hit.target, hit.coord);
        return;
      }
      const hit = findVertexTargetAt(raw, tol);
      if (!hit) return;
      const k = keyOf(hit.coord);
      if (lockedVertexKeys.has(k)) {
        toast.error("Titik terkunci");
        return;
      }
      pushHistory();
      setEditDrag({ key: k, coord: hit.coord, target: hit.target });
    } else if (tool === "erase") {
      const hitLayer = [...layers].reverse().find((l) => {
        if (activeLvlId && l.levelId !== activeLvlId) return false;
        return pointInPolygon(p, l.points);
      });
      if (hitLayer) {
        if (hitLayer.locked) {
          toast.error(`${hitLayer.name} terkunci`);
          return;
        }
        pushHistory();
        onChange({ layers: layers.filter((l) => l.id !== hitLayer.id) });
        toast.success(`Layer ${hitLayer.name} dihapus`);
        return;
      }
      const tol = 8 / view.s; // world-space tolerance
      let bestIdx = -1;
      let bestD = Infinity;
      lines.forEach((ln, i) => {
        if (activeLvlId && ln.levelId !== activeLvlId) return;
        if (isLineLocked(ln)) return;
        const d = pointToLine(p, ln);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0 && bestD <= tol) {
        pushHistory();
        onChange({ lines: lines.filter((_, i) => i !== bestIdx) });
      } else {
        const hitLocked = lines.find((ln) => (!activeLvlId || ln.levelId === activeLvlId) && isLineLocked(ln) && pointToLine(p, ln) <= tol);
        if (hitLocked) toast.error("Garis terkunci");
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, getScreenPos(e));
    }
    if (gestureRef.current && pointersRef.current.size >= 2) {
      updateGesture();
      return;
    }
    if (pointersRef.current.size >= 2) return;

    if (draggingHandle && pendingCurve) {
      const wp = getWorldPosRaw(e);
      setPendingCurve({ ...pendingCurve, [draggingHandle]: wp });
      return;
    }

    if (editDrag) {
      const newPos = getWorldPos(e);
      moveVertexTarget(editDrag.target, editDrag.coord, newPos);
      setEditDrag({ key: keyOf(newPos), coord: newPos, target: editDrag.target });
      setEditHover(newPos);
      return;
    }

    const p = getWorldPos(e);
    setHover(p);
    if (tool === "edit") {
      const raw = getWorldPosRaw(e);
      const tol = 14 / view.s;
      if (editMode === "addPoint") {
        const tolPx = 12 / view.s;
        let bestD = Infinity;
        let bestProj: Point | null = null;
        lines.forEach((ln) => {
          if (activeLvlId && ln.levelId !== activeLvlId) return;
          if ((ln.kind ?? "straight") !== "straight") return;
          if (isLineLocked(ln)) return;
          if (isLineLocked(ln)) return;
          const proj = projectOnSegment(raw, ln.a, ln.b);
          const d = dist(raw, proj);
          if (d < bestD) {
            bestD = d;
            bestProj = proj;
          }
        });
        setAddPointPreview(bestProj && bestD <= tolPx ? bestProj : null);
        setEditHover(null);
      } else {
        const v = findVertexAt(raw, tol);
        setEditHover(v);
        setAddPointPreview(null);
      }
    }
    if (drawing) setDrawing({ a: drawing.a, b: p });
    if (polyDraft && tool === "polyline") {
      const cur = p;
      const pts = polyDraft.points;
      const lastV = pts[pts.length - 1];
      const ls = polyDraft.lastSample;
      const minSegPx = 10 / view.s;
      const closeTolPx = 14 / view.s;
      // Auto-close: cursor menyentuh titik awal
      if (pts.length >= 3 && dist(cur, pts[0]) <= closeTolPx) {
        commitPolyline(pts, true);
        setPolyDraft(null);
        return;
      }
      // Deteksi belokan: bandingkan arah lastV→lastSample vs lastSample→cursor
      const v1x = ls.x - lastV.x, v1y = ls.y - lastV.y;
      const v2x = cur.x - ls.x, v2y = cur.y - ls.y;
      const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
      if (n1 > minSegPx && n2 > minSegPx / 2) {
        const cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
        // ~22 derajat → cos ≈ 0.927
        if (cos < 0.927) {
          setPolyDraft({ points: [...pts, ls], lastSample: cur, cursor: cur });
          return;
        }
      }
      setPolyDraft({ ...polyDraft, lastSample: n2 > minSegPx / 3 ? cur : ls, cursor: cur });
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2 && gestureRef.current) {
      gestureRef.current = null;
      // Don't commit any draw on gesture end
      setDrawing(null);
      return;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasGesture = !!gestureRef.current;
    endPointer(e);
    if (wasGesture) return;

    if (draggingHandle) {
      setDraggingHandle(null);
      return;
    }
    if (editDrag) {
      setEditDrag(null);
      return;
    }
    if (polyDraft && tool === "polyline") {
      // Tambahkan sample terakhir bila cukup jauh dari vertex terakhir
      const pts = polyDraft.points.slice();
      const last = pts[pts.length - 1];
      const minTailPx = 8 / view.s;
      const closeTolPx = 14 / view.s;
      const closing = pts.length >= 3 && dist(polyDraft.cursor, pts[0]) <= closeTolPx;
      if (!closing && dist(polyDraft.cursor, last) > minTailPx) {
        pts.push(polyDraft.cursor);
      }
      setPolyDraft(null);
      commitPolyline(pts, closing);
      return;
    }
    if (!drawing) return;
    if (dist(drawing.a, drawing.b) < 4) {
      setDrawing(null);
      return;
    }
    const a = drawing.a;
    const b = drawing.b;
    const curTool = tool;
    setDrawing(null);

    if (curTool === "rect") {
      commitRect(a, b);
      return;
    }

    if (curTool === "section") {
      // Garis Potong: simpan bidang irisan baru ke sketch (A-A, B-B, …).
      // Slide presentasi "Potongan Prinsip Skematik X-X" akan otomatis muncul.
      const existing = sketch.sectionCuts ?? [];
      const label = nextSectionLabel(existing);
      const next: SectionCut[] = [
        ...existing,
        { p1: a, p2: b, label, updatedAt: Date.now() },
      ];
      onChange({ sectionCuts: next, sectionCut: undefined });
      toast.success(`Garis Potong ${label} tersimpan · slide potongan otomatis dibuat`, { duration: 2500 });
      return;
    }


    if (lineKind === "bezier") {
      // Defer commit: open tangent handles for adjustment
      setPendingCurve({ a, b, ...defaultBezierHandles(a, b) });
      toast("Sesuaikan dua tangent, lalu tekan Selesai", { duration: 2500 });
      return;
    }

    const newLine: Line =
      lineKind === "arc"
        ? { a, b, kind: "arc", bulge: defaultBulgePx(a, b) }
        : { a, b, kind: "straight" };
    commitLine(newLine);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    endPointer(e);
    setDrawing(null);
    setDraggingHandle(null);
    setEditDrag(null);
    setPolyDraft(null);
  };

  const handleUndo = () => {
    if (!past.length) {
      toast.error("Tidak ada yang bisa di-undo");
      return;
    }
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, { lines, layers }]);
    onChange({ lines: prev.lines, layers: prev.layers });
  };

  const handleRedo = () => {
    if (!future.length) {
      toast.error("Tidak ada yang bisa di-redo");
      return;
    }
    const nxt = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, { lines, layers }]);
    onChange({ lines: nxt.lines, layers: nxt.layers });
  };

  const removeLayer = (lid: string) => {
    const layer = layers.find((l) => l.id === lid);
    if (layer?.locked) {
      toast.error(`${layer.name} terkunci`);
      return;
    }
    pushHistory();
    onChange({ layers: layers.filter((l) => l.id !== lid) });
  };

  // Duplikat (copy-paste) sebuah ruang/layer beserta garis-garis tepinya,
  // digeser sejauh 1 meter ke kanan-bawah agar terlihat terpisah.
  const duplicateLayer = (lid: string) => {
    const layer = layers.find((l) => l.id === lid);
    if (!layer) return;
    const dx = pxPerMeter * 1;
    const dy = pxPerMeter * 1;
    const eps = Math.max(0.5, pxPerMeter * 0.01);
    const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) <= eps;
    const isVertex = (p: Point) => layer.points.some((v) => near(p, v));
    const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });

    const newPoints = layer.points.map(shift);
    const now = Date.now();
    const newLayer: Layer = {
      ...layer,
      id: `L${now}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${layer.name} (salin)`,
      points: newPoints,
      areaM2: polygonAreaPx(newPoints) / (pxPerMeter * pxPerMeter),
      locked: false,
      gsb: layer.gsb ? [...layer.gsb] : undefined,
    };

    // Duplikat garis-garis yang merupakan tepi polygon (kedua ujung berada
    // pada vertex polygon), termasuk lengkung/bezier — pada level yang sama.
    const newLines: Line[] = [];
    for (const ln of lines) {
      if (layer.levelId && ln.levelId !== layer.levelId) continue;
      if (!isVertex(ln.a) || !isVertex(ln.b)) continue;
      newLines.push({
        ...ln,
        a: shift(ln.a),
        b: shift(ln.b),
        c1: ln.c1 ? shift(ln.c1) : undefined,
        c2: ln.c2 ? shift(ln.c2) : undefined,
      });
    }

    pushHistory();
    onChange({ layers: [...layers, newLayer], lines: [...lines, ...newLines] });
    toast.success(`${layer.name} disalin`);
  };

  const toggleLock = (lid: string) => {
    pushHistory();
    onChange({
      layers: layers.map((l) => (l.id === lid ? { ...l, locked: !l.locked } : l)),
    });
  };

  const renameLayer = (lid: string, name: string) => {
    const layer = layers.find((l) => l.id === lid);
    if (!layer) return;
    if (layer.locked) {
      toast.error("Buka kunci dulu untuk mengganti nama");
      return;
    }
    const final = name.trim() || "Ruang";
    if (final === layer.name) return;
    pushHistory();
    const becameVoid = isVoidLayerName(final) && !isVoidLayerName(layer.name);
    let nextLayers = layers.map((l) =>
      l.id === lid
        ? { ...l, name: final, coefficient: isVoidLayerName(final) ? 0 : l.coefficient }
        : l,
    );
    if (becameVoid && layer.points.length >= 3) {
      const voidPts = layer.points;
      const lvlId = layer.levelId;
      const carved: Layer[] = [];
      for (const ly of nextLayers) {
        if (ly.id === lid) { carved.push(ly); continue; }
        const sameLevel = (ly.levelId ?? undefined) === (lvlId ?? undefined);
        if (!sameLevel || isLahanLayerName(ly.name) || isVoidLayerName(ly.name) || ly.points.length < 3) {
          carved.push(ly);
          continue;
        }
        const before = polygonAreaPx(ly.points);
        const result = subtractPolygon(ly.points, voidPts);
        if (!result || result.length < 3) {
          toast.message(`${ly.name} terhapus — tertutup void`);
          continue;
        }
        const after = polygonAreaPx(result);
        if (Math.abs(after - before) < 0.5) { carved.push(ly); continue; }
        carved.push({ ...ly, points: result, areaM2: after / (pxPerMeter * pxPerMeter) });
      }
      nextLayers = carved;
    }
    onChange({ layers: nextLayers });
    if (final.toLowerCase().startsWith("lahan"))
      toast.success(`${final} ditandai sebagai acuan KDB/KLB`);
    else if (becameVoid)
      toast.success(`Void aktif — koefisien 0 & ruang lain dikurangi`);
  };


  const setLayerCoefficient = (lid: string, coef: number) => {
    const layer = layers.find((l) => l.id === lid);
    if (!layer) return;
    if (layer.locked) {
      toast.error("Buka kunci dulu untuk mengubah koefisien");
      return;
    }
    if (layer.coefficient === coef) return;
    pushHistory();
    onChange({
      layers: layers.map((l) => (l.id === lid ? { ...l, coefficient: coef } : l)),
    });
  };

  const setLayerGsbSide = (lid: string, sideIndex: number, meters: number) => {
    const layer = layers.find((l) => l.id === lid);
    if (!layer) return;
    if (layer.locked) {
      toast.error("Buka kunci dulu untuk mengubah GSB");
      return;
    }
    const n = layer.points.length;
    if (n < 1) return;
    const safe = Math.max(0, Number.isFinite(meters) ? meters : 0);
    const next = Array.from({ length: n }, (_, i) =>
      i === sideIndex ? safe : getGsbMeters(layer, i),
    );
    pushHistory();
    onChange({
      layers: layers.map((l) => (l.id === lid ? { ...l, gsb: next } : l)),
    });
  };

  const isLahanName = (n: string) => n.trim().toLowerCase().startsWith("lahan");
  const totalLengthM = lines.reduce((s, l) => s + lineLengthPx(l), 0) / pxPerMeter;
  const totalAreaM2 = layers.reduce((s, l) => s + l.areaM2, 0);
  const lahanLayers = layers.filter((l) => isLahanName(l.name));
  const totalLahanM2 = lahanLayers.reduce((s, l) => s + l.areaM2, 0);

  // Rekapitulasi panel (rendered below canvas in normal mode, inside SidePanel in fullscreen)
  const RekapPanel = (() => {
    const groundLevel = [...levels].sort((a, b) => a.mdpl - b.mdpl)[0];
    const ruangLayers = layers.filter((l) => !isLahanName(l.name) && !isVoidLayerName(l.name));
    const kdbRencana = groundLevel
      ? ruangLayers.filter((l) => l.levelId === groundLevel.id).reduce((s, l) => s + l.areaM2, 0)
      : 0;
    const klbRencana = ruangLayers.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);
    const kdbLimit = (kdbPct ?? 0) > 0 && totalLahanM2 > 0 ? (kdbPct! / 100) * totalLahanM2 : 0;
    const klbLimit = (klbCoef ?? 0) > 0 && totalLahanM2 > 0 ? klbCoef! * totalLahanM2 : 0;
    const kdbDev = kdbRencana - kdbLimit;
    const klbDev = klbRencana - klbLimit;
    const fmt = (v: number) => v.toFixed(2);
    const devNode = (dev: number, hasLimit: boolean) => {
      if (!hasLimit) return <span className="text-muted-foreground">—</span>;
      const over = dev > 0.005;
      const under = dev < -0.005;
      const color = over ? "text-red-500" : under ? "text-green-500" : "text-muted-foreground";
      const sign = over ? "+" : under ? "−" : "";
      return (
        <span className={cn("font-display font-semibold", color)}>
          {sign}
          {fmt(Math.abs(dev))}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
        </span>
      );
    };
    return (
      <div className="rounded-2xl border border-border/60 bg-surface/80 p-4 shadow-soft backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Layers className="h-3.5 w-3.5" /> Rekapitulasi
          </div>
          <span className="text-[11px] text-muted-foreground">
            {layers.length} ruang · {lahanLayers.length} lahan
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {/* Totals */}
          <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Total seluruh ruang
              </span>
              <span className="font-display text-xl font-semibold">
                {totalAreaM2 > 0 ? totalAreaM2.toFixed(2) : "—"}
                <span className="ml-1 text-xs text-muted-foreground">m²</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between rounded-md bg-ember/10 px-2.5 py-2">
              <span className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-ember">
                <MapPin className="h-3 w-3" /> Luas Lahan
              </span>
              <span className="font-display text-2xl font-semibold text-ember">
                {totalLahanM2 > 0 ? totalLahanM2.toFixed(2) : "—"}
                <span className="ml-1 text-xs text-muted-foreground">m²</span>
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Acuan KDB/KLB. Atur ruang langsung dari sub-gambar pada panel Level.
            </p>
          </div>

          {/* KDB */}
          <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">KDB</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  placeholder="0"
                  value={kdbPct ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange({ kdbPct: v === "" ? undefined : Math.max(0, Math.min(100, Number(v))) });
                  }}
                  className="h-7 w-16 text-right text-xs"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-muted-foreground">Maksimum (KDB × Lahan)</span>
              <span className="font-display text-sm font-semibold">
                {kdbLimit > 0 ? fmt(kdbLimit) : "—"}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-muted-foreground">KDB Rencana (Level dasar)</span>
              <span className="font-display text-sm font-semibold">
                {kdbRencana > 0 ? fmt(kdbRencana) : "—"}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-border/40 pt-1.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Deviasi</span>
              {devNode(kdbDev, kdbLimit > 0)}
            </div>
          </div>

          {/* KLB */}
          <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">KLB</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  placeholder="0"
                  value={klbCoef ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange({ klbCoef: v === "" ? undefined : Math.max(0, Number(v)) });
                  }}
                  className="h-7 w-16 text-right text-xs"
                />
                <span className="text-xs text-muted-foreground">×</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-muted-foreground">Maksimum (KLB × Lahan)</span>
              <span className="font-display text-sm font-semibold">
                {klbLimit > 0 ? fmt(klbLimit) : "—"}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
              </span>
      </div>

      <GeoPanel geo={sketch.geo} onChange={(g) => onChange({ geo: g })} />


            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-muted-foreground">KLB Rencana (semua level × koef)</span>
              <span className="font-display text-sm font-semibold">
                {klbRencana > 0 ? fmt(klbRencana) : "—"}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-border/40 pt-1.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Deviasi</span>
              {devNode(klbDev, klbLimit > 0)}
            </div>
          </div>
        </div>
      </div>
    );
  })();

  // Side panel content (reused for normal and fullscreen)
  const hideSideExtras = fullscreen && sideMinimized;
  const SidePanel = (
    <aside
      className={cn(
        "rounded-2xl border border-border/60 bg-surface/80 shadow-soft backdrop-blur",
        fullscreen ? "flex flex-col overflow-hidden" : "",
        fullscreen && !sideMinimized && "max-h-[calc(100vh-40px)]",
      )}
    >
      {fullscreen && (
        <div
          {...sideDragHandlers}
          className="flex cursor-move touch-none select-none items-center justify-between gap-2 border-b border-border/60 px-3 py-2"
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <GripHorizontal className="h-3.5 w-3.5" /> Panel Gambar
          </div>
          <Button
            data-no-drag
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setSideMinimized((v) => !v)}
            title={sideMinimized ? "Perbesar panel" : "Minimalkan panel"}
          >
            {sideMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
      <div className={cn("space-y-5", fullscreen ? "overflow-y-auto p-4" : "p-5")}>


      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Skala</Label>
        <Select value={scale} onValueChange={(v) => onChange({ scale: v as Scale })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1:100">1 : 100 (1 kotak besar = 1 m)</SelectItem>
            <SelectItem value="1:200">1 : 200 (1 kotak besar = 2 m)</SelectItem>
            <SelectItem value="1:500">1 : 500 (1 kotak besar = 5 m)</SelectItem>
            <SelectItem value="1:1000">1 : 1000 (1 kotak besar = 10 m)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Fungsi</Label>
        <Select value={fungsi ?? ""} onValueChange={(v) => onChange({ fungsi: v || undefined })}>
          <SelectTrigger>
            <SelectValue placeholder="Pilih fungsi bangunan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Hotel">Hotel</SelectItem>
            <SelectItem value="Apartment">Apartment</SelectItem>
            <SelectItem value="Komersil">Komersil</SelectItem>
            <SelectItem value="Rumah Sakit">Rumah Sakit</SelectItem>
            <SelectItem value="Bandara">Bandara</SelectItem>
            <SelectItem value="Bangunan Khusus">Bangunan Khusus</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Arah Utara</Label>
        <div className="flex items-center gap-3 rounded-md border border-border/60 bg-background/40 p-2.5">
          <CompassMarker rotation={northRotation} size={56} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                step="1"
                value={Number.isFinite(northRotation) ? northRotation : 0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  onChange({ northRotation: Number.isFinite(v) ? v : 0 });
                }}
                className="h-8 text-sm"
              />
              <span className="text-xs text-muted-foreground">°</span>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-6 flex-1 px-1 text-[10px]"
                onClick={() => onChange({ northRotation: ((northRotation - 15) % 360 + 360) % 360 })}>−15°</Button>
              <Button variant="outline" size="sm" className="h-6 flex-1 px-1 text-[10px]"
                onClick={() => onChange({ northRotation: 0 })}>0°</Button>
              <Button variant="outline" size="sm" className="h-6 flex-1 px-1 text-[10px]"
                onClick={() => onChange({ northRotation: ((northRotation + 15) % 360 + 360) % 360 })}>+15°</Button>
            </div>
          </div>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          0° = utara ke atas. Rotasi searah jarum jam. Muncul di kanan bawah tiap denah pada slide.
        </p>
      </div>



      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Alat</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={tool === "line" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("line"); }}
            className={cn(tool === "line" && "bg-gradient-ember shadow-ember")}
          >
            <Pencil className="mr-1.5 h-4 w-4" /> Garis
          </Button>
          <Button
            variant={tool === "rect" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("rect"); }}
            className={cn(tool === "rect" && "bg-gradient-ember shadow-ember")}
          >
            <Square className="mr-1.5 h-4 w-4" /> Persegi
          </Button>
          <Button
            variant={tool === "polyline" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setPolyDraft(null); setTool("polyline"); }}
            className={cn(tool === "polyline" && "bg-gradient-ember shadow-ember")}
          >
            <Waypoints className="mr-1.5 h-4 w-4" /> Polyline
          </Button>
          <Button
            variant={tool === "edit" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("edit"); }}
            className={cn(tool === "edit" && "bg-gradient-ember shadow-ember")}
          >
            <Move className="mr-1.5 h-4 w-4" /> Edit Titik
          </Button>
          <Button
            variant={tool === "erase" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("erase"); }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Hapus
          </Button>
          <Button
            variant={tool === "section" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("section"); }}
            className={cn("col-span-2", tool === "section" && "bg-gradient-ember shadow-ember")}
            title="Tarik satu garis lurus di kanvas untuk menentukan bidang irisan. Slide potongan akan otomatis dibuat."
          >
            <Scissors className="mr-1.5 h-4 w-4" /> Garis Potong
          </Button>
        </div>
        {tool === "polyline" && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Tarik stylus tanpa jeda. Setiap belokan menjadi titik baru. Lepas stylus untuk berhenti, atau kembali ke titik awal untuk menutup polygon.
          </p>
        )}
        {tool === "rect" && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Tarik diagonal untuk membentuk persegi/persegi panjang. Ruang otomatis terbentuk.
          </p>
        )}
        {tool === "section" && (
          <div className="space-y-1.5">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Tarik satu garis lurus untuk menentukan bidang irisan. Anak panah menunjukkan arah pandang (ke kanan dari A → A'). Lepas stylus untuk menyimpan — slide
              <span className="font-medium text-foreground"> Potongan Prinsip Skematik A-A</span> otomatis dibuat tepat setelah slide denah.
            </p>
            {sketch.sectionCut && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full text-[11px]"
                onClick={() => onChange({ sectionCut: undefined })}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Hapus garis potong
              </Button>
            )}
          </div>
        )}

        {tool === "edit" && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-4 gap-1.5">
              <Button
                variant={editMode === "move" ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode("move")}
                className={cn("h-8 px-1.5 text-[11px]", editMode === "move" && "bg-foreground text-background")}
                title="Geser titik yang sudah ada"
              >
                <Move className="mr-1 h-3.5 w-3.5" /> Geser
              </Button>
              <Button
                variant={editMode === "addPoint" ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode("addPoint")}
                className={cn("h-8 px-1.5 text-[11px]", editMode === "addPoint" && "bg-foreground text-background")}
                title="Tambah titik baru di sepanjang garis"
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Tambah
              </Button>
              <Button
                variant={editMode === "fillet" ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode("fillet")}
                className={cn("h-8 px-1.5 text-[11px]", editMode === "fillet" && "bg-foreground text-background")}
                title="Bulatkan (fillet) sudut pada titik"
              >
                <Spline className="mr-1 h-3.5 w-3.5" /> Fillet
              </Button>
              <Button
                variant={editMode === "delete" ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode("delete")}
                className={cn("h-8 px-1.5 text-[11px]", editMode === "delete" && "bg-destructive text-destructive-foreground")}
                title="Hapus titik atau edge pada level aktif"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Hapus
              </Button>
            </div>
            {editMode === "fillet" && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2 py-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Radius
                </span>
                <Input
                  type="number"
                  step="0.1"
                  min="0.05"
                  value={filletRadiusM}
                  onChange={(e) => setFilletRadiusM(Math.max(0.05, parseFloat(e.target.value) || 0.05))}
                  className="h-7 w-20 text-xs"
                />
                <span className="text-[11px] text-muted-foreground">m</span>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {editMode === "move"
                ? "Tarik titik (vertex) pada level aktif ke posisi baru. Titik terkunci tidak dapat digeser."
                : editMode === "addPoint"
                  ? "Ketuk di sepanjang garis lurus pada level aktif untuk menambah titik baru."
                  : editMode === "fillet"
                    ? "Ketuk titik pada sudut poligon untuk membulatkannya dengan radius di atas. Radius otomatis diperkecil bila sisi terlalu pendek."
                    : "Ketuk titik untuk menghapusnya, atau ketuk edge (termasuk yang sudah tidak terhitung) untuk menghapus garis. Hanya berlaku pada level aktif."}
            </p>
          </div>
        )}
        {tool === "line" && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Jenis garis
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                variant={lineKind === "straight" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  cancelPendingCurve();
                  setLineKind("straight");
                }}
                className={cn("h-8 px-2 text-[11px]", lineKind === "straight" && "bg-foreground text-background")}
                title="Garis lurus"
              >
                <Minus className="mr-1 h-3.5 w-3.5" /> Lurus
              </Button>
              <Button
                variant={lineKind === "arc" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  cancelPendingCurve();
                  setLineKind("arc");
                }}
                className={cn("h-8 px-2 text-[11px]", lineKind === "arc" && "bg-foreground text-background")}
                title="Lengkung sempurna dengan radius otomatis"
              >
                <Spline className="mr-1 h-3.5 w-3.5" /> Lengkung
              </Button>
              <Button
                variant={lineKind === "bezier" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  cancelPendingCurve();
                  setLineKind("bezier");
                }}
                className={cn("h-8 px-2 text-[11px]", lineKind === "bezier" && "bg-foreground text-background")}
                title="Lengkung dengan dua tangent yang dapat disesuaikan di kedua ujung"
              >
                <PenTool className="mr-1 h-3.5 w-3.5" /> Tangent
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {lineKind === "straight" && "Tarik dua titik untuk membuat garis lurus."}
              {lineKind === "arc" && "Tarik dua titik — lengkung otomatis tegak lurus tali busur."}
              {lineKind === "bezier" && "Tarik dua titik, lalu geser dua handle tangent, tekan Selesai."}
            </p>
          </div>
        )}
        {pendingCurve && (
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={commitPendingCurve} className="bg-gradient-ember shadow-ember">
              <Check className="mr-1.5 h-4 w-4" /> Selesai
            </Button>
            <Button size="sm" variant="outline" onClick={cancelPendingCurve}>
              <X className="mr-1.5 h-4 w-4" /> Batal
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={handleUndo} disabled={!past.length}>
            <Undo2 className="mr-1.5 h-4 w-4" /> Undo
          </Button>
          <Button variant="outline" size="sm" onClick={handleRedo} disabled={!future.length}>
            <Redo2 className="mr-1.5 h-4 w-4" /> Redo
          </Button>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">
            Zoom <span className="font-display font-semibold text-foreground">{Math.round(view.s * 100)}%</span>
            <span className="mx-1.5">·</span>
            Rotasi <span className="font-display font-semibold text-foreground">{Math.round((view.r * 180) / Math.PI)}°</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={resetView}
            disabled={view.s === 1 && view.r === 0 && view.tx === 0 && view.ty === 0}
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Tablet: cubit 2 jari untuk zoom, putar 2 jari untuk rotasi kanvas.
        </p>
      </div>

      {!hideSideExtras && (
        <>
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Magnet className="h-4 w-4 text-ember" />
              <div>
                <div className="text-sm font-medium">Snap to Grid</div>
                <div className="text-[11px] text-muted-foreground">Kunci titik ke garis kotak</div>
              </div>
            </div>
            <Switch checked={snap} onCheckedChange={(v) => onChange({ snap: v })} />
          </div>

          <LevelsPanel
            levels={levels}
            activeLevelId={activeLvlId}
            onSetActive={setActiveLevel}
            onAdd={addLevel}
            onRename={renameLevel}
            onMdpl={updateLevelMdpl}
            onOpacity={updateLevelOpacity}
            onDelete={deleteLevel}
            onDuplicate={duplicateLevel}
            onIncrementTypical={incrementTypical}
            onSetTypical={setLevelTypical}
            onSetTypicalHeight={setLevelTypicalHeight}
            onRenameLayer={renameLayer}
            onToggleLockLayer={toggleLock}
            onRemoveLayer={removeLayer}
            onDuplicateLayer={duplicateLayer}
            onSetLayerCoefficient={setLayerCoefficient}
            onSetLayerGsb={setLayerGsbSide}
            lines={lines}
            layers={layers}
          />

          <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/40 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Ruler className="h-3.5 w-3.5" /> Garis
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Jumlah</span>
              <span className="font-display text-base font-semibold">{lines.length}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Panjang</span>
              <span className="font-display text-base font-semibold">{totalLengthM.toFixed(2)} m</span>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Tip: kunci layer (ikon gembok) agar tidak terhapus saat memakai alat Hapus. Progres
            tersimpan otomatis.
          </p>
        </>
      )}
      
      </div>
    </aside>
  );


  if (fullscreen) {
    return (
      <div className="relative h-screen w-screen overflow-hidden bg-background">
        <div ref={wrapRef} className="absolute inset-0">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={() => setHover(null)}
            className={cn(
              "block touch-none select-none",
              tool === "line" || tool === "rect" || tool === "polyline" || tool === "section" ? "cursor-crosshair" : tool === "edit" ? "cursor-move" : "cursor-pointer",
            )}
          />
          <div className="pointer-events-none absolute bottom-4 right-4 rounded-md bg-background/85 p-1.5 shadow-soft backdrop-blur">
            <CompassMarker rotation={northRotation} size={72} />
          </div>
        </div>

        {/* Top-left controls: escape, undo, redo */}
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-border/60 bg-background/85 p-1.5 shadow-soft backdrop-blur">
          <Button
            variant="ghost"
            size="sm"
            onClick={onExitFullscreen}
            title="Keluar layar penuh (Esc)"
          >
            <X className="mr-1.5 h-4 w-4" /> Esc
          </Button>
          <div className="h-6 w-px bg-border/60" />
          <Button variant="ghost" size="sm" onClick={handleUndo} disabled={!past.length} title="Undo">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleRedo} disabled={!future.length} title="Redo">
            <Redo2 className="h-4 w-4" />
          </Button>
          <div className="h-6 w-px bg-border/60" />
          <Button
            variant={tool === "line" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("line"); }}
            className={cn(tool === "line" && "bg-gradient-ember shadow-ember")}
            title="Garis"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "rect" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("rect"); }}
            className={cn(tool === "rect" && "bg-gradient-ember shadow-ember")}
            title="Persegi (tarik diagonal)"
          >
            <Square className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "polyline" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setPolyDraft(null); setTool("polyline"); }}
            className={cn(tool === "polyline" && "bg-gradient-ember shadow-ember")}
            title="Polyline (tarik tanpa jeda, berbelok = titik baru)"
          >
            <Waypoints className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "edit" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("edit"); }}
            className={cn(tool === "edit" && "bg-gradient-ember shadow-ember")}
            title="Edit titik (geser vertex)"
          >
            <Move className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "erase" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("erase"); }}
            title="Hapus"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "section" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("section"); }}
            className={cn(tool === "section" && "bg-gradient-ember shadow-ember")}
            title="Garis Potong A-A (tarik satu garis → slide potongan dibuat)"
          >
            <Scissors className="h-4 w-4" />
          </Button>
          {tool === "edit" && (
            <>
              <div className="h-6 w-px bg-border/60" />
              <Button
                variant={editMode === "move" ? "default" : "ghost"}
                size="sm"
                onClick={() => setEditMode("move")}
                title="Geser titik"
              >
                <Move className="h-4 w-4" />
              </Button>
              <Button
                variant={editMode === "addPoint" ? "default" : "ghost"}
                size="sm"
                onClick={() => setEditMode("addPoint")}
                title="Tambah titik di sepanjang garis"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </>
          )}
          {tool === "line" && (
            <>
              <div className="h-6 w-px bg-border/60" />
              <Button
                variant={lineKind === "straight" ? "default" : "ghost"}
                size="sm"
                onClick={() => { cancelPendingCurve(); setLineKind("straight"); }}
                title="Garis lurus"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Button
                variant={lineKind === "arc" ? "default" : "ghost"}
                size="sm"
                onClick={() => { cancelPendingCurve(); setLineKind("arc"); }}
                title="Lengkung sempurna (radius otomatis)"
              >
                <Spline className="h-4 w-4" />
              </Button>
              <Button
                variant={lineKind === "bezier" ? "default" : "ghost"}
                size="sm"
                onClick={() => { cancelPendingCurve(); setLineKind("bezier"); }}
                title="Lengkung dengan dua tangent"
              >
                <PenTool className="h-4 w-4" />
              </Button>
            </>
          )}
          {pendingCurve && (
            <>
              <div className="h-6 w-px bg-border/60" />
              <Button size="sm" onClick={commitPendingCurve} className="bg-gradient-ember shadow-ember">
                <Check className="mr-1 h-4 w-4" /> Selesai
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelPendingCurve}>
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
          <div className="h-6 w-px bg-border/60" />
          <Button
            variant="ghost"
            size="sm"
            onClick={resetView}
            title="Reset zoom & rotasi"
            disabled={view.s === 1 && view.r === 0 && view.tx === 0 && view.ty === 0}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            {Math.round(view.s * 100)}%
          </Button>
        </div>

        {/* Scale tag */}
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-background/80 px-2.5 py-1 font-display text-xs font-semibold text-foreground shadow-soft backdrop-blur">
          {sketch.title} · Skala {scale} · 1 kotak besar = {METERS_PER_MAJOR[scale]} m
        </div>

        {/* Floating draggable side panel on the right */}
        <div
          className="absolute right-4 top-4 z-10 w-[340px] max-w-[90vw]"
          style={{ transform: `translate(${sideOffset.x}px, ${sideOffset.y}px)` }}
        >
          {SidePanel}
        </div>

        {/* Floating Rekapitulasi: full bar (draggable) when expanded, small button (draggable) when minimized */}
        {!rekapMinimized ? (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex justify-center">
            <div
              className="pointer-events-auto w-full max-w-[1100px] rounded-2xl border border-border/60 bg-background/85 p-2 shadow-elevated backdrop-blur"
              style={{ transform: `translate(${rekapOffset.x}px, ${rekapOffset.y}px)` }}
            >
              <div
                {...rekapDragHandlers}
                className="flex cursor-move touch-none select-none items-center justify-between gap-2 px-2 py-1"
              >
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <GripHorizontal className="h-3.5 w-3.5" />
                  <Layers className="h-3.5 w-3.5" /> Rekapitulasi
                </div>
                <Button
                  data-no-drag
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setRekapMinimized(true)}
                  title="Minimalkan"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="px-1 pb-1">{RekapPanel}</div>
            </div>
          </div>
        ) : (
          <div
            className="absolute bottom-4 left-4 z-10"
            style={{ transform: `translate(${rekapBtnOffset.x}px, ${rekapBtnOffset.y}px)` }}
          >
            <div
              {...rekapBtnDragHandlers}
              className="flex cursor-move touch-none select-none items-center gap-1.5 rounded-full border border-border/60 bg-background/85 px-2 py-1 shadow-soft backdrop-blur"
            >
              <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              <Button
                data-no-drag
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => setRekapMinimized(false)}
                title="Tampilkan rekapitulasi"
              >
                <Layers className="h-3.5 w-3.5" /> Rekapitulasi
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-5">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div
          ref={wrapRef}
          className="relative h-[70vh] min-h-[460px] overflow-hidden rounded-2xl border border-border/60 bg-surface/40 shadow-soft"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={() => setHover(null)}
            className={cn(
              "block touch-none select-none",
              tool === "line" || tool === "rect" || tool === "polyline" || tool === "section" ? "cursor-crosshair" : tool === "edit" ? "cursor-move" : "cursor-pointer",
            )}
          />
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/80 px-2.5 py-1 font-display text-xs font-semibold text-foreground shadow-soft backdrop-blur">
            Skala {scale} • 1 kotak besar = {METERS_PER_MAJOR[scale]} m
          </div>
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-background/85 p-1.5 shadow-soft backdrop-blur">
            <CompassMarker rotation={northRotation} size={64} />
          </div>
        </div>
        {SidePanel}
      </div>
      {RekapPanel}
    </div>
  );
}

// ============================================================
// LevelsPanel — manages level groups (rename, MDPL, opacity)
// ============================================================

function LevelsPanel({
  levels,
  activeLevelId,
  onSetActive,
  onAdd,
  onRename,
  onMdpl,
  onOpacity,
  onDelete,
  onDuplicate,
  onIncrementTypical,
  onSetTypical,
  onSetTypicalHeight,
  onRenameLayer,
  onToggleLockLayer,
  onRemoveLayer,
  onDuplicateLayer,
  onSetLayerCoefficient,
  onSetLayerGsb,
  lines,
  layers,
}: {
  levels: Level[];
  activeLevelId: string | null;
  onSetActive: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onMdpl: (id: string, mdpl: number) => void;
  onOpacity: (id: string, opacity: number) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onIncrementTypical: (id: string) => void;
  onSetTypical: (id: string, count: number) => void;
  onSetTypicalHeight: (id: string, meters: number) => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggleLockLayer: (id: string) => void;
  onRemoveLayer: (id: string) => void;
  onDuplicateLayer: (id: string) => void;
  onSetLayerCoefficient: (id: string, coef: number) => void;
  onSetLayerGsb: (id: string, sideIndex: number, meters: number) => void;
  lines: Line[];
  layers: Layer[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [mdplDrafts, setMdplDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [gsbOpen, setGsbOpen] = useState<Record<string, boolean>>({});
  const [gsbDrafts, setGsbDrafts] = useState<Record<string, string>>({});
  const [layerEditId, setLayerEditId] = useState<string | null>(null);
  const [layerDraft, setLayerDraft] = useState("");
  const [typicalDrafts, setTypicalDrafts] = useState<Record<string, string>>({});
  const isLahanName = (n: string) => n.trim().toLowerCase().startsWith("lahan");

  const displayNames = computeLevelDisplayNames(levels);
  const sorted = [...levels].sort((a, b) => b.mdpl - a.mdpl); // tertinggi di atas

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Layers className="h-3.5 w-3.5" /> Level
        </div>
        <span className="text-[11px] text-muted-foreground">
          {levels.length} level · urut MDPL ↓
        </span>
      </div>

      <ul className="space-y-2">
        {sorted.map((lvl) => {
          const isActive = lvl.id === activeLevelId;
          const editing = editingId === lvl.id;
          const subLayers = layers.filter((ly) => ly.levelId === lvl.id);
          const lineCount = lines.filter((ln) => ln.levelId === lvl.id).length;
          const layerCount = subLayers.length;
          const mdplDraft = mdplDrafts[lvl.id];
          const isOpen = !!expanded[lvl.id];
          const hasSubs = layerCount > 0;
          // Tinggi 1 item sub kira-kira 36px; batasi area visual ke 5 item
          const SUB_ITEM_PX = 36;
          const MAX_VISIBLE = 5;
          const needsScroll = layerCount > MAX_VISIBLE;
          return (
            <li
              key={lvl.id}
              className={cn(
                "rounded-md border px-2.5 py-2 transition",
                isActive
                  ? "border-ember bg-ember/10 ring-1 ring-ember/40"
                  : "border-border/50 bg-background/60",
              )}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setExpanded((e) => ({ ...e, [lvl.id]: !e[lvl.id] }))
                  }
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition",
                    hasSubs
                      ? "border-border/60 bg-background/60 text-foreground hover:border-ember hover:text-ember"
                      : "cursor-not-allowed border-border/40 bg-background/30 text-muted-foreground/40",
                  )}
                  aria-label={isOpen ? "Sembunyikan sub" : "Tampilkan sub"}
                  title={
                    !hasSubs
                      ? "Belum ada sub-gambar di level ini"
                      : isOpen
                        ? "Sembunyikan sub-gambar"
                        : "Tampilkan sub-gambar"
                  }
                  disabled={!hasSubs}
                >
                  {isOpen ? (
                    <Minus className="h-3 w-3" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                </button>
                <button
                  onClick={() => onSetActive(lvl.id)}
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-full border-2 transition",
                    isActive ? "border-ember bg-ember" : "border-foreground/30 bg-background hover:border-ember",
                  )}
                  aria-label={isActive ? "Level aktif" : "Aktifkan level"}
                  title={isActive ? "Level aktif" : "Klik untuk aktifkan"}
                />

                {editing ? (
                  <Input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => {
                      onRename(lvl.id, draftName);
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRename(lvl.id, draftName);
                        setEditingId(null);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-7 text-sm"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(lvl.id);
                      setDraftName(displayNames[lvl.id] ?? lvl.name);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-ember"
                    title="Klik untuk ganti nama"
                  >
                    {displayNames[lvl.id] ?? lvl.name}
                    {(lvl.typicalCount ?? 1) > 1 && (
                      <span className="ml-1 rounded bg-ember/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ember">
                        tipikal {lvl.typicalCount}×
                      </span>
                    )}
                  </button>
                )}
                <button
                  onClick={() => onDuplicate(lvl.id)}
                  className="shrink-0 text-muted-foreground transition hover:text-ember"
                  aria-label="Duplikat level"
                  title="Duplikat: buat level baru dengan salinan sub-gambar (dapat diedit terpisah)"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onIncrementTypical(lvl.id)}
                  className="shrink-0 rounded px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition hover:bg-ember/10 hover:text-ember"
                  aria-label="Tambah lantai tipikal"
                  title="Tipikal: gandakan luas + koefisien lantai ini (+3 m MDPL per tambahan)"
                >
                  +tip
                </button>
                <button
                  onClick={() => onDelete(lvl.id)}
                  className="shrink-0 text-muted-foreground transition hover:text-ember"
                  aria-label="Hapus level"
                  title="Hapus level beserta gambarnya"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Label
                  htmlFor={`mdpl-${lvl.id}`}
                  className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  MDPL
                </Label>
                <Input
                  id={`mdpl-${lvl.id}`}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={mdplDraft ?? String(lvl.mdpl)}
                  onChange={(e) =>
                    setMdplDrafts((d) => ({ ...d, [lvl.id]: e.target.value }))
                  }
                  onBlur={() => {
                    const v = parseFloat(mdplDraft ?? "");
                    if (Number.isFinite(v)) onMdpl(lvl.id, v);
                    setMdplDrafts((d) => {
                      const n = { ...d };
                      delete n[lvl.id];
                      return n;
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-7 w-20 text-sm"
                />
                <span className="text-[11px] text-muted-foreground">m</span>
                {(lvl.typicalCount ?? 1) > 1 && (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-ember/80">×</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      step={1}
                      value={typicalDrafts[lvl.id] ?? String(lvl.typicalCount ?? 1)}
                      onChange={(e) =>
                        setTypicalDrafts((d) => ({ ...d, [lvl.id]: e.target.value }))
                      }
                      onBlur={() => {
                        const v = parseInt(typicalDrafts[lvl.id] ?? "", 10);
                        if (Number.isFinite(v)) onSetTypical(lvl.id, v);
                        setTypicalDrafts((d) => {
                          const n = { ...d };
                          delete n[lvl.id];
                          return n;
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="h-7 w-14 text-sm text-ember"
                      title="Jumlah lantai tipikal — luas & koefisien dikalikan nilai ini"
                    />
                    <span className="text-[10px] text-ember/80">tip</span>
                    <span className="text-[10px] text-ember/80">@</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0.1}
                      max={99}
                      step={0.1}
                      value={typicalDrafts[`${lvl.id}__h`] ?? String(tipicalHeightOf(lvl))}
                      onChange={(e) =>
                        setTypicalDrafts((d) => ({ ...d, [`${lvl.id}__h`]: e.target.value }))
                      }
                      onBlur={() => {
                        const v = parseFloat(typicalDrafts[`${lvl.id}__h`] ?? "");
                        if (Number.isFinite(v) && v > 0) onSetTypicalHeight(lvl.id, v);
                        setTypicalDrafts((d) => {
                          const n = { ...d };
                          delete n[`${lvl.id}__h`];
                          return n;
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="h-7 w-16 text-sm text-ember"
                      title="Tinggi tiap lantai tipikal (m)"
                    />
                    <span className="text-[10px] text-ember/80">m/lt</span>
                  </>
                )}
                <span
                  className="ml-auto font-display text-[11px] font-semibold text-foreground"
                  title="Total luas ruang di level ini (tanpa lahan, sudah dikalikan koefisien dan jumlah tipikal)"
                >
                  {(subLayers
                    .filter((ly) => !isLahanName(ly.name))
                    .reduce((s, ly) => s + ly.areaM2 * (ly.coefficient ?? 1), 0) * (lvl.typicalCount ?? 1))
                    .toFixed(2)}
                  <span className="ml-0.5 text-[9px] font-normal text-muted-foreground">m² ruang</span>
                </span>
              </div>


              {!isActive && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Opasitas saat tidak aktif</span>
                    <span className="font-display text-[11px] font-semibold text-foreground">
                      {Math.round(lvl.opacity * 100)}%
                    </span>
                  </div>
                  <Slider
                    value={[Math.round(lvl.opacity * 100)]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={(v) => onOpacity(lvl.id, (v[0] ?? 0) / 100)}
                  />
                </div>
              )}

              {isOpen && hasSubs && (
                <div className="mt-2 border-t border-border/40 pt-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>Sub-gambar</span>
                    <span>{layerCount} ruang</span>
                  </div>
                  <div
                    className={cn(
                      "rounded-md bg-background/40 pr-1",
                      needsScroll && "sketch-sub-scroll overflow-y-auto",
                    )}
                    style={
                      needsScroll
                        ? { maxHeight: `${MAX_VISIBLE * SUB_ITEM_PX}px` }
                        : undefined
                    }
                  >
                    <ul className="space-y-1 pl-1">
                      {subLayers.map((sl) => {
                        const lahan = isLahanName(sl.name);
                        const editing = layerEditId === sl.id;
                        const commit = () => {
                          onRenameLayer(sl.id, layerDraft);
                          setLayerEditId(null);
                        };
                        return (
                          <li
                            key={sl.id}
                            className={cn(
                              "rounded px-1.5 py-1 text-[12px] hover:bg-background/60",
                              lahan && "bg-ember/5",
                              sl.locked && "ring-1 ring-foreground/15",
                            )}
                            title={sl.name}
                          >
                            <div className="flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-sm border border-foreground/20"
                              style={{ background: sl.color.replace("ALPHA", "0.9") }}
                            />
                            {editing ? (
                              <Input
                                autoFocus
                                value={layerDraft}
                                onChange={(e) => setLayerDraft(e.target.value)}
                                onBlur={commit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commit();
                                  if (e.key === "Escape") setLayerEditId(null);
                                }}
                                className="h-6 flex-1 text-xs"
                              />
                            ) : (
                              <button
                                onClick={() => {
                                  if (sl.locked) return;
                                  setLayerEditId(sl.id);
                                  setLayerDraft(sl.name);
                                }}
                                className="flex min-w-0 flex-1 items-center gap-1 truncate text-left hover:text-ember"
                                title={sl.locked ? "Buka kunci untuk ganti nama" : "Klik untuk ganti nama"}
                              >
                                {lahan && <MapPin className="h-3 w-3 shrink-0 text-ember" />}
                                <span className="truncate">{sl.name}</span>
                              </button>
                            )}
                            <Select
                              value={String(sl.coefficient ?? 1)}
                              onValueChange={(v) =>
                                onSetLayerCoefficient(sl.id, parseFloat(v))
                              }
                              disabled={sl.locked}
                            >
                              <SelectTrigger
                                className="h-6 w-[58px] shrink-0 px-1.5 py-0 text-[10px]"
                                title="Koefisien pengali luas"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1">×1</SelectItem>
                                <SelectItem value="0.5">×0,5</SelectItem>
                                <SelectItem value="0">×0</SelectItem>
                              </SelectContent>
                            </Select>
                            <span
                              className="shrink-0 font-display text-[11px] font-semibold text-muted-foreground"
                              title={`Luas asli ${sl.areaM2.toFixed(2)} m² · efektif ${(sl.areaM2 * (sl.coefficient ?? 1)).toFixed(2)} m²`}
                            >
                              {(sl.areaM2 * (sl.coefficient ?? 1)).toFixed(1)}
                              <span className="ml-0.5 text-[9px] font-normal">m²</span>
                            </span>
                            <button
                              onClick={() => onDuplicateLayer(sl.id)}
                              className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-ember/10 hover:text-ember"
                              aria-label="Salin ruang"
                              title="Salin ruang (digeser 1 m)"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => onToggleLockLayer(sl.id)}
                              className={cn(
                                "shrink-0 rounded p-0.5 transition",
                                sl.locked
                                  ? "text-ember hover:bg-ember/10"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                              aria-label={sl.locked ? "Buka kunci" : "Kunci layer"}
                              title={sl.locked ? "Buka kunci" : "Kunci layer agar aman dari hapus"}
                            >
                              {sl.locked ? (
                                <Lock className="h-3 w-3" />
                              ) : (
                                <LockOpen className="h-3 w-3" />
                              )}
                            </button>
                            {editing ? (
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={commit}
                                className="shrink-0 text-ember"
                                aria-label="Simpan nama"
                              >
                                <Check className="h-3 w-3" />
                              </button>
                            ) : (
                              <button
                                onClick={() => onRemoveLayer(sl.id)}
                                disabled={sl.locked}
                                className={cn(
                                  "shrink-0 transition",
                                  sl.locked
                                    ? "cursor-not-allowed text-muted-foreground/40"
                                    : "text-muted-foreground hover:text-ember",
                                )}
                                aria-label="Hapus layer"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                            </div>
                            {lahan && sl.points.length >= 3 && (() => {
                              const open = !!gsbOpen[sl.id];
                              const n = sl.points.length;
                              return (
                                <div className="mt-1 rounded-sm border border-dashed border-ember/40 bg-background/40">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setGsbOpen((s) => ({ ...s, [sl.id]: !s[sl.id] }))
                                    }
                                    className="flex w-full items-center justify-between px-1.5 py-1 text-[10px] uppercase tracking-wider text-ember/90 hover:text-ember"
                                    title="Atur GSB tiap sisi (offset ke dalam)"
                                  >
                                    <span className="flex items-center gap-1">
                                      {open ? (
                                        <Minus className="h-2.5 w-2.5" />
                                      ) : (
                                        <Plus className="h-2.5 w-2.5" />
                                      )}
                                      GSB · {n} sisi
                                    </span>
                                    <span className="text-[10px] normal-case text-muted-foreground">
                                      default {DEFAULT_GSB_M}m
                                    </span>
                                  </button>
                                  {open && (
                                    <div className="grid grid-cols-2 gap-1 px-1.5 pb-1.5">
                                      {Array.from({ length: n }, (_, i) => {
                                        const key = `${sl.id}_${i}`;
                                        const cur = getGsbMeters(sl, i);
                                        const draft = gsbDrafts[key];
                                        return (
                                          <div
                                            key={key}
                                            className="flex items-center gap-1 rounded bg-background/60 px-1 py-0.5"
                                          >
                                            <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                                              GSB {i + 1}
                                            </span>
                                            <Input
                                              type="number"
                                              inputMode="decimal"
                                              step="0.1"
                                              min="0"
                                              disabled={sl.locked}
                                              value={draft ?? String(cur)}
                                              onChange={(e) =>
                                                setGsbDrafts((d) => ({
                                                  ...d,
                                                  [key]: e.target.value,
                                                }))
                                              }
                                              onBlur={() => {
                                                const v = parseFloat(draft ?? "");
                                                if (Number.isFinite(v) && v !== cur) {
                                                  onSetLayerGsb(sl.id, i, v);
                                                }
                                                setGsbDrafts((d) => {
                                                  const nx = { ...d };
                                                  delete nx[key];
                                                  return nx;
                                                });
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter")
                                                  (e.target as HTMLInputElement).blur();
                                              }}
                                              className="h-5 px-1 py-0 text-[11px]"
                                            />
                                            <span className="text-[10px] text-muted-foreground">m</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </li>

          );
        })}
      </ul>

      <button
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-ember/60 hover:bg-ember/5 hover:text-ember"
      >
        <Plus className="h-3.5 w-3.5" /> Tambah Level
      </button>
    </div>
  );
}
