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
  Download,
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
  ClipboardPaste,
  Waypoints,
  Scissors,
  Grid3x3,
  Paintbrush,
  DoorOpen,
  Circle as CircleIcon,
  Crop,
  MoveHorizontal,
  Box as BoxIcon,
  FlipHorizontal,
  Car,
  RotateCw,
  SplitSquareHorizontal,
} from "lucide-react";
import {
  type Floor,
  type FloorMode,
  FLOOR_THICKNESS_MM,
  findCycleThroughSegment,
  genFloorId,
  pointToSegmentDist,
  polygonAreaPx as floorPolyArea,
  polygonCentroid as floorPolyCentroid,
  pointInPolygon as floorPointInPolygon,
} from "@/lib/floors";
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
import { colorForRoomName } from "@/lib/room-color";
import { toast } from "sonner";
import { ClusterGeneratorDialog, type ClusterGraph, type GenerateResult } from "@/components/cluster-generator-dialog";
import { MasterplanClusterDialog } from "@/components/masterplan-cluster-dialog";
import { loadPlan as loadMpPlan, savePlan as saveMpPlan, blockPolygon as mpBlockPolygon, FUNCTION_META as MP_FN_META } from "@/lib/masterplan";
import polygonClipping from "polygon-clipping";
import { buildDxf, downloadDxf } from "@/lib/dxf-export";
import { drawOsmTiles, nominatimSearch, type Geo, DEFAULT_GEO } from "@/lib/geo";
import {
  type StructuralGrid,
  DEFAULT_GRID,
  SPAN_PRESETS,
  COL_PRESETS,
  normalizeGrid,
  axisPositions,
  xAxisLabelAt,
  yAxisLabelAt,
  parseXAxisLabel,
  parseYAxisLabel,
  spansForLevel,
  isNodeActive,
  isColumnVisible,
  isColumnClipped,
  levelInRange,
  computeStructuralStats,
  computeAllStructuralStats,
  collectGrids,
  normalizeGridExtras,
  type ColumnClip,
} from "@/lib/structural-grid";
import {
  type EdgeMaterial,
  type EdgeSegment,
  computeStraightSegments,
  pickSegmentAt,
  segmentIdFor,
  MATERIAL_COLORS,
  MATERIAL_LABELS,
} from "@/lib/edge-segments";
import { type Door, genDoorId, normalizeDoors } from "@/lib/doors";
import {
  type ParkingArea,
  type ParkingPath,
  type ParkingStall,
  type ParkingObstacle,
  normalizeParkingAreas,
  generateStalls,
  genParkingId,
  genParkingPathId,
  isParkingName,
  parkingPathsToObstacles,
  PARKING_PATH_BUFFER_M,
  DIFFABLE_STALL_W,
  DIFFABLE_STALL_L,
  computeDiffableTotal,
  distributeDiffableAcrossLevels,
} from "@/lib/parking";
import { setProjectItem } from "@/lib/storage/idb-bridge";
import { MasterplanSketch3DPreview } from "@/components/masterplan-sketch-3d-preview";
import { useProjectStore } from "@/store/project-store";
import {
  type Ramp,
  type RampAnchor,
  genRampId,
  makeRamp,
  tessellateReference,
  offsetPolyline,
  polylineLength,
  pointAtArcLength,
  computeBordesArcs,
  numBordesForSlope,
} from "@/lib/ramps";
import { axisPolyline as sampleAxisPolyline, newAxisId, type AxisSegment } from "@/lib/axes";
import {
  newRoadId,
  roadCenterline,
  roadCorridorPolygon as buildRoadCorridor,
  offsetPolyline as offsetRoadPolyline,
  unionFilletedCorridors,
  clipRingsByPolygon,
  type RoadSegment,
} from "@/lib/roads";


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
  dashed?: boolean; // visual-only: render as dashed (used for cluster-generator relation strings)
};
type Scale = "1:100" | "1:200" | "1:500" | "1:1000" | "1:1200" | "1:1500" | "1:2000";

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

const MDPL_ZERO_EPS = 0.0001;
function findMdplZeroLevel<T extends { mdpl: number }>(levels: T[]): T | undefined {
  return levels.find((lv) => Math.abs(Number(lv.mdpl) || 0) <= MDPL_ZERO_EPS);
}
function ensureMdplZeroLevel(levels: Level[]): { levels: Level[]; level: Level } {
  const existing = findMdplZeroLevel(levels);
  if (existing) return { levels, level: existing };
  const level: Level = {
    id: `LV${Date.now()}_0_${Math.random().toString(36).slice(2, 6)}`,
    name: "Level 1",
    mdpl: 0,
    opacity: 0.5,
  };
  return { levels: [...levels, level], level };
}
function bindLahanLayersToMdplZero(levels: Level[], layers: Layer[]): { levels: Level[]; layers: Layer[] } {
  if (!layers.some((ly) => isLahanLayerName(ly.name))) return { levels, layers };
  const ensured = ensureMdplZeroLevel(levels);
  return {
    levels: ensured.levels,
    layers: layers.map((ly) => (isLahanLayerName(ly.name) ? { ...ly, levelId: ensured.level.id } : ly)),
  };
}

// Hitung nama tampilan tiap level berdasarkan urutan MDPL & acuan MDPL 0.
// Aturan:
//  - Level dengan MDPL 0 selalu menjadi acuan = "Level 1".
//  - Level di atas MDPL 0 → Level 2, Level 3, ... (asc).
//  - Level di bawah MDPL 0 → B1, B2, B3, ... (B1 tepat di bawah Lahan).
//  - Jika belum ada MDPL 0, jatuh kembali ke penomoran Level 1..N asc berdasarkan MDPL.
//  - Nama kustom (yang tidak cocok pola otomatis) selalu dipertahankan.
function isAutoLevelName(name: string): boolean {
  const n = name.trim();
  if (/^Level\s+\d+(?:\s*[-–]\s*\d+)?$/i.test(n)) return true;
  if (/^B\d+(?:\s*[-–]\s*B?\d+)?$/i.test(n)) return true;
  return false;
}
function computeLevelDisplayNames(
  levels: { id: string; name: string; mdpl: number; typicalCount?: number }[],
  _layers?: { name: string; levelId?: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const zeroLevel = findMdplZeroLevel(sorted);
  const lahanIdx = zeroLevel ? sorted.findIndex((l) => l.id === zeroLevel.id) : 0;

  // Bawah Lahan: B1, B2, ... (terdekat ke Lahan = B1)
  if (lahanIdx > 0) {
    let bn = 1;
    for (let i = lahanIdx - 1; i >= 0; i--) {
      const lv = sorted[i];
      out[lv.id] = isAutoLevelName(lv.name) ? `B${bn}` : lv.name;
      bn++;
    }
  }

  // Lahan & atasnya: Level 1, Level 2, ... (atau Level N–M untuk tipikal)
  let idx = 1;
  for (let i = Math.max(0, lahanIdx); i < sorted.length; i++) {
    const lv = sorted[i];
    const k = Math.max(1, lv.typicalCount ?? 1);
    const start = idx;
    const end = idx + k - 1;
    const auto = k > 1 ? `Level ${start}–${end}` : `Level ${start}`;
    out[lv.id] = isAutoLevelName(lv.name) ? auto : lv.name;
    idx = end + 1;
  }

  // Jika tidak ada Lahan dan lahanIdx = -1, sorted di atas dilewati dari 0 — sudah benar.
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
  snapVertex?: boolean;
  snapMidpoint?: boolean;
  lines: Line[];
  layers: Layer[];
  levels: Level[];
  activeLevelId: string | null;
  kdbPct?: number; // 0..100, prosentase KDB terhadap luas lahan
  klbCoef?: number; // koefisien KLB, pengali luas lahan
  kdhPct?: number; // 0..100, prosentase KDH (area hijau) terhadap luas lahan
  ktbPct?: number; // 0..100, prosentase KTB (basement) terhadap luas lahan
  fungsi?: string; // fungsi bangunan: Hotel, Apartment, Komersil, Rumah Sakit, Bandara, Bangunan Khusus
  northRotation?: number; // derajat rotasi arah utara, 0 = atas (CW positif)
  mmGridRotation?: number; // derajat rotasi tampilan grid milimeter block (display-only, tidak mengubah koordinat sketsa)
  geo?: Geo; // koordinat lokasi (single source of truth peta/matahari/slide)
  sectionCut?: SectionCut; // legacy single cut (kompatibilitas)
  sectionCuts?: SectionCut[]; // Garis Potong A-A, B-B, ... (dinamis, men-trigger slide potongan)
  structuralGrid?: StructuralGrid; // Modul Struktur parametric grid (primer)
  structuralGridExtras?: StructuralGrid[]; // Hasil "paste" grid → grid tambahan dgn range level sendiri
  edgeAttrs?: Record<string, EdgeMaterial>; // Material per segmen edge (key = segmentId)
  doors?: Door[]; // Notasi pintu 2D — tidak mengubah massa 3D
  circles?: Circle[]; // Lingkaran (center + radius), tidak memengaruhi massa 3D
  floors?: Floor[]; // Lantai (slab) — entitas terpisah, di-extrude 150mm ke bawah dari MDPL level
  parkingAreas?: ParkingArea[]; // Area parkir (bounding box) per level
  ramps?: Ramp[]; // Ramp antar level
  axes?: import("@/lib/axes").AxisSegment[]; // Aksis rancangan (garis/tangent) — dihindari oleh Cluster Generator
  roads?: import("@/lib/roads").RoadSegment[]; // Jalan dengan lebar + fillet — Master Plan
  clusterGraph?: { nodes: { id: string; levelId: string; name: string; areaM2: number }[]; links: { source: string; target: string }[] };
};

type Circle = {
  id: string;
  c: Point;
  r: number; // radius (px world)
  levelId?: string;
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
  "1:1200": 12,
  "1:1500": 15,
  "1:2000": 20,
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

function polygonCentroid(pts: Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / pts.length, y: sy / pts.length };
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

// Belah polygon dengan sebuah garis tak-hingga melalui titik a→b.
// Mengembalikan dua ring (left/right relatif terhadap arah garis) dan dua
// titik perpotongan pada perimeter (untuk menggambar garis pemisah).
function splitPolygonByInfiniteLine(
  poly: Point[],
  a: Point,
  b: Point,
): { left: Point[]; right: Point[]; iA: Point; iB: Point } | null {
  if (poly.length < 3) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx * dx + dy * dy < 1e-6) return null;
  const side = (p: Point) => (p.x - a.x) * dy - (p.y - a.y) * dx;
  const left: Point[] = [];
  const right: Point[] = [];
  const intersects: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % poly.length];
    const sC = side(cur);
    const sN = side(nxt);
    if (sC <= 0) left.push(cur);
    if (sC >= 0) right.push(cur);
    if ((sC > 0 && sN < 0) || (sC < 0 && sN > 0)) {
      const t = sC / (sC - sN);
      const ix: Point = {
        x: cur.x + t * (nxt.x - cur.x),
        y: cur.y + t * (nxt.y - cur.y),
      };
      left.push(ix);
      right.push(ix);
      intersects.push(ix);
    }
  }
  if (intersects.length !== 2) return null;
  if (left.length < 3 || right.length < 3) return null;
  return { left, right, iA: intersects[0], iB: intersects[1] };
}


function isLahanLayerName(n: string) {
  return n.trim().toLowerCase().startsWith("lahan");
}
function isVoidLayerName(n: string) {
  return n.trim().toLowerCase() === "void";
}
function isTamanLayerName(n: string) {
  return n.trim().toLowerCase().startsWith("taman");
}
function isBalkonLayerName(n: string) {
  return n.trim().toLowerCase() === "balkon";
}
function isAtapHijauLayerName(n: string) {
  return n.trim().toLowerCase() === "atap hijau";
}
function isAtapLayerName(n: string) {
  return n.trim().toLowerCase() === "atap";
}
const TAMAN_FILL_RGBA = "rgba(34, 197, 94, ALPHA)";
const ATAP_HIJAU_FILL_RGBA = "rgba(34, 197, 94, ALPHA)";
const ABU_MUDA_FILL_RGBA = "rgba(190, 190, 190, ALPHA)";

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
    snapVertex: true,
    snapMidpoint: true,
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
  ({ levels, layers } = bindLahanLayersToMdplZero(levels, layers));
  return {
    id: s?.id,
    title: s?.title ?? "Sketsa",
    createdAt: s?.createdAt ?? Date.now(),
    updatedAt: s?.updatedAt ?? Date.now(),
    scale: s?.scale ?? "1:100",
    snap: s?.snap ?? true,
    snapVertex: s?.snapVertex ?? true,
    snapMidpoint: s?.snapMidpoint ?? true,
    lines,
    layers,
    levels,
    activeLevelId,
    kdbPct: Number.isFinite(Number(s?.kdbPct)) ? Math.max(0, Math.min(100, Number(s.kdbPct))) : undefined,
    klbCoef: Number.isFinite(Number(s?.klbCoef)) ? Math.max(0, Number(s.klbCoef)) : undefined,
    kdhPct: Number.isFinite(Number(s?.kdhPct)) ? Math.max(0, Math.min(100, Number(s.kdhPct))) : undefined,
    ktbPct: Number.isFinite(Number(s?.ktbPct)) ? Math.max(0, Math.min(100, Number(s.ktbPct))) : undefined,
    fungsi: typeof s?.fungsi === "string" ? s.fungsi : undefined,
    clusterGraph: s?.clusterGraph && Array.isArray(s.clusterGraph.nodes) && Array.isArray(s.clusterGraph.links)
      ? { nodes: s.clusterGraph.nodes, links: s.clusterGraph.links }
      : undefined,
    northRotation: Number.isFinite(Number(s?.northRotation)) ? Number(s.northRotation) : 0,
    mmGridRotation: Number.isFinite(Number(s?.mmGridRotation)) ? Number(s.mmGridRotation) : 0,
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
    structuralGrid: normalizeGrid(s?.structuralGrid),
    structuralGridExtras: normalizeGridExtras(s?.structuralGridExtras),
    edgeAttrs: (() => {
      const raw = s?.edgeAttrs;
      if (!raw || typeof raw !== "object") return {};
      const valid: Record<string, EdgeMaterial> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v === "solid" || v === "curtain" || v === "window" || v === "railing") {
          valid[k] = v;
        }
      }
      return valid;
    })(),
    doors: (() => {
      const arr = normalizeDoors(s?.doors);
      const validLvl = new Set(levels.map((l) => l.id));
      return arr.map((d) => (d.levelId && validLvl.has(d.levelId) ? d : { ...d, levelId: fallback }));
    })(),
    circles: (() => {
      const raw = s?.circles;
      if (!Array.isArray(raw)) return [];
      const validLvl = new Set(levels.map((l) => l.id));
      const out: Circle[] = [];
      for (const c of raw) {
        if (!c || typeof c !== "object") continue;
        const cx = Number(c.c?.x), cy = Number(c.c?.y), r = Number(c.r);
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) continue;
        const lid = typeof c.levelId === "string" && validLvl.has(c.levelId) ? c.levelId : fallback;
        out.push({
          id: typeof c.id === "string" && c.id ? c.id : `CIR${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          c: { x: cx, y: cy }, r, levelId: lid,
        });
      }
      return out;
    })(),
    floors: (() => {
      const raw = s?.floors;
      if (!Array.isArray(raw)) return [];
      const validLvl = new Set(levels.map((l) => l.id));
      const validRing = (r: any): Point[] | null => {
        if (!Array.isArray(r)) return null;
        const pts: Point[] = [];
        for (const p of r) {
          const x = Number(p?.x), y = Number(p?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          pts.push({ x, y });
        }
        return pts.length >= 3 ? pts : null;
      };
      const out: Floor[] = [];
      for (const f of raw) {
        if (!f || typeof f !== "object") continue;
        const outer = validRing(f.outer);
        if (!outer) continue;
        const holes: Point[][] = [];
        if (Array.isArray(f.holes)) {
          for (const h of f.holes) {
            const hh = validRing(h);
            if (hh) holes.push(hh);
          }
        }
        const lid = typeof f.levelId === "string" && validLvl.has(f.levelId) ? f.levelId : fallback;
        out.push({
          id: typeof f.id === "string" && f.id ? f.id : `FL${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          levelId: lid,
          outer,
          holes: holes.length ? holes : undefined,
          thicknessMm: Number.isFinite(Number(f.thicknessMm)) && Number(f.thicknessMm) > 0 ? Number(f.thicknessMm) : 150,
          createdAt: Number.isFinite(Number(f.createdAt)) ? Number(f.createdAt) : Date.now(),
        });
      }
      return out;
    })(),
    parkingAreas: (() => {
      const mmRotDeg = Number.isFinite(Number(s?.mmGridRotation)) ? Number(s.mmGridRotation) : 0;
      const mmRotRad = (mmRotDeg * Math.PI) / 180;
      const arr = normalizeParkingAreas(s?.parkingAreas, mmRotRad);
      const validLvl = new Set(levels.map((l) => l.id));
      return arr.map((p) => (p.levelId && validLvl.has(p.levelId) ? p : { ...p, levelId: fallback }));
    })(),
    ramps: (() => {
      const raw = s?.ramps;
      if (!Array.isArray(raw)) return [];
      const validLvl = new Set(levels.map((l) => l.id));
      const out: Ramp[] = [];
      for (const r of raw) {
        if (!r || typeof r !== "object") continue;
        if (!Array.isArray(r.anchors) || r.anchors.length < 2) continue;
        const anchors: RampAnchor[] = [];
        let ok = true;
        for (const p of r.anchors) {
          const x = Number(p?.x), y = Number(p?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) { ok = false; break; }
          const fr = Number(p?.filletR);
          anchors.push(Number.isFinite(fr) && fr > 0 ? { x, y, filletR: fr } : { x, y });
        }
        if (!ok) continue;
        const lid = typeof r.levelId === "string" && validLvl.has(r.levelId) ? r.levelId : fallback;
        out.push({
          id: typeof r.id === "string" && r.id ? r.id : `ramp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          levelId: lid,
          anchors,
          offsetSide: r.offsetSide === "left" ? "left" : "right",
          widthM: Number.isFinite(Number(r.widthM)) && Number(r.widthM) > 0 ? Number(r.widthM) : 1,
          nM: Number.isFinite(Number(r.nM)) && Number(r.nM) > 0 ? Number(r.nM) : 7,
          lockedLenM: Number.isFinite(Number(r.lockedLenM)) && Number(r.lockedLenM) > 0 ? Number(r.lockedLenM) : undefined,
          bordes: r.bordes === true,
          bordesLenM: Number.isFinite(Number(r.bordesLenM)) && Number(r.bordesLenM) > 0 ? Number(r.bordesLenM) : (r.bordes === true ? 1.2 : undefined),
          bordesSpacingM: Number.isFinite(Number(r.bordesSpacingM)) && Number(r.bordesSpacingM) > 0 ? Number(r.bordesSpacingM) : (r.bordes === true ? 9 : undefined),
          bordesBelokan: r.bordesBelokan === true,
          createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : Date.now(),
        });
      }
      return out;
    })(),
    axes: (() => {
      const raw = s?.axes;
      if (!Array.isArray(raw)) return [];
      const out: import("@/lib/axes").AxisSegment[] = [];
      for (const a of raw) {
        if (!a || typeof a !== "object") continue;
        if (!Array.isArray(a.points) || a.points.length < 2) continue;
        const pts: { x: number; y: number }[] = [];
        let ok = true;
        for (const p of a.points) {
          const x = Number(p?.x), y = Number(p?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) { ok = false; break; }
          pts.push({ x, y });
        }
        if (!ok) continue;
        const kind = a.kind === "tangent" ? "tangent" : "garis";
        out.push({
          id: typeof a.id === "string" && a.id ? a.id : `ax_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          kind,
          points: pts,
          bufferM: Number.isFinite(Number(a.bufferM)) && Number(a.bufferM) >= 0 ? Number(a.bufferM) : 8,
          createdAt: Number.isFinite(Number(a.createdAt)) ? Number(a.createdAt) : Date.now(),
        });
      }
      return out;
    })(),
    roads: (() => {
      const raw = (s as any)?.roads;
      if (!Array.isArray(raw)) return [];
      const out: import("@/lib/roads").RoadSegment[] = [];
      for (const r of raw) {
        if (!r || typeof r !== "object") continue;
        if (!Array.isArray(r.points) || r.points.length < 2) continue;
        const pts: { x: number; y: number }[] = [];
        let ok = true;
        for (const p of r.points) {
          const x = Number(p?.x), y = Number(p?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) { ok = false; break; }
          pts.push({ x, y });
        }
        if (!ok) continue;
        const kind = r.kind === "tangent" ? "tangent" : "garis";
        out.push({
          id: typeof r.id === "string" && r.id ? r.id : `rd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          kind,
          points: pts,
          widthM: Number.isFinite(Number(r.widthM)) && Number(r.widthM) > 0 ? Number(r.widthM) : 6,
          filletM: Number.isFinite(Number(r.filletM)) && Number(r.filletM) >= 0 ? Number(r.filletM) : 0,
          createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : Date.now(),
        });
      }
      return out;
    })(),
  };
}

// Editor tabel bentang per as — bisa diketik per baris, tambah/hapus baris,
// dan field "Jumlah" untuk membuat N bentang sama dari preset.
function SpanAxisEditor({
  label,
  spans,
  onChange,
}: {
  label: string;
  spans: number[];
  onChange: (next: number[]) => void;
}) {
  const [count, setCount] = useState<string>(String(spans.length));
  const [unit, setUnit] = useState<string>(String(spans[spans.length - 1] ?? 8));
  useEffect(() => { setCount(String(spans.length)); }, [spans.length]);
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap items-center gap-1">
        {SPAN_PRESETS.map((p) => (
          <Button key={`p-${p}`} size="sm" variant="outline" className="h-6 px-2 text-[10px]"
            onClick={() => { setUnit(String(p)); onChange(Array(Math.max(1, Number(count) || spans.length)).fill(p)); }}>
            {p}m
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">×</span>
          <Input className="h-6 w-12 text-[10px]" inputMode="numeric"
            value={count} onChange={(e) => setCount(e.target.value)}
            onBlur={() => {
              const n = Math.max(1, Math.min(50, Math.round(Number(count) || spans.length)));
              const u = Math.max(0.5, Number(unit) || 8);
              onChange(Array(n).fill(u));
              setCount(String(n));
            }}
          />
          <Input className="h-6 w-14 text-[10px]" inputMode="decimal"
            value={unit} onChange={(e) => setUnit(e.target.value)}
            onBlur={() => {
              const u = Math.max(0.5, Number(unit) || 8);
              onChange(Array(spans.length).fill(u));
              setUnit(String(u));
            }}
            placeholder="m"
          />
        </div>
      </div>
      <div className="rounded border border-border/50 bg-background/60">
        <div className="grid grid-cols-[28px_1fr_28px] items-center gap-1 border-b border-border/40 px-1.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>#</span><span>Bentang (m)</span><span></span>
        </div>
        <div className="max-h-44 overflow-y-auto">
          {spans.map((s, i) => (
            <SpanRow key={i} index={i} value={s}
              onCommit={(v) => {
                const arr = spans.slice();
                arr[i] = Math.max(0.5, v);
                onChange(arr);
              }}
              onRemove={() => {
                if (spans.length <= 1) return;
                onChange(spans.filter((_, k) => k !== i));
              }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-1 border-t border-border/40 px-1.5 py-1">
          <Button size="sm" variant="ghost" className="h-6 text-[10px]"
            onClick={() => onChange([...spans, Number(unit) || spans[spans.length - 1] || 8])}>
            <Plus className="mr-1 h-3 w-3" /> Tambah baris
          </Button>
          <span className="text-[10px] text-muted-foreground">
            Total: {spans.reduce((a, b) => a + b, 0).toFixed(2)} m
          </span>
        </div>
      </div>
    </div>
  );
}

function SpanRow({
  index, value, onCommit, onRemove,
}: { index: number; value: number; onCommit: (v: number) => void; onRemove: () => void }) {
  const [v, setV] = useState<string>(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  return (
    <div className="grid grid-cols-[28px_1fr_28px] items-center gap-1 border-b border-border/30 px-1.5 py-1 last:border-b-0">
      <span className="text-[10px] text-muted-foreground">{index + 1}</span>
      <Input className="h-6 text-[11px]" inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) onCommit(n);
          else setV(String(value));
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onRemove} title="Hapus baris">
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export type ParkingSubToolKind =
  | "draw"
  | "move"
  | "addPoint"
  | "removePoint"
  | "rotate"
  | "diffable"
  | "pathDraw"
  | "pathMove"
  | "pathAdd"
  | "pathRemove"
  | "pathFillet";

type ParkingSubToolbarProps = {
  sub: ParkingSubToolKind;
  setSub: (s: ParkingSubToolKind) => void;
  selectedId: string | null;
  clipboardSize: number;
  orientation: "auto" | "x" | "y";
  onOrientation: (o: "auto" | "x" | "y") => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  hasDraft: boolean;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
  hasPathDraft: boolean;
  pathDraftCount: number;
  onSavePathDraft: () => void;
  onCancelPathDraft: () => void;
  parkingKind: "mobil" | "motor";
};

function ParkingSubToolbar(props: ParkingSubToolbarProps) {
  const {
    sub, setSub, selectedId, clipboardSize, orientation, onOrientation,
    onCopy, onPaste, onDelete, hasDraft, onSaveDraft, onCancelDraft,
    hasPathDraft, pathDraftCount, onSavePathDraft, onCancelPathDraft,
    parkingKind,
  } = props;
  const opts: Array<{ k: ParkingSubToolKind; label: string; hint: string }> = [
    { k: "draw", label: "Tarik", hint: "Tarik kotak baru" },
    { k: "move", label: "Edit Titik: Geser", hint: "Geser titik / area" },
    { k: "addPoint", label: "Edit Titik: +", hint: "Sisip titik di sisi" },
    { k: "removePoint", label: "Edit Titik: −", hint: "Hapus titik" },
    { k: "rotate", label: "Rotasi", hint: "Putar kotak parkir" },
  ];
  if (parkingKind === "mobil") {
    opts.push({ k: "diffable", label: "Diffable", hint: "Pilih lot mobil untuk ditandai sebagai lot diffable (swap dengan diffable terdekat di level)" });
  }
  const pathOpts: Array<{ k: ParkingSubToolKind; label: string; hint: string }> = [
    { k: "pathDraw", label: "Tarik", hint: "Klik berurutan utk membuat polyline (Enter = simpan)" },
    { k: "pathMove", label: "Geser", hint: "Geser titik jalur" },
    { k: "pathAdd", label: "+", hint: "Sisip titik di sisi jalur" },
    { k: "pathRemove", label: "−", hint: "Hapus titik jalur" },
    { k: "pathFillet", label: "Fillet", hint: "Chamfer sudut jalur (≈1 m)" },
  ];
  const oriOpts: Array<{ k: "auto" | "x" | "y"; label: string; hint: string }> = [
    { k: "auto", label: "Auto", hint: "Orientasi otomatis sesuai sisi terpanjang" },
    { k: "x", label: "X", hint: "Deret lot berjejer searah sumbu X grid" },
    { k: "y", label: "Y", hint: "Deret lot berjejer searah sumbu Y grid" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/60 bg-card/40 p-2">
      {opts.map((o) => (
        <Button
          key={o.k}
          size="sm"
          variant={sub === o.k ? "default" : "outline"}
          onClick={() => setSub(o.k)}
          title={o.hint}
        >
          {o.label}
        </Button>
      ))}
      <div className="mx-1 h-6 w-px bg-border/60" />
      <Button
        size="sm"
        variant={hasDraft ? "default" : "outline"}
        onClick={onSaveDraft}
        disabled={!hasDraft}
        className={cn(hasDraft && "bg-amber-500 hover:bg-amber-600 text-white")}
        title="Simpan draft area parkir ke sketsa"
      >
        <Save className="mr-1 h-3.5 w-3.5" /> Simpan Area
      </Button>
      <Button size="sm" variant="outline" onClick={onCancelDraft} disabled={!hasDraft} title="Batalkan draft">
        <X className="mr-1 h-3.5 w-3.5" /> Batal Draft
      </Button>
      <div className="mx-1 h-6 w-px bg-border/60" />
      <span className="self-center text-xs text-muted-foreground">Jalur Parkir:</span>
      {pathOpts.map((o) => (
        <Button
          key={o.k}
          size="sm"
          variant={sub === o.k ? "default" : "outline"}
          onClick={() => setSub(o.k)}
          disabled={!selectedId && o.k !== "pathDraw"}
          title={o.hint}
        >
          {o.label}
        </Button>
      ))}
      <Button
        size="sm"
        variant={hasPathDraft ? "default" : "outline"}
        onClick={onSavePathDraft}
        disabled={!hasPathDraft || pathDraftCount < 2}
        className={cn(hasPathDraft && pathDraftCount >= 2 && "bg-amber-500 hover:bg-amber-600 text-white")}
        title="Simpan polyline jalur (perlu ≥ 2 titik)"
      >
        <Save className="mr-1 h-3.5 w-3.5" /> Simpan Jalur{pathDraftCount > 0 ? ` (${pathDraftCount})` : ""}
      </Button>
      <Button size="sm" variant="outline" onClick={onCancelPathDraft} disabled={!hasPathDraft} title="Batal draft jalur">
        <X className="mr-1 h-3.5 w-3.5" /> Batal Jalur
      </Button>
      <div className="mx-1 h-6 w-px bg-border/60" />
      <span className="self-center text-xs text-muted-foreground">Arah deret:</span>
      {oriOpts.map((o) => (
        <Button
          key={o.k}
          size="sm"
          variant={orientation === o.k ? "default" : "outline"}
          onClick={() => onOrientation(o.k)}
          disabled={!selectedId}
          title={o.hint}
        >
          {o.label}
        </Button>
      ))}
      <div className="mx-1 h-6 w-px bg-border/60" />
      <Button size="sm" variant="outline" onClick={onCopy} disabled={!selectedId} title="Copy area parkir terpilih (termasuk jalur)">
        <Copy className="mr-1 h-3.5 w-3.5" /> Copy
      </Button>
      <Button size="sm" variant="outline" onClick={onPaste} disabled={clipboardSize === 0} title="Paste ke level aktif">
        <ClipboardPaste className="mr-1 h-3.5 w-3.5" /> Paste{clipboardSize > 0 ? ` (${clipboardSize})` : ""}
      </Button>
      <Button size="sm" variant="destructive" onClick={onDelete} disabled={!selectedId} title="Hapus area parkir">
        <X className="mr-1 h-3.5 w-3.5" /> Hapus
      </Button>
    </div>
  );
}


function ParkingSubToolbarMobile(props: ParkingSubToolbarProps) {
  return <ParkingSubToolbar {...props} />;
}




export function SketchPage({ mode = "sketch" }: { mode?: "sketch" | "masterplan" } = {}) {
  const STORAGE_KEY_ACTIVE = mode === "masterplan" ? "dabidabis_masterplan_canvas_v1" : STORAGE_KEY;
  const LEGACY_KEY_ACTIVE = mode === "masterplan" ? "dabidabis_masterplan_canvas_v0" : LEGACY_KEY;
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const latestStoreRef = useRef<{ sketches: Sketch[]; openId: string | null; loaded: boolean }>({
    sketches: [],
    openId: null,
    loaded: false,
  });
  latestStoreRef.current = { sketches, openId, loaded };

  // Load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ACTIVE);
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
      const legacy = localStorage.getItem(LEGACY_KEY_ACTIVE);
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
  }, [STORAGE_KEY_ACTIVE, LEGACY_KEY_ACTIVE]);

  // Save
  useEffect(() => {
    if (!loaded) return;
    const payload = JSON.stringify({ sketches, openId } as StoreShape);
    const handle = setTimeout(() => {
      void setProjectItem(STORAGE_KEY_ACTIVE, payload);
    }, 400);
    return () => clearTimeout(handle);
  }, [sketches, openId, loaded, STORAGE_KEY_ACTIVE]);

  useEffect(() => {
    return () => {
      const latest = latestStoreRef.current;
      if (!latest.loaded) return;
      void setProjectItem(
        STORAGE_KEY_ACTIVE,
        JSON.stringify({ sketches: latest.sketches, openId: latest.openId } as StoreShape),
      );
    };
  }, [STORAGE_KEY_ACTIVE]);

  const updateSketch = useCallback((id: string, patch: Partial<Sketch>) => {
    setSketches((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const merged = { ...s, ...patch, updatedAt: Date.now() };
        const bound = bindLahanLayersToMdplZero(merged.levels, merged.layers);
        return { ...merged, levels: bound.levels, layers: bound.layers };
      }),
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

  const duplicateSketch = (id: string) => {
    setSketches((prev) => {
      const src = prev.find((s) => s.id === id);
      if (!src) return prev;
      const clone: Sketch = JSON.parse(JSON.stringify(src));
      clone.id = `S${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      clone.title = `${src.title} (salinan)`;
      const now = Date.now();
      clone.createdAt = now;
      clone.updatedAt = now;
      const idx = prev.findIndex((s) => s.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      setOpenId(clone.id);
      return next;
    });
    toast.success("Sketsa disalin — data progres tetap utuh");
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
            onDuplicate={() => duplicateSketch(s.id)}
            onEnterFullscreen={() => {
              setOpenId(s.id);
              setFullscreenId(s.id);
            }}
            onExitFullscreen={() => setFullscreenId(null)}
            mode={mode}
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
          mode={mode}
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
  onDuplicate: () => void;
  onEnterFullscreen: () => void;
  onExitFullscreen: () => void;
  mode?: "sketch" | "masterplan";
};

function SketchCard(props: SketchCardProps) {
  const { sketch, isOpen, onOpen, onMinimize, onChange, onRequestDelete, onDuplicate, onEnterFullscreen, mode } = props;
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
            onClick={onDuplicate}
            title="Duplikat sketsa — buat salinan penuh untuk dikembangkan tanpa mengubah progres asli"
          >
            <Copy className="mr-1.5 h-4 w-4" /> Salin
          </Button>
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

      {isOpen && <SketchEditor sketch={sketch} onChange={onChange} fullscreen={false} mode={mode} />}
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
  mode,
}: {
  sketch: Sketch;
  onChange: (patch: Partial<Sketch>) => void;
  onExit: () => void;
  mode?: "sketch" | "masterplan";
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
      <SketchEditor sketch={sketch} onChange={onChange} fullscreen onExitFullscreen={onExit} mode={mode} />
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
        {/* Thin circle */}
        <circle cx="50" cy="50" r="44" fill="rgba(255,255,255,0.85)" stroke="#0a0a0a" strokeWidth="1" />
        {/* Single thick black line from center to north edge */}
        <line x1="50" y1="50" x2="50" y2="6" stroke="#0a0a0a" strokeWidth="5" strokeLinecap="round" />
        {/* North label above */}
        
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
              type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
              step="0.000001"
              value={g.lat}
              onChange={(e) => setG({ lat: parseFloat(e.target.value) || 0 })}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Longitude</Label>
            <Input
              type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
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
            className={cn("h-7 flex-1 text-[11px]", g.locked && "bg-gradient-primary shadow-primary")}
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
              type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
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
  mode?: "sketch" | "masterplan";
};

function SketchEditor({ sketch, onChange, fullscreen, onExitFullscreen, mode = "sketch" }: EditorProps) {
  const { id, scale, snap, lines, layers, levels, activeLevelId, kdbPct, klbCoef, kdhPct, ktbPct, fungsi } = sketch;
  const snapVertex = sketch.snapVertex ?? true;
  const snapMidpoint = sketch.snapMidpoint ?? true;
  // ----- Grid Struktur: primer + extras (paste grid) -----
  // Index 0 = grid primer (sketch.structuralGrid).
  // Index 1..N = sketch.structuralGridExtras[idx-1].
  const [editGridIdx, setEditGridIdx] = useState<number>(0);
  const primaryGrid: StructuralGrid = sketch.structuralGrid ?? { ...DEFAULT_GRID };
  const gridExtras: StructuralGrid[] = sketch.structuralGridExtras ?? [];
  const grid: StructuralGrid =
    editGridIdx === 0 ? primaryGrid : (gridExtras[editGridIdx - 1] ?? primaryGrid);
  const updateGrid = useCallback(
    (patch: Partial<StructuralGrid>) => {
      if (editGridIdx === 0) {
        const cur = sketch.structuralGrid ?? { ...DEFAULT_GRID };
        onChange({ structuralGrid: { ...cur, ...patch } });
        return;
      }
      const ei = editGridIdx - 1;
      const arr = (sketch.structuralGridExtras ?? []).slice();
      if (!arr[ei]) return;
      arr[ei] = { ...arr[ei], ...patch };
      onChange({ structuralGridExtras: arr });
    },
    [sketch.structuralGrid, sketch.structuralGridExtras, editGridIdx, onChange],
  );
  const updateGridOverride = useCallback(
    (lvlId: string, patch: Partial<import("@/lib/structural-grid").GridOverride>) => {
      const prev = grid.perLevel?.[lvlId] ?? {};
      const next = { ...grid.perLevel, [lvlId]: { ...prev, ...patch } };
      updateGrid({ perLevel: next });
    },
    [grid, updateGrid],
  );
  // Auto-clamp idx kalau extras berkurang.
  useEffect(() => {
    if (editGridIdx > 0 && editGridIdx - 1 >= gridExtras.length) {
      setEditGridIdx(0);
    }
  }, [gridExtras.length, editGridIdx]);
  const northRotation = Number.isFinite(Number(sketch.northRotation)) ? Number(sketch.northRotation) : 0;
  const mmGridRotation = Number.isFinite(Number(sketch.mmGridRotation)) ? Number(sketch.mmGridRotation) : 0;
  const mmGridRotRad = (mmGridRotation * Math.PI) / 180;
  const structGridRotation = Number.isFinite(Number(grid.rotation)) ? Number(grid.rotation) : 0;
  const structGridRotRad = (structGridRotation * Math.PI) / 180;
  // Dua grid dianggap "paralel" bila selisih rotasi adalah kelipatan 90°.
  const gridsParallel = (() => {
    const diff = (((structGridRotation - mmGridRotation) % 90) + 90) % 90;
    return diff < 0.05 || diff > 89.95;
  })();
  // Helper: rotasi titik di sekitar pusat (CW positif, sesuai konvensi sketch).
  const rotateAround = (p: Point, c: Point, rad: number): Point => {
    const dx = p.x - c.x, dy = p.y - c.y;
    const cs = Math.cos(rad), sn = Math.sin(rad);
    return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
  };
  const activeLvlId = activeLevelId ?? levels[0]?.id ?? null;
  const [rekapMinimized, setRekapMinimized] = useState(false);
  const [sideMinimized, setSideMinimized] = useState(false);
  const [clusterOpen, setClusterOpen] = useState(false);

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
      const nextLevels = levels.map((l) => (l.id === lvlId ? { ...l, mdpl } : l));
      const bound = bindLahanLayersToMdplZero(nextLevels, layers);
      onChange({
        levels: bound.levels,
        layers: bound.layers,
      });
    },
    [levels, layers, onChange],
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
      const nextLines = lines.filter((ln) => ln.levelId !== lvlId);
      const nextLayersBase = layers.filter((ly) => ly.levelId !== lvlId || isLahanLayerName(ly.name));
      const bound = bindLahanLayersToMdplZero(remaining, nextLayersBase);
      onChange({
        levels: bound.levels,
        activeLevelId: activeLvlId === lvlId ? (bound.levels[0]?.id ?? fallback) : activeLvlId,
        lines: nextLines,
        layers: bound.layers,
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

  const [tool, setTool] = useState<"line" | "rect" | "polyline" | "erase" | "edit" | "section" | "separasi" | "grid" | "pick" | "door" | "circle" | "trim" | "offset" | "floor" | "move" | "mirror" | "parking" | "ramp" | "aksis" | "jalan">("line");
  // Aksis tool — garis sumbu rancangan yang harus dihindari Cluster Generator
  const [aksisSub, setAksisSub] = useState<"garis" | "tangent">("garis");
  const [aksisBufferInput, setAksisBufferInput] = useState<string>("8");
  const aksisBufferM = Math.max(0, Number(aksisBufferInput) || 8);
  const [aksisDraft, setAksisDraft] = useState<{ kind: "garis" | "tangent"; points: Point[]; cursor: Point } | null>(null);
  // Jalan tool — koridor jalan (lebar + fillet) untuk Master Plan
  const [jalanSub, setJalanSub] = useState<"garis" | "tangent" | "fillet" | "hapus" | "geser" | "tambahTitik" | "hapusTitik">("garis");
  const [roadVertexDrag, setRoadVertexDrag] = useState<{ roadId: string; idx: number } | null>(null);
  const [jalanWidthInput, setJalanWidthInput] = useState<string>("6");
  const [jalanFilletInput, setJalanFilletInput] = useState<string>("4");
  const jalanWidthM = Math.max(0.5, Number(jalanWidthInput) || 6);
  const jalanFilletM = Math.max(0, Number(jalanFilletInput) || 0);
  const [jalanDraft, setJalanDraft] = useState<{ kind: "garis" | "tangent"; points: Point[]; cursor: Point } | null>(null);
  const [jalanOffsetEnabled, setJalanOffsetEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("dabidabis.jalan.offset") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("dabidabis.jalan.offset", jalanOffsetEnabled ? "1" : "0");
  }, [jalanOffsetEnabled]);
  // Ramp tool state
  const [rampSub, setRampSub] = useState<"tarik" | "lebar" | "kemiringan" | "fillet" | "geser" | "addpt">("tarik");
  const [rampDraft, setRampDraft] = useState<{ levelId: string; anchors: RampAnchor[]; offsetSide: "left" | "right" } | null>(null);
  const [rampSelectedId, setRampSelectedId] = useState<string | null>(null);
  const [rampWidthInput, setRampWidthInput] = useState<string>("1");
  const [rampNInput, setRampNInput] = useState<string>("7");
  const [rampFilletInput, setRampFilletInput] = useState<string>("1");
  const rampWidthM = Math.max(0.3, Number(rampWidthInput) || 1);
  const rampNVal = Math.max(1, Number(rampNInput) || 7);
  const rampFilletM = Math.max(0, Number(rampFilletInput) || 0);
  const [rampVertexDrag, setRampVertexDrag] = useState<{ rampId: string; idx: number } | null>(null);
  const [rampClipboard, setRampClipboard] = useState<Ramp | null>(null);
  const [rampBordesOn, setRampBordesOn] = useState<boolean>(false);
  const [rampBordesLenInput, setRampBordesLenInput] = useState<string>("1.2");
  const [rampBordesBelokan, setRampBordesBelokan] = useState<boolean>(false);
  const rampBordesLenM = Math.max(0.1, Number(rampBordesLenInput) || 1.2);
  const rampBordesSpacingM = 9;
  // Auto-sync: ketika nilai radius fillet di input diubah secara MANUAL oleh user
  // pada ramp yang sedang terpilih, perbarui semua titik interior ramp tsb agar
  // mengikuti radius baru. Tidak pernah berjalan pada mount/halaman pindah,
  // dan tidak pernah menyentuh ramp lain — sehingga radius yg sudah tersimpan
  // tidak ikut ter-reset oleh nilai default input.
  const lastFilletSyncRef = useRef<{ id: string | null; val: number }>({ id: null, val: rampFilletM });
  useEffect(() => {
    const prev = lastFilletSyncRef.current;
    if (prev.id !== rampSelectedId) {
      // Pindah seleksi → jangan apply, hanya catat baseline.
      lastFilletSyncRef.current = { id: rampSelectedId, val: rampFilletM };
      return;
    }
    if (!rampSelectedId) {
      lastFilletSyncRef.current = { id: rampSelectedId, val: rampFilletM };
      return;
    }
    if (Math.abs(prev.val - rampFilletM) < 1e-6) return;
    lastFilletSyncRef.current = { id: rampSelectedId, val: rampFilletM };
    const list = sketch.ramps ?? [];
    const targetR = rampFilletM;
    let dirty = false;
    const next = list.map((r) => {
      if (r.id !== rampSelectedId) return r;
      if (r.anchors.length < 3) return r;
      const anchors2 = r.anchors.map((a, i) => {
        const isInterior = i > 0 && i < r.anchors.length - 1;
        if (!isInterior) return a;
        const had = (a.filletR ?? 0) > 0;
        if (targetR > 0) {
          if (Math.abs((a.filletR ?? 0) - targetR) < 1e-6) return a;
          return { ...a, filletR: targetR };
        }
        if (had) {
          const { filletR: _drop, ...rest } = a;
          return rest as RampAnchor;
        }
        return a;
      });
      const changed = anchors2.some((a, i) => (a.filletR ?? 0) !== (r.anchors[i].filletR ?? 0));
      if (!changed) return r;
      dirty = true;
      return { ...r, anchors: anchors2 };
    });
    if (!dirty) return;
    onChange({ ramps: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rampFilletM, rampSelectedId]);
  // Saat memilih ramp, isi input radius dari nilai fillet yang sudah tersimpan
  // pada salah satu titik interior ramp tsb (jika ada), agar tampilan input
  // mencerminkan nilai aktual dan tidak menimpa dengan default.
  useEffect(() => {
    if (!rampSelectedId) return;
    const r = (sketch.ramps ?? []).find((x) => x.id === rampSelectedId);
    if (!r) return;
    const stored = r.anchors.slice(1, -1).map((a) => a.filletR ?? 0).find((v) => v > 0);
    if (stored && stored > 0) {
      const s = String(stored);
      setRampFilletInput(s);
      lastFilletSyncRef.current = { id: rampSelectedId, val: stored };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rampSelectedId]);
  // Live-sync bordes pada ramp terpilih (atau semua ramp di level aktif jika tidak ada pilihan)
  // agar garis bordes langsung muncul/menghilang di sketsa dan slide tanpa menunggu "Terapkan".
  useEffect(() => {
    // Hanya sinkronkan ke ramp yang sedang dipilih, supaya konfigurasi bordes
    // yang sudah tersimpan pada ramp lain tidak ikut ter-reset saat halaman
    // sketsa dibuka kembali (state UI default = false, sedangkan ramp tersimpan
    // mungkin sudah punya bordes aktif).
    if (!rampSelectedId) return;
    const list = sketch.ramps ?? [];
    if (list.length === 0) return;
    const cur = [...(levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
    let dirty = false;
    const next = list.map((r) => {
      if (r.id !== rampSelectedId) return r;
      const wantBordes = rampBordesOn;
      const wantLen = wantBordes ? rampBordesLenM : undefined;
      const wantSpacing = wantBordes ? rampBordesSpacingM : undefined;
      const wantBelokan = wantBordes && rampBordesBelokan;

      // Hitung panjang slope tetap berdasarkan nM × tinggi antar level,
      // lalu rescale anchors sehingga centerline = slope + nBordes × bordesLen.
      const li = cur.findIndex((l) => l.id === r.levelId);
      const above = li >= 0 && li < cur.length - 1 ? cur[li + 1] : null;
      const t = above ? Math.max(0, above.mdpl - cur[li].mdpl) : 0;
      const slopeLenM = t * r.nM;
      const nBordesNew = wantBordes ? numBordesForSlope(slopeLenM, rampBordesSpacingM) : 0;
      const targetLenM = slopeLenM + nBordesNew * (wantLen ?? 0);

      let nextAnchors = r.anchors;
      let nextLocked = r.lockedLenM;
      if (t > 0 && slopeLenM > 1e-3 && targetLenM > 0 && r.anchors.length >= 2) {
        const dense = tessellateReference(r.anchors, pxPerMeter, 18);
        const wPx = Math.max(0.01, r.widthM) * pxPerMeter;
        const offDense = offsetPolyline(dense, wPx, r.offsetSide);
        const N = Math.min(dense.length, offDense.length);
        const centerDense: Point[] = [];
        for (let i = 0; i < N; i++) {
          centerDense.push({ x: (dense[i].x + offDense[i].x) / 2, y: (dense[i].y + offDense[i].y) / 2 });
        }
        const curLenM = polylineLength(centerDense) / pxPerMeter;
        if (curLenM > 1e-3 && Math.abs(curLenM - targetLenM) > 1e-3) {
          const factor = targetLenM / curLenM;
          const p0 = r.anchors[0];
          nextAnchors = r.anchors.map((p, idx) => idx === 0 ? p : { ...p, x: p0.x + (p.x - p0.x) * factor, y: p0.y + (p.y - p0.y) * factor });
          nextLocked = polylineLength(nextAnchors) / pxPerMeter;
        }
      }

      const sameCfg =
        (r.bordes === true) === wantBordes &&
        (r.bordesLenM ?? undefined) === wantLen &&
        (r.bordesSpacingM ?? undefined) === wantSpacing &&
        (r.bordesBelokan === true) === wantBelokan;
      if (sameCfg && nextAnchors === r.anchors) return r;
      dirty = true;
      return {
        ...r,
        anchors: nextAnchors,
        lockedLenM: nextLocked,
        bordes: wantBordes,
        bordesLenM: wantLen,
        bordesSpacingM: wantSpacing,
        bordesBelokan: wantBelokan,
      };
    });
    if (!dirty) return;
    onChange({ ramps: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rampBordesOn, rampBordesLenM, rampBordesBelokan, rampBordesSpacingM, rampSelectedId]);
  // Parking sub-tool state
  type ParkingSubTool = ParkingSubToolKind;
  const [parkingSubTool, setParkingSubTool] = useState<ParkingSubTool>("draw");
  const [parkingKind, setParkingKind] = useState<"mobil" | "motor">("mobil");
  const [parkingSelectedId, setParkingSelectedId] = useState<string | null>(null);
  const [parkingDrag, setParkingDrag] = useState<
    | { kind: "vertex"; areaId: string; idx: number }
    | { kind: "rotate"; areaId: string; startAngle: number; startRot: number; centerWorld: { x: number; y: number } }
    | { kind: "area"; areaId: string; startWorld: { x: number; y: number }; startPoints: { x: number; y: number }[] }
    | { kind: "pathVertex"; areaId: string; pathId: string; idx: number }
    | null
  >(null);
  const parkingClipboard = useProjectStore((s) => s.parkingClipboard);
  const setParkingClipboard = useProjectStore((s) => s.setParkingClipboard);
  // Draft area parkir: tersimpan ke sketch hanya setelah tombol "Simpan Area".
  const [parkingDraft, setParkingDraft] = useState<ParkingArea | null>(null);
  // Draft polyline jalur parkir: tambah titik per-klik, commit lewat tombol.
  const [parkingPathDraft, setParkingPathDraft] = useState<
    { areaId: string; points: { x: number; y: number }[] } | null
  >(null);
  const [parkingPathHover, setParkingPathHover] = useState<{ x: number; y: number } | null>(null);
  // Sinkronkan parkingKind dengan kind area yang terpilih.
  useEffect(() => {
    if (!parkingSelectedId) return;
    const sel = (sketch.parkingAreas ?? []).find((a) => a.id === parkingSelectedId);
    if (sel?.kind && sel.kind !== parkingKind) setParkingKind(sel.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkingSelectedId, sketch.parkingAreas]);
  // Floor tool — pembuat slab lantai (entitas Floor, 150mm ke bawah dari MDPL level)
  const [floorMode, setFloorMode] = useState<FloorMode>("rect");
  const [floorDraft, setFloorDraft] = useState<
    | { outer: Point[] | null; holes: Point[][]; levelId: string | null; replaceFloorId?: string }
    | null
  >(null);
  // Edit Titik (lantai) — sub-mode + drag state
  const [floorEditSub, setFloorEditSub] = useState<"move" | "add" | "delete" | "addVoid">("move");
  // Garis Potong — sub-mode edit titik (geser bubble ujung / flip arah pandang)
  const [sectionSub, setSectionSub] = useState<"add" | "geser" | "flip">("add");
  // Garis — sub-mode: gambar garis vs "jadikan ruang" (klik area tertutup → Layer)
  const [lineSub, setLineSub] = useState<"draw" | "room">("draw");
  const [sectionEndpointDrag, setSectionEndpointDrag] = useState<
    | { idx: number; which: "p1" | "p2" }
    | null
  >(null);
  const [floorVoidDraft, setFloorVoidDraft] = useState<{ fid: string; points: Point[] } | null>(null);
  const [floorVertexDrag, setFloorVertexDrag] = useState<
    | { fid: string; ring: "outer" | number; idx: number }
    | null
  >(null);
  // Clipboard untuk Copy/Paste Lantai antar level
  const [floorClipboard, setFloorClipboard] = useState<Floor[]>([]);
  // Circle tool — center + drag radius
  const [circleDraft, setCircleDraft] = useState<{ c: Point; cur: Point; levelId?: string } | null>(null);
  // Offset tool — jarak offset (cm pada skala asli)
  const [offsetCm, setOffsetCm] = useState<number>(100);
  const [pickMaterial, setPickMaterial] = useState<EdgeMaterial>("solid");
  // Door tool — parameter & live draft (3-langkah gesture single drag).
  const [doorLeaves, setDoorLeaves] = useState<1 | 2>(1);
  const [doorWidthCm, setDoorWidthCm] = useState<number>(100);
  const [doorDraft, setDoorDraft] = useState<
    | { a: Point; dirX: number; dirY: number; b: Point; nx: number; ny: number; levelId?: string }
    | null
  >(null);
  const [doorEraseMode, setDoorEraseMode] = useState(false);
  const [doorClipboard, setDoorClipboard] = useState<Door[]>([]);
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
  // Selected vertices (Edit Titik — Geser) — multi-select via shift-click, untuk move numerik
  const [selectedEditVertices, setSelectedEditVertices] = useState<{ target: EditTarget; coord: Point }[]>([]);
  const selectedEditVertex = selectedEditVertices.length > 0 ? selectedEditVertices[selectedEditVertices.length - 1] : null;
  const [editVxDxMm, setEditVxDxMm] = useState<string>("0");
  const [editVxDyMm, setEditVxDyMm] = useState<string>("0");
  // Selected vertices (Lantai Edit Titik — Geser) — multi-select
  type FloorVertexSel = { fid: string; ring: "outer" | number; idx: number; coord: Point };
  const [selectedFloorEditVertices, setSelectedFloorEditVertices] = useState<FloorVertexSel[]>([]);
  const selectedFloorEditVertex = selectedFloorEditVertices.length > 0 ? selectedFloorEditVertices[selectedFloorEditVertices.length - 1] : null;
  const [floorVxDxMm, setFloorVxDxMm] = useState<string>("0");
  const [floorVxDyMm, setFloorVxDyMm] = useState<string>("0");
  const [filletRadiusM, setFilletRadiusM] = useState<number>(0.5);
  const [filletSegments] = useState<number>(10);
  const [addPointPreview, setAddPointPreview] = useState<Point | null>(null);
  // Polyline live-draw: stylus turuns membentuk vertex baru otomatis saat berbelok.
  // points = vertex yang sudah ter-commit; lastSample = posisi stylus terbaru sebelum cursor;
  // cursor = posisi stylus saat ini. Selesai saat pointer up atau cursor menyentuh points[0].
  const [polyDraft, setPolyDraft] = useState<
    | { points: Point[]; lastSample: Point; cursor: Point; closed?: boolean; anchors?: Point[] }
    | null
  >(null);

  // Grid Struktur stylus drag — geser origin atau expand dari 4 sudut.
  type GridDrag =
    | { kind: "move"; startWorld: Point; startOrigin: Point }
    | {
        kind: "corner";
        corner: "tl" | "tr" | "bl" | "br";
        startWorld: Point;
        startOrigin: Point;
        startSpansX: number[];
        startSpansY: number[];
        unit: number;
      };
  const [gridDrag, setGridDrag] = useState<GridDrag | null>(null);

  // Grid Struktur — edit kolom: clip polygon (sembunyikan kolom di area)
  const [gridEditMode, setGridEditMode] = useState<"expand" | "clip" | "fromLine">("expand");
  type ClipDrag = {
    clipId: string;        // id clip (atau "__draft__" jika polygon belum di-commit)
    idx: number;           // index titik yang di-drag
    moved: boolean;
    startScreen: Point;
  };
  const [clipDraft, setClipDraft] = useState<{ pts: Point[] } | null>(null); // titik dalam METER relatif origin
  const [clipDrag, setClipDrag] = useState<ClipDrag | null>(null);

  // ===== Move Tool — multi-select & translate seluruh entitas pada level aktif =====
  // Selection key format: "line:<idx>" | "layer:<id>" | "circle:<id>" |
  // "door:<id>" | "floor:<id>" | "section:<idx>"
  type MoveSelKey = string;
  type MoveSnapshot = {
    lines: Line[];
    layers: Layer[];
    circles: Circle[];
    doors: Door[];
    floors: Floor[];
    sectionCuts: SectionCut[];
  };
  type MoveDragState = {
    startWorld: Point;
    snapshot: MoveSnapshot;
    moved: boolean;
    hitKey: MoveSelKey | null;
    hitWasSelected: boolean;
    prevSel: Set<MoveSelKey>;
    shiftKey: boolean;
    appliedDx: number;
    appliedDy: number;
  };
  type MoveMarqueeState = { start: Point; cur: Point; additive: boolean };
  const [moveSel, setMoveSel] = useState<Set<MoveSelKey>>(new Set());
  const [moveDrag, setMoveDrag] = useState<MoveDragState | null>(null);
  const [moveMarquee, setMoveMarquee] = useState<MoveMarqueeState | null>(null);
  // Marquee (rubber-band) untuk memilih banyak titik di mode Edit Titik / Lantai-Geser.
  const [editVertexMarquee, setEditVertexMarquee] = useState<MoveMarqueeState | null>(null);
  const [floorVertexMarquee, setFloorVertexMarquee] = useState<MoveMarqueeState | null>(null);
  const [moveDxMm, setMoveDxMm] = useState<string>("0");
  const [moveDyMm, setMoveDyMm] = useState<string>("0");
  // Clipboard untuk Copy/Paste lintas-level. Berisi deep-clone entitas terpilih.
  type MoveClipboard = {
    lines: Line[];
    layers: Layer[];
    circles: NonNullable<Sketch["circles"]>;
    doors: Door[];
    floors: NonNullable<Sketch["floors"]>;
    sourceLevelId?: string;
  };
  const [moveClipboard, setMoveClipboard] = useState<MoveClipboard | null>(null);
  // Reset selection saat ganti tool atau ganti sketch / level aktif.
  useEffect(() => {
    if (tool !== "move") {
      setMoveDrag(null);
      setMoveMarquee(null);
    }
    if (tool !== "edit") setEditVertexMarquee(null);
    if (tool !== "floor") setFloorVertexMarquee(null);
    if (tool !== "mirror") setMirrorDraft(null);
  }, [tool]);
  useEffect(() => {
    setMoveSel(new Set());
    setMoveDrag(null);
    setMoveMarquee(null);
    setEditVertexMarquee(null);
    setFloorVertexMarquee(null);
  }, [id, activeLvlId]);



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

  // ---------- Cluster Generator (Node Editor) integration ----------
  const handleClusterGenerate = useCallback(
    (result: GenerateResult) => {
      // 1) Ensure every levelId referenced by the result exists in sketch.levels.
      const existingIds = new Set(levels.map((l) => l.id));
      const newLevels: Level[] = [];
      const idMap = new Map<string, string>();
      const usedLevelIds = Array.from(new Set(result.rooms.map((r) => r.levelId)));
      usedLevelIds.forEach((lid, i) => {
        if (existingIds.has(lid)) {
          idMap.set(lid, lid);
        } else {
          const maxMdpl = levels.concat(newLevels).reduce((m, l) => Math.max(m, l.mdpl), 0);
          const lv: Level = {
            id: lid,
            name: `Level ${levels.length + newLevels.length + 1}`,
            mdpl: maxMdpl + (i === 0 && levels.length === 0 ? 0 : 3),
            opacity: 0.5,
          };
          newLevels.push(lv);
          idMap.set(lid, lid);
        }
      });

      // 2) Compute staging origin: to the right of existing geometry (bbox of layers+lines).
      let maxX = 0, minY = 0;
      const allPts: Point[] = [];
      for (const ly of layers) for (const p of ly.points) allPts.push(p);
      for (const ln of lines) { allPts.push(ln.a); allPts.push(ln.b); }
      if (allPts.length) {
        maxX = Math.max(...allPts.map((p) => p.x));
        minY = Math.min(...allPts.map((p) => p.y));
      }
      const originX = (allPts.length ? maxX + 80 : 0);
      const originY = (allPts.length ? minY : 0);

      // 3) Build rectangle layers per room and dashed relation lines.
      const newLayers: Layer[] = [];
      const centerById = new Map<string, Point>();
      result.rooms.forEach((r, i) => {
        const cx = originX + r.cx;
        const cy = originY + r.cy;
        const h = r.side / 2;
        const pts: Point[] = [
          { x: cx - h, y: cy - h },
          { x: cx + h, y: cy - h },
          { x: cx + h, y: cy + h },
          { x: cx - h, y: cy + h },
        ];
        centerById.set(r.nodeId, { x: cx, y: cy });
        newLayers.push({
          id: `L${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 5)}`,
          name: r.name,
          points: pts,
          areaM2: r.areaM2,
          color: "#cccccc",
          levelId: r.levelId,
        });
      });

      const newLines: Line[] = [];
      result.links.forEach((l) => {
        const a = centerById.get(l.source);
        const b = centerById.get(l.target);
        if (!a || !b) return;
        const room = result.rooms.find((r) => r.nodeId === l.source);
        newLines.push({
          a: { ...a },
          b: { ...b },
          kind: "straight",
          dashed: true,
          levelId: room?.levelId,
        });
      });

      onChange({
        levels: newLevels.length ? [...levels, ...newLevels] : levels,
        layers: [...layers, ...newLayers],
        lines: [...lines, ...newLines],
        activeLevelId: activeLvlId ?? usedLevelIds[0] ?? null,
      });
      toast.success(`Spawned ${newLayers.length} ruang dari cluster generator.`);
    },
    [levels, layers, lines, onChange, activeLvlId],
  );

  // Saat skala kanvas berubah, SEMUA geometri px-world di-rescale dengan
  // faktor k = pxPerMeter_baru / pxPerMeter_lama. Tujuannya: ukuran riil
  // (meter) semua elemen — polygon ruang, luasannya, garis, lantai, pintu,
  // lingkaran, area parkir, garis potong, grid struktur, dst — TIDAK
  // berubah saat user mengganti skala. Hanya tampilan grid milimeter block
  // (rasio px/m) yang berubah.
  const prevScaleRef = useRef(scale);
  useEffect(() => {
    if (prevScaleRef.current === scale) return;
    const prevPpm = (MINOR_PX * MAJOR_EVERY) / METERS_PER_MAJOR[prevScaleRef.current];
    const newPpm = pxPerMeter;
    prevScaleRef.current = scale;
    if (!Number.isFinite(prevPpm) || prevPpm <= 0 || Math.abs(newPpm - prevPpm) < 1e-9) return;
    const k = newPpm / prevPpm;
    const sp = (p: Point): Point => ({ x: p.x * k, y: p.y * k });
    const spArr = (arr?: Point[]) => (arr ? arr.map(sp) : arr);

    const nextLines = lines.map((ln) => ({
      ...ln,
      a: sp(ln.a),
      b: sp(ln.b),
      ...(ln.c1 ? { c1: sp(ln.c1) } : {}),
      ...(ln.c2 ? { c2: sp(ln.c2) } : {}),
      ...(typeof ln.bulge === "number" ? { bulge: ln.bulge * k } : {}),
    }));
    const nextLayers = layers.map((l) => ({
      ...l,
      points: l.points.map(sp),
      // areaM2 sengaja dipertahankan apa adanya — luas riil (m²) tidak berubah.
    }));
    const nextFloors = (sketch.floors || []).map((f) => ({
      ...f,
      outer: f.outer.map(sp),
      ...(f.holes ? { holes: f.holes.map((h) => h.map(sp)) } : {}),
    }));
    const nextDoors = (sketch.doors || []).map((d) => ({
      ...d,
      a: sp(d.a),
      b: sp(d.b),
    }));
    const nextCircles = (sketch.circles || []).map((c) => ({
      ...c,
      c: sp(c.c),
      r: c.r * k,
    }));
    const nextParking = (sketch.parkingAreas || []).map((pa) => ({
      ...pa,
      pointsLocal: pa.pointsLocal.map(sp),
      ...(pa.paths
        ? { paths: pa.paths.map((p) => ({ ...p, pointsLocal: p.pointsLocal.map(sp) })) }
        : {}),
    }));
    const nextSectionCuts = (sketch.sectionCuts || []).map((c) => ({
      ...c,
      p1: sp(c.p1),
      p2: sp(c.p2),
    }));
    const nextSectionCut = sketch.sectionCut
      ? { ...sketch.sectionCut, p1: sp(sketch.sectionCut.p1), p2: sp(sketch.sectionCut.p2) }
      : sketch.sectionCut;
    const scaleGrid = (g: StructuralGrid | undefined): StructuralGrid | undefined => {
      if (!g) return g;
      return {
        ...g,
        origin: sp(g.origin),
        ...(g.extraLines
          ? {
              extraLines: g.extraLines.map((el) => ({
                ...el,
                origin: sp(el.origin),
                // lengthM tetap (meter)
              })),
            }
          : {}),
        // spansX/Y, colSizeCm, rotation, columnClips (meter relatif) tetap.
      };
    };
    const nextGrid = scaleGrid(sketch.structuralGrid);
    const nextGridExtras = sketch.structuralGridExtras
      ? sketch.structuralGridExtras.map((g) => scaleGrid(g)!).filter(Boolean)
      : sketch.structuralGridExtras;

    const nextRamps = (sketch.ramps || []).map((r) => ({
      ...r,
      anchors: r.anchors.map((a) => ({ ...sp(a), filletR: a.filletR })),
    }));

    onChange({
      lines: nextLines,
      layers: nextLayers,
      floors: nextFloors,
      doors: nextDoors,
      circles: nextCircles,
      parkingAreas: nextParking,
      ramps: nextRamps,
      sectionCuts: nextSectionCuts,
      sectionCut: nextSectionCut,
      structuralGrid: nextGrid,
      structuralGridExtras: nextGridExtras,
    });
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

  const snapPointToMillimeterGrid = useCallback(
    (p: Point, force = false): Point => {
      if (!force && !snap) return p;
      if (Math.abs(mmGridRotRad) < 1e-9) {
        return {
          x: Math.round(p.x / MINOR_PX) * MINOR_PX,
          y: Math.round(p.y / MINOR_PX) * MINOR_PX,
        };
      }
      const cs0 = Math.cos(-mmGridRotRad), sn0 = Math.sin(-mmGridRotRad);
      const lx = p.x * cs0 - p.y * sn0;
      const ly = p.x * sn0 + p.y * cs0;
      const sx = Math.round(lx / MINOR_PX) * MINOR_PX;
      const sy = Math.round(ly / MINOR_PX) * MINOR_PX;
      const cs1 = Math.cos(mmGridRotRad), sn1 = Math.sin(mmGridRotRad);
      return { x: sx * cs1 - sy * sn1, y: sx * sn1 + sy * cs1 };
    },
    [snap, mmGridRotRad],
  );

  const worldToMmLocal = useCallback((p: Point): Point => {
    if (Math.abs(mmGridRotRad) < 1e-9) return { x: p.x, y: p.y };
    const cs = Math.cos(-mmGridRotRad), sn = Math.sin(-mmGridRotRad);
    return { x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs };
  }, [mmGridRotRad]);
  const mmLocalToWorld = useCallback((p: Point): Point => {
    if (Math.abs(mmGridRotRad) < 1e-9) return { x: p.x, y: p.y };
    const cs = Math.cos(mmGridRotRad), sn = Math.sin(mmGridRotRad);
    return { x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs };
  }, [mmGridRotRad]);
  const snapMmLocal = useCallback((p: Point): Point => ({
    x: Math.round(p.x / MINOR_PX) * MINOR_PX,
    y: Math.round(p.y / MINOR_PX) * MINOR_PX,
  }), []);
  const snapWorldToMmLocal = useCallback(
    (p: Point): Point => snapMmLocal(worldToMmLocal(p)),
    [snapMmLocal, worldToMmLocal],
  );

  const snapPoint = useCallback(
    (p: Point): Point => {
      if (!snap) return p;
      // Cari kandidat snap dari vertex / midpoint pada level aktif (jika diaktifkan).
      const tolPx = 12 / Math.max(0.0001, view.s);
      let best: { p: Point; d: number } | null = null;
      const consider = (q: Point) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= tolPx && (!best || d < best.d)) best = { p: q, d };
      };
      const lvl = activeLvlId;
      const inLvl = (l?: string) => !lvl || !l || l === lvl;
      if (snapVertex || snapMidpoint) {
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          if (!inLvl(ln.levelId)) continue;
          if (snapVertex) { consider(ln.a); consider(ln.b); }
          if (snapMidpoint) consider({ x: (ln.a.x + ln.b.x) / 2, y: (ln.a.y + ln.b.y) / 2 });
        }
        for (const ly of layers) {
          if (!inLvl(ly.levelId)) continue;
          const pts = ly.points;
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            if (snapVertex) consider(a);
            if (snapMidpoint && pts.length >= 2) {
              const b = pts[(i + 1) % pts.length];
              consider({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            }
          }
        }
        for (const fl of (sketch.floors ?? [])) {
          if (!inLvl(fl.levelId)) continue;
          const pts = fl.outer;
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            if (snapVertex) consider(a);
            if (snapMidpoint && pts.length >= 2) {
              const b = pts[(i + 1) % pts.length];
              consider({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            }
          }
        }
      }
      if (best) return (best as { p: Point; d: number }).p;
      return snapPointToMillimeterGrid(p);
    },
    [snap, snapVertex, snapMidpoint, view.s, activeLvlId, lines, layers, sketch.floors, snapPointToMillimeterGrid],
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

  // ===== Move Tool — helpers =====
  // Hit-test entitas pada level aktif. `raw` di koordinat world. `tolPx` toleransi.
  const moveHitTest = useCallback(
    (raw: Point, tolPx: number): MoveSelKey | null => {
      const lvl = activeLvlId;
      const inLvl = (l?: string) => !lvl || !l || l === lvl;
      // Prioritas: door > circle > line > section > layer-edge > floor > layer-fill
      const doors = sketch.doors ?? [];
      for (const d of doors) {
        if (!inLvl(d.levelId)) continue;
        const proj = projectOnSegment(raw, d.a, d.b);
        if (dist(raw, proj) <= tolPx) return `door:${d.id}`;
      }
      const circles = sketch.circles ?? [];
      for (const c of circles) {
        if (!inLvl(c.levelId)) continue;
        const dd = Math.hypot(raw.x - c.c.x, raw.y - c.c.y);
        if (Math.abs(dd - c.r) <= tolPx) return `circle:${c.id}`;
      }
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (!inLvl(ln.levelId)) continue;
        if ((ln.kind ?? "straight") !== "straight") continue;
        const proj = projectOnSegment(raw, ln.a, ln.b);
        if (dist(raw, proj) <= tolPx) return `line:${i}`;
      }
      const cuts = sketch.sectionCuts ?? [];
      for (let i = 0; i < cuts.length; i++) {
        const c = cuts[i];
        const proj = projectOnSegment(raw, c.p1, c.p2);
        if (dist(raw, proj) <= tolPx) return `section:${i}`;
      }
      for (const ly of layers) {
        if (!inLvl(ly.levelId)) continue;
        if (ly.points.length < 2) continue;
        for (let i = 0; i < ly.points.length; i++) {
          const a = ly.points[i];
          const b = ly.points[(i + 1) % ly.points.length];
          const proj = projectOnSegment(raw, a, b);
          if (dist(raw, proj) <= tolPx) return `layer:${ly.id}`;
        }
      }
      const floors = sketch.floors ?? [];
      for (const fl of floors) {
        if (!inLvl(fl.levelId)) continue;
        if (fl.outer.length < 2) continue;
        for (let i = 0; i < fl.outer.length; i++) {
          const a = fl.outer[i];
          const b = fl.outer[(i + 1) % fl.outer.length];
          const proj = projectOnSegment(raw, a, b);
          if (dist(raw, proj) <= tolPx) return `floor:${fl.id}`;
        }
      }
      // Hit-fill (di dalam polygon) sebagai fallback
      for (const ly of layers) {
        if (!inLvl(ly.levelId)) continue;
        if (ly.points.length >= 3 && pointInPolygon(raw, ly.points)) return `layer:${ly.id}`;
      }
      for (const fl of floors) {
        if (!inLvl(fl.levelId)) continue;
        if (fl.outer.length >= 3 && pointInPolygon(raw, fl.outer)) return `floor:${fl.id}`;
      }
      for (const c of circles) {
        if (!inLvl(c.levelId)) continue;
        if (Math.hypot(raw.x - c.c.x, raw.y - c.c.y) <= c.r) return `circle:${c.id}`;
      }
      return null;
    },
    [activeLvlId, lines, layers, sketch.doors, sketch.circles, sketch.floors, sketch.sectionCuts],
  );

  // Daftar semua entitas di level aktif sebagai keys (utk "Pilih semua").
  const moveAllKeysActiveLevel = useCallback((): MoveSelKey[] => {
    const lvl = activeLvlId;
    const inLvl = (l?: string) => !lvl || !l || l === lvl;
    const out: MoveSelKey[] = [];
    lines.forEach((ln, i) => { if (inLvl(ln.levelId)) out.push(`line:${i}`); });
    layers.forEach((ly) => { if (inLvl(ly.levelId)) out.push(`layer:${ly.id}`); });
    (sketch.circles ?? []).forEach((c) => { if (inLvl(c.levelId)) out.push(`circle:${c.id}`); });
    (sketch.doors ?? []).forEach((d) => { if (inLvl(d.levelId)) out.push(`door:${d.id}`); });
    (sketch.floors ?? []).forEach((f) => { if (inLvl(f.levelId)) out.push(`floor:${f.id}`); });
    (sketch.sectionCuts ?? []).forEach((_, i) => out.push(`section:${i}`));
    return out;
  }, [activeLvlId, lines, layers, sketch.circles, sketch.doors, sketch.floors, sketch.sectionCuts]);

  // Bangun snapshot untuk drag.
  const buildMoveSnapshot = useCallback((): MoveSnapshot => ({
    lines: lines.map((l) => ({ ...l, a: { ...l.a }, b: { ...l.b }, c1: l.c1 ? { ...l.c1 } : undefined, c2: l.c2 ? { ...l.c2 } : undefined })),
    layers: layers.map((l) => ({ ...l, points: l.points.map((p) => ({ ...p })) })),
    circles: (sketch.circles ?? []).map((c) => ({ ...c, c: { ...c.c } })),
    doors: (sketch.doors ?? []).map((d) => ({ ...d, a: { ...d.a }, b: { ...d.b } })),
    floors: (sketch.floors ?? []).map((f) => ({
      ...f,
      outer: f.outer.map((p) => ({ ...p })),
      holes: f.holes ? f.holes.map((h) => h.map((p) => ({ ...p }))) : undefined,
    })),
    sectionCuts: (sketch.sectionCuts ?? []).map((c) => ({ ...c, p1: { ...c.p1 }, p2: { ...c.p2 } })),
  }), [lines, layers, sketch.circles, sketch.doors, sketch.floors, sketch.sectionCuts]);

  // Snap delta translasi ke 1 blok mm-grid (MINOR_PX) di frame mm-grid lokal.
  const snapDeltaMm = useCallback((dx: number, dy: number): { dx: number; dy: number } => {
    const cs0 = Math.cos(-mmGridRotRad), sn0 = Math.sin(-mmGridRotRad);
    const lx = dx * cs0 - dy * sn0;
    const ly = dx * sn0 + dy * cs0;
    const sx = Math.round(lx / MINOR_PX) * MINOR_PX;
    const sy = Math.round(ly / MINOR_PX) * MINOR_PX;
    const cs1 = Math.cos(mmGridRotRad), sn1 = Math.sin(mmGridRotRad);
    return { dx: sx * cs1 - sy * sn1, dy: sx * sn1 + sy * cs1 };
  }, [mmGridRotRad]);

  // Translasi snapshot menjadi patch sketsa berdasar selection.
  const buildTranslatedPatch = useCallback(
    (snap: MoveSnapshot, sel: Set<MoveSelKey>, dx: number, dy: number): Partial<Sketch> => {
      const T = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
      const nextLines = snap.lines.map((ln, i) => {
        if (!sel.has(`line:${i}`)) return ln;
        return { ...ln, a: T(ln.a), b: T(ln.b), c1: ln.c1 ? T(ln.c1) : undefined, c2: ln.c2 ? T(ln.c2) : undefined };
      });
      const nextLayers = snap.layers.map((ly) =>
        sel.has(`layer:${ly.id}`) ? { ...ly, points: ly.points.map(T) } : ly,
      );
      const nextCircles = snap.circles.map((c) =>
        sel.has(`circle:${c.id}`) ? { ...c, c: T(c.c) } : c,
      );
      const nextDoors = snap.doors.map((d) =>
        sel.has(`door:${d.id}`) ? { ...d, a: T(d.a), b: T(d.b) } : d,
      );
      const nextFloors = snap.floors.map((f) => {
        if (!sel.has(`floor:${f.id}`)) return f;
        return {
          ...f,
          outer: f.outer.map(T),
          holes: f.holes ? f.holes.map((h) => h.map(T)) : undefined,
        };
      });
      const nextCuts = snap.sectionCuts.map((c, i) =>
        sel.has(`section:${i}`) ? { ...c, p1: T(c.p1), p2: T(c.p2), updatedAt: Date.now() } : c,
      );
      const patch: Partial<Sketch> = {
        lines: nextLines,
        layers: nextLayers,
        circles: nextCircles,
        doors: nextDoors,
        floors: nextFloors,
      };
      // Hanya overwrite sectionCuts bila memang ada perubahan.
      if (snap.sectionCuts.some((_, i) => sel.has(`section:${i}`))) {
        patch.sectionCuts = nextCuts;
      }
      return patch;
    },
    [],
  );

  // ===== Copy / Paste lintas-level =====
  // Salin entitas terpilih (moveSel) ke clipboard. Section cuts dilewati
  // karena bersifat global (tidak terikat level).
  const handleCopySelection = useCallback(() => {
    if (moveSel.size === 0) {
      toast.error("Tidak ada objek terpilih untuk disalin");
      return;
    }
    const clip: MoveClipboard = {
      lines: [],
      layers: [],
      circles: [],
      doors: [],
      floors: [],
      sourceLevelId: activeLvlId ?? undefined,
    };
    lines.forEach((ln, i) => {
      if (!moveSel.has(`line:${i}`)) return;
      clip.lines.push({
        ...ln,
        a: { ...ln.a },
        b: { ...ln.b },
        c1: ln.c1 ? { ...ln.c1 } : undefined,
        c2: ln.c2 ? { ...ln.c2 } : undefined,
      });
    });
    layers.forEach((ly) => {
      if (!moveSel.has(`layer:${ly.id}`)) return;
      clip.layers.push({ ...ly, points: ly.points.map((p) => ({ ...p })) });
    });
    (sketch.circles ?? []).forEach((c) => {
      if (!moveSel.has(`circle:${c.id}`)) return;
      clip.circles.push({ ...c, c: { ...c.c } });
    });
    (sketch.doors ?? []).forEach((d) => {
      if (!moveSel.has(`door:${d.id}`)) return;
      clip.doors.push({ ...d, a: { ...d.a }, b: { ...d.b } });
    });
    (sketch.floors ?? []).forEach((f) => {
      if (!moveSel.has(`floor:${f.id}`)) return;
      clip.floors.push({
        ...f,
        outer: f.outer.map((p) => ({ ...p })),
        holes: f.holes ? f.holes.map((h) => h.map((p) => ({ ...p }))) : undefined,
      });
    });
    const total =
      clip.lines.length + clip.layers.length + clip.circles.length +
      clip.doors.length + clip.floors.length;
    if (total === 0) {
      toast.error("Pilihan tidak berisi objek yang dapat disalin");
      return;
    }
    setMoveClipboard(clip);
    toast.success(`Tersalin ${total} objek ke clipboard`);
  }, [moveSel, lines, layers, sketch.circles, sketch.doors, sketch.floors, activeLvlId]);

  // Tempel clipboard ke level aktif (atau ke `targetLevelId` jika diberikan).
  // ID baru di-generate; posisi koordinat dipertahankan sehingga objek tetap
  // di lokasi yang sama (berguna untuk salin tipikal antar-lantai).
  const handlePasteClipboard = useCallback(
    (targetLevelId?: string) => {
      const clip = moveClipboard;
      if (!clip) {
        toast.error("Clipboard kosong — salin (copy) dulu");
        return;
      }
      const lvlId = targetLevelId ?? activeLvlId ?? undefined;
      const rand = () => Math.random().toString(36).slice(2, 7);
      const newSel = new Set<MoveSelKey>();
      pushHistory();
      // Lines: append; index = posisi setelah append.
      const pastedLines: Line[] = clip.lines.map((ln) => ({
        ...ln,
        a: { ...ln.a },
        b: { ...ln.b },
        c1: ln.c1 ? { ...ln.c1 } : undefined,
        c2: ln.c2 ? { ...ln.c2 } : undefined,
        levelId: lvlId,
      }));
      const nextLines = [...lines, ...pastedLines];
      pastedLines.forEach((_, i) => newSel.add(`line:${lines.length + i}`));
      // Layers
      const pastedLayers: Layer[] = clip.layers.map((ly) => {
        const nid = `L${Date.now()}_${rand()}`;
        newSel.add(`layer:${nid}`);
        return {
          ...ly,
          id: nid,
          levelId: lvlId,
          points: ly.points.map((p) => ({ ...p })),
        };
      });
      const nextLayers = [...layers, ...pastedLayers];
      // Circles
      const pastedCircles = clip.circles.map((c) => {
        const nid = `CIR${Date.now()}_${rand()}`;
        newSel.add(`circle:${nid}`);
        return { ...c, id: nid, levelId: lvlId, c: { ...c.c } };
      });
      const nextCircles = [...(sketch.circles ?? []), ...pastedCircles];
      // Doors
      const pastedDoors = clip.doors.map((d) => {
        const nid = genDoorId();
        newSel.add(`door:${nid}`);
        return { ...d, id: nid, levelId: lvlId, a: { ...d.a }, b: { ...d.b } };
      });
      const nextDoors = [...(sketch.doors ?? []), ...pastedDoors];
      // Floors
      const pastedFloors = clip.floors.map((f) => {
        const nid = genFloorId();
        newSel.add(`floor:${nid}`);
        return {
          ...f,
          id: nid,
          levelId: lvlId ?? f.levelId,
          createdAt: Date.now(),
          outer: f.outer.map((p) => ({ ...p })),
          holes: f.holes ? f.holes.map((h) => h.map((p) => ({ ...p }))) : undefined,
        };
      });
      const nextFloors = [...(sketch.floors ?? []), ...pastedFloors];
      onChange({
        lines: nextLines,
        layers: nextLayers,
        circles: nextCircles,
        doors: nextDoors,
        floors: nextFloors,
      });
      setMoveSel(newSel);
      const total =
        pastedLines.length + pastedLayers.length + pastedCircles.length +
        pastedDoors.length + pastedFloors.length;
      const lvlName = levels.find((l) => l.id === lvlId)?.name ?? "level aktif";
      toast.success(`Tempel ${total} objek ke ${lvlName}`);
    },
    [moveClipboard, activeLvlId, lines, layers, sketch.circles, sketch.doors, sketch.floors, onChange, pushHistory, levels],
  );

  // ===== Mirror Tool =====
  // Duplikasi entitas terpilih (moveSel) dengan refleksi melintasi sumbu
  // melalui titik origin pada sudut 0/45/90/135 derajat. Sumbu ditentukan
  // dengan menarik dari titik origin (snap vertex/grid) ke arah; sudut
  // arah di-snap ke 0/45/90/135 (mod 180).
  type MirrorDraft = {
    origin: Point;
    cur: Point;
    angleDeg: 0 | 45 | 90 | 135;
  };
  const [mirrorDraft, setMirrorDraft] = useState<MirrorDraft | null>(null);

  const snapMirrorAngle = useCallback((origin: Point, cur: Point): 0 | 45 | 90 | 135 => {
    const dx = cur.x - origin.x;
    const dy = cur.y - origin.y;
    if (Math.hypot(dx, dy) < 1e-6) return 0;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const mod = ((ang % 180) + 180) % 180; // 0..180
    const cands: (0 | 45 | 90 | 135)[] = [0, 45, 90, 135];
    let best: 0 | 45 | 90 | 135 = 0;
    let bestD = Infinity;
    for (const c of cands) {
      const d = Math.min(Math.abs(c - mod), Math.abs(c + 180 - mod));
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }, []);

  const reflectPt = useCallback((p: Point, origin: Point, angleRad: number): Point => {
    const dx = p.x - origin.x, dy = p.y - origin.y;
    const c = Math.cos(2 * angleRad), s = Math.sin(2 * angleRad);
    return { x: origin.x + dx * c + dy * s, y: origin.y + dx * s - dy * c };
  }, []);

  const reflectDir = useCallback((d: Point, angleRad: number): Point => {
    const c = Math.cos(2 * angleRad), s = Math.sin(2 * angleRad);
    return { x: d.x * c + d.y * s, y: d.x * s - d.y * c };
  }, []);

  const applyMirrorCommit = useCallback((draft: MirrorDraft) => {
    if (moveSel.size === 0) {
      toast.error("Pilih objek dulu lewat tool Move sebelum mirror");
      return;
    }
    const angleRad = (draft.angleDeg * Math.PI) / 180;
    const R = (p: Point) => reflectPt(p, draft.origin, angleRad);
    const rand = () => Math.random().toString(36).slice(2, 7);
    const lvlId = activeLvlId ?? undefined;
    const newSel = new Set<MoveSelKey>();
    pushHistory();

    // Lines
    const newLines: Line[] = [];
    lines.forEach((ln, i) => {
      if (!moveSel.has(`line:${i}`)) return;
      // Refleksi membalik orientasi — agar arc/bezier visual mirror, tukar a<->b
      // dan tukar control point c1<->c2.
      const aR = R(ln.b);
      const bR = R(ln.a);
      const c1R = ln.c2 ? R(ln.c2) : undefined;
      const c2R = ln.c1 ? R(ln.c1) : undefined;
      const bulge = typeof ln.bulge === "number" ? -ln.bulge : undefined;
      newLines.push({
        ...ln,
        a: aR,
        b: bR,
        c1: c1R,
        c2: c2R,
        bulge,
        levelId: ln.levelId ?? lvlId,
      });
    });
    const nextLines = [...lines, ...newLines];
    newLines.forEach((_, i) => newSel.add(`line:${lines.length + i}`));

    // Layers — reverse winding agar tetap konsisten
    const newLayers: Layer[] = layers.flatMap((ly) => {
      if (!moveSel.has(`layer:${ly.id}`)) return [];
      const nid = `L${Date.now()}_${rand()}`;
      newSel.add(`layer:${nid}`);
      return [{
        ...ly,
        id: nid,
        points: ly.points.map(R).reverse(),
      }];
    });
    const nextLayers = [...layers, ...newLayers];

    // Circles
    const newCircles = (sketch.circles ?? []).flatMap((c) => {
      if (!moveSel.has(`circle:${c.id}`)) return [];
      const nid = `CIR${Date.now()}_${rand()}`;
      newSel.add(`circle:${nid}`);
      return [{ ...c, id: nid, c: R(c.c) }];
    });
    const nextCircles = [...(sketch.circles ?? []), ...newCircles];

    // Doors — reflect endpoints dan vektor normal arah ayun
    const newDoors = (sketch.doors ?? []).flatMap((d) => {
      if (!moveSel.has(`door:${d.id}`)) return [];
      const nid = genDoorId();
      newSel.add(`door:${nid}`);
      const n = reflectDir({ x: d.nx, y: d.ny }, angleRad);
      return [{
        ...d,
        id: nid,
        a: R(d.a),
        b: R(d.b),
        nx: n.x,
        ny: n.y,
      }];
    });
    const nextDoors = [...(sketch.doors ?? []), ...newDoors];

    // Floors — reverse winding
    const newFloors = (sketch.floors ?? []).flatMap((f) => {
      if (!moveSel.has(`floor:${f.id}`)) return [];
      const nid = genFloorId();
      newSel.add(`floor:${nid}`);
      return [{
        ...f,
        id: nid,
        createdAt: Date.now(),
        outer: f.outer.map(R).reverse(),
        holes: f.holes ? f.holes.map((h) => h.map(R).reverse()) : undefined,
      }];
    });
    const nextFloors = [...(sketch.floors ?? []), ...newFloors];

    // Section cuts
    let cutsChanged = false;
    const nextCuts = [...(sketch.sectionCuts ?? [])];
    (sketch.sectionCuts ?? []).forEach((c, i) => {
      if (!moveSel.has(`section:${i}`)) return;
      cutsChanged = true;
      nextCuts.push({ ...c, p1: R(c.p1), p2: R(c.p2), updatedAt: Date.now() });
      newSel.add(`section:${nextCuts.length - 1}`);
    });

    const patch: Partial<Sketch> = {
      lines: nextLines,
      layers: nextLayers,
      circles: nextCircles,
      doors: nextDoors,
      floors: nextFloors,
    };
    if (cutsChanged) patch.sectionCuts = nextCuts;
    onChange(patch);
    setMoveSel(newSel);
    const total =
      newLines.length + newLayers.length + newCircles.length +
      newDoors.length + newFloors.length;
    toast.success(`Mirror ${total} objek pada sumbu ${draft.angleDeg}°`);
  }, [
    moveSel, lines, layers, sketch.circles, sketch.doors, sketch.floors,
    sketch.sectionCuts, onChange, pushHistory, activeLvlId,
    reflectPt, reflectDir,
  ]);




  // ===== Parkir: obstacle index + generator stall (per level aktif) =====
  const parkingObstacles = useMemo<ParkingObstacle[]>(() => {
    const obs: ParkingObstacle[] = [];
    const wallBufferPx = 0.075 * pxPerMeter; // 7.5 cm
    for (const ln of lines) {
      if (activeLvlId && ln.levelId !== activeLvlId) continue;
      if ((ln.kind ?? "straight") !== "straight") continue;
      obs.push({ kind: "wall", a: ln.a, b: ln.b, bufferPx: wallBufferPx });
    }
    const grids = collectGrids(primaryGrid, gridExtras);
    const lv = levels.find((l) => l.id === activeLvlId);
    if (lv) {
      for (const g of grids) {
        if (g.lineOnly) continue;
        if (!levelInRange(g, lv, levels)) continue;
        const { spansX, spansY } = spansForLevel(g, lv.id);
        const halfCol = ((g.colSizeCm / 100) * pxPerMeter) / 2;
        const ang = ((g.rotation ?? 0) * Math.PI) / 180;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const posX = axisPositions(spansX);
        const posY = axisPositions(spansY);
        for (let j = 0; j < posY.length; j++) {
          for (let i = 0; i < posX.length; i++) {
            if (!isColumnVisible(g, lv.id, i, j, spansX, spansY)) continue;
            const lx = posX[i] * pxPerMeter;
            const ly = posY[j] * pxPerMeter;
            const wx = g.origin.x + lx * cos - ly * sin;
            const wy = g.origin.y + lx * sin + ly * cos;
            const corners = [
              { x: -halfCol, y: -halfCol },
              { x:  halfCol, y: -halfCol },
              { x:  halfCol, y:  halfCol },
              { x: -halfCol, y:  halfCol },
            ].map((c) => ({
              x: wx + c.x * cos - c.y * sin,
              y: wy + c.x * sin + c.y * cos,
            }));
            obs.push({ kind: "polygon", poly: corners });
          }
        }
      }
    }
    // Layers (ruang) → obstacle, KECUALI yang nama-nya mengandung "parkir"/
    // "parking". Hanya ruang itu yang boleh dihuni lot parkir.
    for (const ly of layers) {
      if (activeLvlId && ly.levelId !== activeLvlId) continue;
      if (!Array.isArray(ly.points) || ly.points.length < 3) continue;
      if (isParkingName(ly.name)) continue;
      obs.push({ kind: "polygon", poly: ly.points.map((p) => ({ x: p.x, y: p.y })) });
    }
    // Jalur parkir (polyline) → obstacle wall ber-buffer 1.75 m / sisi.
    const areasForPath = (sketch.parkingAreas ?? []).filter(
      (p) => !activeLvlId || p.levelId === activeLvlId,
    );
    obs.push(...parkingPathsToObstacles(areasForPath, pxPerMeter, mmGridRotRad));
    // Tambahkan juga draft jalur (live preview) jika area target di level aktif.
    if (parkingPathDraft && parkingPathDraft.points.length >= 2) {
      const target = (sketch.parkingAreas ?? []).find((a) => a.id === parkingPathDraft.areaId);
      if (target && (!activeLvlId || target.levelId === activeLvlId)) {
        const buf = PARKING_PATH_BUFFER_M * pxPerMeter;
        const cs = Math.cos(mmGridRotRad), sn = Math.sin(mmGridRotRad);
        const w = parkingPathDraft.points.map((p) => ({ x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs }));
        for (let i = 0; i < w.length - 1; i++) {
          obs.push({ kind: "wall", a: w[i], b: w[i + 1], bufferPx: buf });
        }
      }
    }
    return obs;
  }, [lines, activeLvlId, pxPerMeter, primaryGrid, gridExtras, levels, layers, sketch.parkingAreas, mmGridRotRad, parkingPathDraft]);

  // parkingStallsActive di-deklarasi setelah parkingDiffableInfo (lihat di
  // bawah) — pass-2 generation memakai effective diffable keys.

  // Generator obstacle untuk level mana saja (dipakai untuk akumulasi global
  // diffable). Pola identik dengan `parkingObstacles` tetapi filter level
  // disetel ke `targetLvlId`.
  const buildObstaclesForLevel = useCallback((targetLvlId: string | undefined): ParkingObstacle[] => {
    const obs: ParkingObstacle[] = [];
    const wallBufferPx = 0.075 * pxPerMeter;
    for (const ln of lines) {
      if (targetLvlId && ln.levelId !== targetLvlId) continue;
      if ((ln.kind ?? "straight") !== "straight") continue;
      obs.push({ kind: "wall", a: ln.a, b: ln.b, bufferPx: wallBufferPx });
    }
    const grids = collectGrids(primaryGrid, gridExtras);
    const lv = levels.find((l) => l.id === targetLvlId);
    if (lv) {
      for (const g of grids) {
        if (g.lineOnly) continue;
        if (!levelInRange(g, lv, levels)) continue;
        const { spansX, spansY } = spansForLevel(g, lv.id);
        const halfCol = ((g.colSizeCm / 100) * pxPerMeter) / 2;
        const ang = ((g.rotation ?? 0) * Math.PI) / 180;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const posX = axisPositions(spansX);
        const posY = axisPositions(spansY);
        for (let j = 0; j < posY.length; j++) {
          for (let i = 0; i < posX.length; i++) {
            if (!isColumnVisible(g, lv.id, i, j, spansX, spansY)) continue;
            const lx = posX[i] * pxPerMeter;
            const ly = posY[j] * pxPerMeter;
            const wx = g.origin.x + lx * cos - ly * sin;
            const wy = g.origin.y + lx * sin + ly * cos;
            const corners = [
              { x: -halfCol, y: -halfCol }, { x:  halfCol, y: -halfCol },
              { x:  halfCol, y:  halfCol }, { x: -halfCol, y:  halfCol },
            ].map((c) => ({ x: wx + c.x * cos - c.y * sin, y: wy + c.x * sin + c.y * cos }));
            obs.push({ kind: "polygon", poly: corners });
          }
        }
      }
    }
    for (const ly of layers) {
      if (targetLvlId && ly.levelId !== targetLvlId) continue;
      if (!Array.isArray(ly.points) || ly.points.length < 3) continue;
      if (isParkingName(ly.name)) continue;
      obs.push({ kind: "polygon", poly: ly.points.map((p) => ({ x: p.x, y: p.y })) });
    }
    const areasForPath = (sketch.parkingAreas ?? []).filter(
      (p) => !targetLvlId || p.levelId === targetLvlId,
    );
    obs.push(...parkingPathsToObstacles(areasForPath, pxPerMeter, mmGridRotRad));
    return obs;
  }, [lines, pxPerMeter, primaryGrid, gridExtras, levels, layers, sketch.parkingAreas, mmGridRotRad]);

  // ===== Diffable global ====================================================
  // 1) Hitung total lot mobil per level (level-aktif memakai parkingStallsActive,
  //    level lain dihitung ulang dengan obstacle level itu).
  // 2) Target diffable global dari formula → distribusi merata per level
  //    (sisa diberikan dari level paling bawah; level paling ATAS dapat paling
  //    sedikit).
  // 3) Pilih stall efektif diffable per area: pakai `area.diffable` (yang masih
  //    valid) lebih dulu; jika kurang, isi dengan stall pertama (deterministik).
  const parkingDiffableInfo = useMemo(() => {
    const allAreas = sketch.parkingAreas ?? [];
    const mobilAreas = allAreas.filter((a) => (a.kind ?? "mobil") === "mobil");
    const areasByLvl = new Map<string, ParkingArea[]>();
    for (const a of mobilAreas) {
      const lid = a.levelId ?? "";
      if (!lid) continue;
      const arr = areasByLvl.get(lid) ?? [];
      arr.push(a);
      areasByLvl.set(lid, arr);
    }
    const stallsByArea = new Map<string, ParkingStall[]>();
    for (const [lid, areas] of areasByLvl) {
      const obs = lid === activeLvlId ? parkingObstacles : buildObstaclesForLevel(lid);
      for (const area of areas) {
        // Pass-1: pakai hanya manual `area.diffable` agar baseline stabil.
        const manualSet = new Set(area.diffable ?? []);
        stallsByArea.set(area.id, generateStalls(area, pxPerMeter, mmGridRotRad, obs, manualSet));
      }
    }
    const baseByLevel = new Map<string, number>();
    let baseTotal = 0;
    for (const [lid, areas] of areasByLvl) {
      let n = 0;
      for (const a of areas) {
        const ss = stallsByArea.get(a.id) ?? [];
        for (const s of ss) if (s.valid) n++;
      }
      baseByLevel.set(lid, n);
      baseTotal += n;
    }
    const diffableTotal = computeDiffableTotal(baseTotal);
    const lvlsAsc = [...areasByLvl.keys()]
      .map((id) => levels.find((l) => l.id === id))
      .filter((x): x is Level => !!x && (baseByLevel.get(x.id) ?? 0) > 0)
      .sort((a, b) => a.mdpl - b.mdpl)
      .map((l) => l.id);
    const targetByLevel = distributeDiffableAcrossLevels(lvlsAsc, diffableTotal);
    const effectiveByArea = new Map<string, Set<string>>();
    for (const [lid, areas] of areasByLvl) {
      let need = Math.min(targetByLevel.get(lid) ?? 0, baseByLevel.get(lid) ?? 0);
      const pickedByArea = new Map<string, Set<string>>();
      for (const a of areas) pickedByArea.set(a.id, new Set());
      if (need <= 0) {
        for (const [aid, set] of pickedByArea) effectiveByArea.set(aid, set);
        continue;
      }
      const validKeysByArea = new Map<string, Set<string>>();
      const orderSlots: Array<{ areaId: string; key: string }> = [];
      for (const a of areas) {
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
      for (const a of areas) {
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
      for (const [aid, set] of pickedByArea) effectiveByArea.set(aid, set);
    }
    return { effectiveByArea, baseByLevel, targetByLevel, diffableTotal, baseTotal };
  }, [sketch.parkingAreas, levels, activeLvlId, parkingObstacles, buildObstaclesForLevel, pxPerMeter, mmGridRotRad]);

  // Pass-2: generate stalls untuk level aktif dengan effective diffable keys
  // (manual + auto). Diffable lebih lebar (3.7 m) → mendorong stall sekitar.
  const parkingStallsActive = useMemo<Array<{ areaId: string; stalls: ParkingStall[] }>>(() => {
    const out: Array<{ areaId: string; stalls: ParkingStall[] }> = [];
    const areas = (sketch.parkingAreas ?? []).filter((p) => !activeLvlId || p.levelId === activeLvlId);
    for (const area of areas) {
      const diffKeys = parkingDiffableInfo.effectiveByArea.get(area.id);
      out.push({
        areaId: area.id,
        stalls: generateStalls(area, pxPerMeter, mmGridRotRad, parkingObstacles, diffKeys),
      });
    }
    return out;
  }, [sketch.parkingAreas, activeLvlId, pxPerMeter, mmGridRotRad, parkingObstacles, parkingDiffableInfo]);





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

    // Minor + Major grid (in world units), dengan rotasi tampilan opsional di sekitar titik (0,0).
    {
      ctx.save();
      if (mmGridRotRad !== 0) ctx.rotate(mmGridRotRad);
      // Hitung bounds visible dalam mm-grid frame (inverse-rotate 4 sudut world).
      const cs = Math.cos(-mmGridRotRad), sn = Math.sin(-mmGridRotRad);
      const localCorners = corners.map((c) => ({ x: c.x * cs - c.y * sn, y: c.x * sn + c.y * cs }));
      const lMinX = Math.min(...localCorners.map((c) => c.x));
      const lMaxX = Math.max(...localCorners.map((c) => c.x));
      const lMinY = Math.min(...localCorners.map((c) => c.y));
      const lMaxY = Math.max(...localCorners.map((c) => c.y));
      const lx0 = Math.floor(lMinX / MINOR_PX) * MINOR_PX;
      const ly0 = Math.floor(lMinY / MINOR_PX) * MINOR_PX;
      // Minor
      ctx.strokeStyle = "rgba(180, 90, 60, 0.22)";
      ctx.lineWidth = 1 / s;
      ctx.beginPath();
      for (let x = lx0; x <= lMaxX; x += MINOR_PX) { ctx.moveTo(x, lMinY); ctx.lineTo(x, lMaxY); }
      for (let y = ly0; y <= lMaxY; y += MINOR_PX) { ctx.moveTo(lMinX, y); ctx.lineTo(lMaxX, y); }
      ctx.stroke();
      // Major
      ctx.strokeStyle = "rgba(160, 60, 30, 0.55)";
      ctx.lineWidth = 1.2 / s;
      ctx.beginPath();
      const lxm0 = Math.floor(lMinX / major) * major;
      const lym0 = Math.floor(lMinY / major) * major;
      for (let x = lxm0; x <= lMaxX; x += major) { ctx.moveTo(x, lMinY); ctx.lineTo(x, lMaxY); }
      for (let y = lym0; y <= lMaxY; y += major) { ctx.moveTo(lMinX, y); ctx.lineTo(lMaxX, y); }
      ctx.stroke();
      ctx.restore();
    }

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
          const fillBase = isAtapHijauLayerName(layer.name)
            ? ATAP_HIJAU_FILL_RGBA
            : isBalkonLayerName(layer.name) || isAtapLayerName(layer.name)
              ? ABU_MUDA_FILL_RGBA
              : isTamanLayerName(layer.name)
                ? TAMAN_FILL_RGBA
                : (colorForRoomName(layer.name) ?? layer.color);
          ctx.fillStyle = fillBase.replace("ALPHA", layer.locked ? "0.4" : "0.32");
          ctx.fill();
          ctx.strokeStyle = fillBase.replace("ALPHA", "0.95");
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
        ctx.strokeStyle = ln.dashed ? "rgba(232,93,58,0.85)" : (locked ? "#2d2d2d" : "#1a1a1a");
        ctx.lineWidth = (ln.dashed ? 1.4 : (locked ? 2.6 : 2)) / s;
        if (ln.dashed) ctx.setLineDash([6 / s, 4 / s]);
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
        if (ln.dashed) ctx.setLineDash([]);
      }

      // Endpoints
      ctx.fillStyle = "#1a1a1a";
      for (const ln of lvlLines) {
        if (ln.dashed) continue;
        for (const p of [ln.a, ln.b]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3 / s, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Lingkaran (circles) per level
      const lvlCircles = (sketch.circles ?? []).filter(
        (c) => (c.levelId ?? fallbackLvl) === lvl.id,
      );
      if (lvlCircles.length) {
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 2 / s;
        ctx.fillStyle = "#1a1a1a";
        for (const cc of lvlCircles) {
          ctx.beginPath();
          ctx.arc(cc.c.x, cc.c.y, cc.r, 0, Math.PI * 2);
          ctx.stroke();
          // tanda pusat
          ctx.beginPath();
          ctx.arc(cc.c.x, cc.c.y, 2 / s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;

    // ----- Overlay material edges (Attribute Painter) -----
    {
      const attrs = sketch.edgeAttrs ?? {};
      const hasAny = Object.keys(attrs).length > 0;
      if (hasAny || tool === "pick") {
        const allSegs = computeStraightSegments(lines);
        ctx.save();
        ctx.lineCap = "round";
        for (const seg of allSegs) {
          if (!activeLvlId || seg.levelId !== activeLvlId) continue;
          const mat = attrs[seg.id];
          if (!mat) continue;
          ctx.strokeStyle = MATERIAL_COLORS[mat];
          ctx.lineWidth = (mat === "solid" ? 4.5 : 4) / s;
          ctx.globalAlpha = 0.95;
          ctx.beginPath();
          ctx.moveTo(seg.a.x, seg.a.y);
          ctx.lineTo(seg.b.x, seg.b.y);
          ctx.stroke();
        }
        // Sorot node split saat pick aktif supaya batas segmen terlihat.
        if (tool === "pick") {
          const nodeKeys = new Set<string>();
          for (const seg of allSegs) {
            if (!activeLvlId || seg.levelId !== activeLvlId) continue;
            nodeKeys.add(`${seg.a.x.toFixed(3)},${seg.a.y.toFixed(3)}`);
            nodeKeys.add(`${seg.b.x.toFixed(3)},${seg.b.y.toFixed(3)}`);
          }
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "rgba(232,93,58,0.95)";
          ctx.lineWidth = 1.5 / s;
          for (const k of nodeKeys) {
            const [xs, ys] = k.split(",");
            const x = Number(xs), y = Number(ys);
            ctx.beginPath();
            ctx.arc(x, y, 3.5 / s, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // ----- Notasi Pintu (committed) -----
    {
      const doors = sketch.doors ?? [];
      for (const d of doors) {
        if (activeLvlId && d.levelId !== activeLvlId) continue;
        const ax = d.a.x, ay = d.a.y;
        const bx = d.b.x, by = d.b.y;
        const widthPx = (d.widthCm / 100) * pxPerMeter;
        // Mask gap di dinding
        const dirX = (bx - ax) / (Math.hypot(bx - ax, by - ay) || 1);
        const dirY = (by - ay) / (Math.hypot(bx - ax, by - ay) || 1);
        const thick = (0.15 * pxPerMeter); // 150mm
        const pnx = -dirY, pny = dirX;
        ctx.save();
        ctx.fillStyle = "#f6efe3";
        ctx.beginPath();
        ctx.moveTo(ax + pnx * thick * 0.6, ay + pny * thick * 0.6);
        ctx.lineTo(bx + pnx * thick * 0.6, by + pny * thick * 0.6);
        ctx.lineTo(bx - pnx * thick * 0.6, by - pny * thick * 0.6);
        ctx.lineTo(ax - pnx * thick * 0.6, ay - pny * thick * 0.6);
        ctx.closePath();
        ctx.fill();
        // Daun pintu + arc
        ctx.strokeStyle = "#0a0a0a";
        ctx.lineWidth = 1.6 / s;
        if (d.leaves === 1) {
          const lx = ax + d.nx * widthPx;
          const ly = ay + d.ny * widthPx;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(lx, ly);
          ctx.stroke();
          // arc dari leaf-end ke B (radius widthPx, pusat A)
          const a0 = Math.atan2(d.ny, d.nx);
          const a1 = Math.atan2(by - ay, bx - ax);
          ctx.beginPath();
          ctx.setLineDash([4 / s, 3 / s]);
          // tentukan arah pendek
          let delta = a1 - a0;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          ctx.arc(ax, ay, widthPx, a0, a0 + delta, delta < 0);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          // 2 daun: dari A dan B masing-masing widthPx/2
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const half = widthPx / 2;
          const la = { x: ax + d.nx * half, y: ay + d.ny * half };
          const lb = { x: bx + d.nx * half, y: by + d.ny * half };
          ctx.beginPath();
          ctx.moveTo(ax, ay); ctx.lineTo(la.x, la.y);
          ctx.moveTo(bx, by); ctx.lineTo(lb.x, lb.y);
          ctx.stroke();
          ctx.setLineDash([4 / s, 3 / s]);
          ctx.beginPath();
          const a0a = Math.atan2(d.ny, d.nx);
          const a1a = Math.atan2(my - ay, mx - ax);
          let da = a1a - a0a;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          ctx.arc(ax, ay, half, a0a, a0a + da, da < 0);
          const a0b = Math.atan2(d.ny, d.nx);
          const a1b = Math.atan2(my - by, mx - bx);
          let db = a1b - a0b;
          while (db > Math.PI) db -= Math.PI * 2;
          while (db < -Math.PI) db += Math.PI * 2;
          ctx.arc(bx, by, half, a0b, a0b + db, db < 0);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // Engsel marker
        ctx.fillStyle = "#e85d3a";
        ctx.beginPath();
        ctx.arc(ax, ay, 3 / s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ----- Door draft preview -----
    if (doorDraft && tool === "door") {
      const ax = doorDraft.a.x, ay = doorDraft.a.y;
      const bx = doorDraft.b.x, by = doorDraft.b.y;
      const widthPx = (doorWidthCm / 100) * pxPerMeter;
      ctx.save();
      ctx.strokeStyle = "rgba(232,93,58,0.95)";
      ctx.lineWidth = 2.4 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.stroke();
      // arc preview
      ctx.setLineDash([3 / s, 3 / s]);
      ctx.lineWidth = 1.4 / s;
      ctx.strokeStyle = "rgba(232,93,58,0.7)";
      const a0 = Math.atan2(doorDraft.ny, doorDraft.nx);
      const a1 = Math.atan2(by - ay, bx - ax);
      let delta = a1 - a0;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      ctx.beginPath();
      ctx.arc(ax, ay, doorLeaves === 2 ? widthPx / 2 : widthPx, a0, a0 + delta, delta < 0);
      void (0); // placeholder
      ctx.stroke();
      ctx.setLineDash([]);
      // Hinge marker
      ctx.fillStyle = "#e85d3a";
      ctx.beginPath();
      ctx.arc(ax, ay, 4 / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }


    // Active drawing preview (during drag)
    if (drawing) {
      const isFloorRect = tool === "floor" && floorMode === "rect";
      if (isFloorRect) {
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 2 / s;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = "rgba(232, 93, 58, 0.9)";
        ctx.lineWidth = 2 / s;
        ctx.setLineDash([6 / s, 4 / s]);
      }
      ctx.beginPath();
      const isRectPreview = tool === "rect" || isFloorRect;
      if (isRectPreview) {
        // Persegi mengikuti rotasi grid milimeter block: bangun di frame lokal
        // (un-rotate kedua sudut diagonal), snap ke MINOR_PX di lokal, lalu
        // rotasi balik 4 sudutnya. Ini menjamin sisi-sisi rect benar-benar
        // berada di garis grid milimeter block pada semua tingkat zoom.
        const la = rotateAround(drawing.a, { x: 0, y: 0 }, -mmGridRotRad);
        const lb = rotateAround(drawing.b, { x: 0, y: 0 }, -mmGridRotRad);
        const snapL = (v: number) => Math.round(v / MINOR_PX) * MINOR_PX;
        // Floor rect: a/b sudah ter-snap (vertex/midpoint/grid) — jangan re-snap mm grid.
        const sx = (v: number) => (isFloorRect ? v : snapL(v));
        const lx1 = sx(Math.min(la.x, lb.x));
        const lx2 = sx(Math.max(la.x, lb.x));
        const ly1 = sx(Math.min(la.y, lb.y));
        const ly2 = sx(Math.max(la.y, lb.y));
        const corners = [
          { x: lx1, y: ly1 }, { x: lx2, y: ly1 },
          { x: lx2, y: ly2 }, { x: lx1, y: ly2 },
        ].map((p) => rotateAround(p, { x: 0, y: 0 }, mmGridRotRad));
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.stroke();
        if (!isFloorRect) {
          ctx.fillStyle = "rgba(232, 93, 58, 0.10)";
          ctx.fill();
        }
        // Tanda silang preview bila rect berada di dalam floor existing (calon void)
        if (isFloorRect) {
          const floors = sketch.floors ?? [];
          const cornersWorld = corners;
          const allInside = floors.some((fl) =>
            fl.levelId === activeLvlId &&
            cornersWorld.every((c) => floorPointInPolygon(c, fl.outer)) &&
            !(fl.holes ?? []).some((h) => cornersWorld.every((c) => floorPointInPolygon(c, h))),
          );
          if (allInside) {
            ctx.save();
            ctx.strokeStyle = "#1a1a1a";
            ctx.lineWidth = 1.5 / s;
            ctx.setLineDash([4 / s, 3 / s]);
            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y); ctx.lineTo(corners[2].x, corners[2].y);
            ctx.moveTo(corners[1].x, corners[1].y); ctx.lineTo(corners[3].x, corners[3].y);
            ctx.stroke();
            ctx.restore();
          }
        }
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

    // Circle draft preview
    if (circleDraft && tool === "circle") {
      const r = Math.hypot(circleDraft.cur.x - circleDraft.c.x, circleDraft.cur.y - circleDraft.c.y);
      ctx.save();
      ctx.strokeStyle = "rgba(232, 93, 58, 0.95)";
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.beginPath();
      ctx.arc(circleDraft.c.x, circleDraft.c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // garis radius + label
      ctx.beginPath();
      ctx.moveTo(circleDraft.c.x, circleDraft.c.y);
      ctx.lineTo(circleDraft.cur.x, circleDraft.cur.y);
      ctx.lineWidth = 1 / s;
      ctx.stroke();
      const fontPx = 11 / s;
      ctx.font = `600 ${fontPx}px var(--font-display), sans-serif`;
      ctx.fillStyle = "rgba(232,93,58,0.95)";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`R ${(r / pxPerMeter).toFixed(2)} m`, circleDraft.cur.x + 4 / s, circleDraft.cur.y - 4 / s);
      // pusat
      ctx.fillStyle = "rgba(232,93,58,1)";
      ctx.beginPath();
      ctx.arc(circleDraft.c.x, circleDraft.c.y, 3 / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }


    // Polyline draft preview
    if (polyDraft) {
      const pts = polyDraft.points;
      const anchors = polyDraft.anchors;
      const isCurve = !!anchors && anchors.length > 0;
      const firstRef = isCurve ? anchors![0] : pts[0];
      const lastAnchor = isCurve ? anchors![anchors!.length - 1] : pts[pts.length - 1];
      const isFloorCurve = tool === "floor" && (floorMode === "arc" || floorMode === "bezier");
      const minToClose = isCurve && isFloorCurve ? 2 : 3;
      const closing =
        (isCurve ? anchors!.length >= minToClose : pts.length >= 3) &&
        dist(polyDraft.cursor, firstRef) <= 14 / s;
      ctx.strokeStyle = "rgba(232, 93, 58, 0.95)";
      ctx.lineWidth = 2 / s;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      // Garis aktif ke cursor — lurus untuk line/polyline, lengkung untuk arc/bezier
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.beginPath();
      if (isCurve && tool === "floor" && (floorMode === "arc" || floorMode === "bezier")) {
        const target = closing ? firstRef : polyDraft.cursor;
        const previewLine: Line = floorMode === "arc"
          ? { a: lastAnchor, b: target, kind: "arc", bulge: defaultBulgePx(lastAnchor, target) }
          : { a: lastAnchor, b: target, kind: "bezier", ...defaultBezierHandles(lastAnchor, target) };
        const pv = sampleLine(previewLine, 24);
        ctx.moveTo(pv[0].x, pv[0].y);
        for (let i = 1; i < pv.length; i++) ctx.lineTo(pv[i].x, pv[i].y);
      } else {
        ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.lineTo(polyDraft.cursor.x, polyDraft.cursor.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Vertex markers — anchors saja bila mode kurva (agar tessellated points tidak penuh dot)
      ctx.fillStyle = "rgba(232, 93, 58, 1)";
      const markers = isCurve ? anchors! : pts;
      for (const v of markers) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 4 / s, 0, Math.PI * 2);
        ctx.fill();
      }
      // Highlight titik awal saat siap ditutup
      if (closing) {
        ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
        ctx.lineWidth = 2.5 / s;
        ctx.beginPath();
        ctx.arc(firstRef.x, firstRef.y, 10 / s, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(232, 93, 58, 0.7)";
        ctx.lineWidth = 1.5 / s;
        ctx.beginPath();
        ctx.arc(firstRef.x, firstRef.y, 8 / s, 0, Math.PI * 2);
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
        // Highlight bubble ujung saat sub-mode edit aktif (geser/flip)
        if (!it.isLive && tool === "section" && sectionSub !== "add") {
          const hr = labelR + 4 / s;
          ctx.strokeStyle = sectionSub === "flip" ? "rgba(34,211,238,0.95)" : "rgba(0,212,255,0.95)";
          ctx.lineWidth = 1.6 / s;
          ctx.setLineDash([4 / s, 3 / s]);
          ctx.beginPath();
          ctx.arc(cutA.x, cutA.y, hr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cutB.x, cutB.y, hr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
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
      const selKeys = new Set(selectedEditVertices.map((sv) => keyOf(sv.coord)));
      verts.forEach((v) => {
        const k = keyOf(v.p);
        const isSel = selKeys.has(k);
        ctx.beginPath();
        ctx.arc(v.p.x, v.p.y, (isSel ? 7.5 : 6) / s, 0, Math.PI * 2);
        ctx.fillStyle = isSel
          ? "rgba(0,212,255,0.95)"
          : v.locked
          ? "rgba(120,120,120,0.85)"
          : (deleteMode ? "rgba(220,40,40,0.95)" : "#fff");
        ctx.fill();
        ctx.lineWidth = (isSel ? 2.5 : 2) / s;
        ctx.strokeStyle = isSel
          ? "rgba(0,150,200,1)"
          : v.locked
          ? "#666"
          : (deleteMode ? "#7a1010" : "rgba(232,93,58,1)");
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

    // ----- Modul Struktur: render grid INAKTIF (extras yang bukan grid edit aktif) sebagai ghost -----
    if (activeLvlId) {
      const activeLvGhost = levels.find((l) => l.id === activeLvlId);
      const allGridsForGhost: Array<{ g: StructuralGrid; idx: number }> = [];
      if (primaryGrid.enabled) allGridsForGhost.push({ g: primaryGrid, idx: 0 });
      gridExtras.forEach((g, i) => { if (g.enabled) allGridsForGhost.push({ g, idx: i + 1 }); });
      for (const ent of allGridsForGhost) {
        if (ent.idx === editGridIdx) continue; // grid aktif dirender block utama di bawah
        const g = ent.g;
        if (!activeLvGhost || !levelInRange(g, activeLvGhost, levels)) continue;
        const { spansX, spansY } = spansForLevel(g, activeLvGhost.id);
        const ppm = pxPerMeter;
        const xs = axisPositions(spansX).map((m) => g.origin.x + m * ppm);
        const ys = axisPositions(spansY).map((m) => g.origin.y + m * ppm);
        const xMin = xs[0], xMax = xs[xs.length - 1];
        const yMin = ys[0], yMax = ys[ys.length - 1];
        const bubbleOff = 22 / s;
        const gRotRad = ((Number(g.rotation) || 0) * Math.PI) / 180;
        ctx.save();
        if (gRotRad !== 0) {
          ctx.translate(g.origin.x, g.origin.y);
          ctx.rotate(gRotRad);
          ctx.translate(-g.origin.x, -g.origin.y);
        }
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = "rgba(80,80,80,0.85)";
        ctx.lineWidth = 0.3 / s;
        ctx.setLineDash([10 / s, 5 / s, 1.5 / s, 5 / s]);
        ctx.beginPath();
        if (g.lineOnly) {
          ctx.moveTo(xs[0] - bubbleOff, ys[0]);
          ctx.lineTo(xs[xs.length - 1] + bubbleOff, ys[0]);
        } else {
          for (const x of xs) { ctx.moveTo(x, yMin - bubbleOff); ctx.lineTo(x, yMax + bubbleOff); }
          for (const y of ys) { ctx.moveTo(xMin - bubbleOff, y); ctx.lineTo(xMax + bubbleOff, y); }
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (!g.lineOnly) {
          const colPx = (g.colSizeCm / 100) * ppm;
          const posXM = axisPositions(spansX);
          const posYM = axisPositions(spansY);
          ctx.fillStyle = "rgba(40,40,40,0.55)";
          for (let j = 0; j < ys.length; j++) {
            for (let i = 0; i < xs.length; i++) {
              if (!isNodeActive(g, activeLvGhost.id, i, j)) continue;
              if (isColumnClipped(g, posXM[i], posYM[j])) continue;
              ctx.fillRect(xs[i] - colPx / 2, ys[j] - colPx / 2, colPx, colPx);
            }
          }
        }
        ctx.restore();
      }
    }

    // ----- Modul Struktur (grid aktif + kolom) -----
    if (grid.enabled && activeLvlId) {
      const activeLv = levels.find((l) => l.id === activeLvlId);
      if (activeLv && levelInRange(grid, activeLv, levels)) {
        const { spansX, spansY } = spansForLevel(grid, activeLv.id);
        const posX = axisPositions(spansX);
        const posY = axisPositions(spansY);
        const ox = grid.origin.x;
        const oy = grid.origin.y;
        const ppm = pxPerMeter;
        const xs = posX.map((m) => ox + m * ppm);
        const ys = posY.map((m) => oy + m * ppm);
        const xMin = xs[0], xMax = xs[xs.length - 1];
        const yMin = ys[0], yMax = ys[ys.length - 1];
        const bubbleOff = 22 / s;
        const bubbleR = 7 / s;

        // Wrapper rotasi grid struktur (di sekitar origin grid)
        ctx.save();
        if (structGridRotRad !== 0) {
          ctx.translate(ox, oy);
          ctx.rotate(structGridRotRad);
          ctx.translate(-ox, -oy);
        }

        // Garis as dash-dot
        ctx.save();
        ctx.strokeStyle = "rgba(20,20,20,0.85)";
        ctx.lineWidth = 0.4 / s;
        ctx.setLineDash([14 / s, 6 / s, 2 / s, 6 / s]);
        ctx.beginPath();
        if (grid.lineOnly) {
          // Hanya satu garis sepanjang sumbu X dari xMin..xMax di y=oy
          ctx.moveTo(xMin - bubbleOff, ys[0]);
          ctx.lineTo(xMax + bubbleOff, ys[0]);
        } else {
          for (const x of xs) {
            ctx.moveTo(x, yMin - bubbleOff);
            ctx.lineTo(x, yMax + bubbleOff);
          }
          for (const y of ys) {
            ctx.moveTo(xMin - bubbleOff, y);
            ctx.lineTo(xMax + bubbleOff, y);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Bubbles
        ctx.font = `600 ${7 / s}px var(--font-display), sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const hideSX = Boolean(grid.hideBubbleStartX);
        const hideEX = Boolean(grid.hideBubbleEndX);
        const hideSY = Boolean(grid.hideBubbleStartY);
        const hideEY = Boolean(grid.hideBubbleEndY);
        if (grid.lineOnly) {
          // satu bubble di tiap ujung garis, sejajar dengan garis
          const lastI = xs.length - 1;
          const ends: Array<{ i: number; x: number; hide: boolean }> = [
            { i: 0, x: xs[0] - bubbleOff, hide: hideSX },
            { i: lastI, x: xs[lastI] + bubbleOff, hide: hideEX },
          ];
          for (const e of ends) {
            if (e.hide) continue;
            ctx.beginPath();
            ctx.arc(e.x, ys[0], bubbleR, 0, Math.PI * 2);
            ctx.fillStyle = "#fff";
            ctx.fill();
            ctx.lineWidth = 0.4 / s;
            ctx.strokeStyle = "#0a0a0a";
            ctx.stroke();
            ctx.fillStyle = "#0a0a0a";
            ctx.fillText(xAxisLabelAt(e.i, grid.labelOffsetX ?? 0), e.x, ys[0]);
          }
        } else {
          for (let i = 0; i < xs.length; i++) {
            const ends: Array<{ y: number; hide: boolean }> = [
              { y: yMin - bubbleOff, hide: hideSY },
              { y: yMax + bubbleOff, hide: hideEY },
            ];
            for (const e of ends) {
              if (e.hide) continue;
              ctx.beginPath();
              ctx.arc(xs[i], e.y, bubbleR, 0, Math.PI * 2);
              ctx.fillStyle = "#fff";
              ctx.fill();
              ctx.lineWidth = 0.4 / s;
              ctx.strokeStyle = "#0a0a0a";
              ctx.stroke();
              ctx.fillStyle = "#0a0a0a";
              ctx.fillText(xAxisLabelAt(i, grid.labelOffsetX ?? 0), xs[i], e.y);
            }
          }
          for (let j = 0; j < ys.length; j++) {
            const ends: Array<{ x: number; hide: boolean }> = [
              { x: xMin - bubbleOff, hide: hideSX },
              { x: xMax + bubbleOff, hide: hideEX },
            ];
            for (const e of ends) {
              if (e.hide) continue;
              ctx.beginPath();
              ctx.arc(e.x, ys[j], bubbleR, 0, Math.PI * 2);
              ctx.fillStyle = "#fff";
              ctx.fill();
              ctx.lineWidth = 0.4 / s;
              ctx.strokeStyle = "#0a0a0a";
              ctx.stroke();
              ctx.fillStyle = "#0a0a0a";
              ctx.fillText(yAxisLabelAt(j, grid.labelOffsetY ?? 0), e.x, ys[j]);
            }
          }
        }

        // Kolom hitam padat di tiap titik potong (skip area clip)
        const colPx = (grid.colSizeCm / 100) * ppm;
        const posXM = axisPositions(spansX);
        const posYM = axisPositions(spansY);
        ctx.fillStyle = "#0a0a0a";
        if (grid.lineOnly) {
          // skip kolom untuk grid garis tunggal
        } else

        for (let j = 0; j < ys.length; j++) {
          for (let i = 0; i < xs.length; i++) {
            if (!isNodeActive(grid, activeLv.id, i, j)) {
              // disabled marker
              ctx.save();
              ctx.strokeStyle = "rgba(220,50,50,0.7)";
              ctx.lineWidth = 0.8 / s;
              ctx.beginPath();
              ctx.arc(xs[i], ys[j], colPx * 0.7, 0, Math.PI * 2);
              ctx.moveTo(xs[i] - colPx * 0.5, ys[j] - colPx * 0.5);
              ctx.lineTo(xs[i] + colPx * 0.5, ys[j] + colPx * 0.5);
              ctx.stroke();
              ctx.restore();
              continue;
            }
            if (isColumnClipped(grid, posXM[i], posYM[j])) {
              // clipped marker (titik kecil agar terlihat lokasinya saat edit)
              if (tool === "grid") {
                ctx.save();
                ctx.strokeStyle = "rgba(232,93,58,0.55)";
                ctx.setLineDash([2 / s, 2 / s]);
                ctx.lineWidth = 0.6 / s;
                ctx.strokeRect(xs[i] - colPx / 2, ys[j] - colPx / 2, colPx, colPx);
                ctx.restore();
              }
              continue;
            }
            ctx.fillRect(xs[i] - colPx / 2, ys[j] - colPx / 2, colPx, colPx);
          }
        }

        // Render clip polygons (dan draft) saat tool grid aktif
        if (tool === "grid") {
          const allClips: Array<{ id: string; pts: Point[]; isDraft: boolean }> = [];
          for (const c of grid.columnClips ?? []) {
            allClips.push({
              id: c.id,
              pts: c.pts.map((p) => ({ x: ox + p.x * ppm, y: oy + p.y * ppm })),
              isDraft: false,
            });
          }
          if (clipDraft && clipDraft.pts.length) {
            allClips.push({
              id: "__draft__",
              pts: clipDraft.pts.map((p) => ({ x: ox + p.x * ppm, y: oy + p.y * ppm })),
              isDraft: true,
            });
          }
          for (const cp of allClips) {
            if (cp.pts.length === 0) continue;
            ctx.save();
            ctx.fillStyle = cp.isDraft
              ? "rgba(232,93,58,0.12)"
              : "rgba(232,93,58,0.18)";
            ctx.strokeStyle = "rgba(232,93,58,0.95)";
            ctx.lineWidth = 1.2 / s;
            if (cp.isDraft) ctx.setLineDash([6 / s, 4 / s]);
            ctx.beginPath();
            ctx.moveTo(cp.pts[0].x, cp.pts[0].y);
            for (let k = 1; k < cp.pts.length; k++) ctx.lineTo(cp.pts[k].x, cp.pts[k].y);
            if (cp.pts.length >= 3) ctx.closePath();
            if (cp.pts.length >= 3) ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);
            // handle titik
            const hR = 6 / s;
            for (const p of cp.pts) {
              ctx.beginPath();
              ctx.arc(p.x, p.y, hR, 0, Math.PI * 2);
              ctx.fillStyle = "#fff";
              ctx.fill();
              ctx.strokeStyle = "rgba(232,93,58,0.95)";
              ctx.lineWidth = 1.2 / s;
              ctx.stroke();
            }
            ctx.restore();
          }
        }

        // Corner handles (stylus drag → expand di 4 arah)
        if (tool === "grid") {
          const hSize = 20 / s;
          const corners: Array<{ x: number; y: number }> = [
            { x: xMin, y: yMin }, { x: xMax, y: yMin },
            { x: xMin, y: yMax }, { x: xMax, y: yMax },
          ];
          for (const c of corners) {
            ctx.save();
            ctx.fillStyle = "rgba(232,93,58,0.95)";
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1.5 / s;
            ctx.fillRect(c.x - hSize / 2, c.y - hSize / 2, hSize, hSize);
            ctx.strokeRect(c.x - hSize / 2, c.y - hSize / 2, hSize, hSize);
            ctx.restore();
          }
        }
        ctx.restore();
        ctx.restore(); // tutup wrapper rotasi grid struktur
      }
    }

    // ----- Modul Struktur: extraLines (garis2 hasil "Jadikan Grid" yang
    //       tergabung dalam grid induk). Render di world coords. -----
    {
      const all: Array<{ g: StructuralGrid; idx: number }> = [];
      if (primaryGrid?.enabled) all.push({ g: primaryGrid, idx: 0 });
      gridExtras.forEach((g, i) => { if (g?.enabled) all.push({ g, idx: i + 1 }); });
      const activeLv = levels.find((l) => l.id === activeLvlId);
      for (const ent of all) {
        const g = ent.g;
        if (!g.extraLines || !g.extraLines.length) continue;
        if (activeLv && !levelInRange(g, activeLv, levels)) continue;
        const isActive = ent.idx === editGridIdx;
        const ppm = pxPerMeter;
        const bubbleOff = 22 / s;
        const bubbleR = 7 / s;
        const baseIdx = (g.labelOffsetX ?? 0) + g.spansX.length + 1;
        ctx.save();
        ctx.font = `600 ${7 / s}px var(--font-display), sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        g.extraLines.forEach((el, li) => {
          const lenPx = el.lengthM * ppm;
          ctx.save();
          ctx.translate(el.origin.x, el.origin.y);
          ctx.rotate((el.rotation * Math.PI) / 180);
          // garis
          ctx.strokeStyle = isActive ? "rgba(20,20,20,0.85)" : "rgba(80,80,80,0.6)";
          ctx.lineWidth = (isActive ? 0.4 : 0.3) / s;
          ctx.setLineDash([14 / s, 6 / s, 2 / s, 6 / s]);
          ctx.beginPath();
          ctx.moveTo(-bubbleOff, 0);
          ctx.lineTo(lenPx + bubbleOff, 0);
          ctx.stroke();
          ctx.setLineDash([]);
          // bubbles — satu label sama di kedua ujung
          const label = xAxisLabelAt(baseIdx + li, 0);
          const ends: Array<{ x: number; hide: boolean }> = [
            { x: -bubbleOff, hide: !!el.hideStart },
            { x: lenPx + bubbleOff, hide: !!el.hideEnd },
          ];
          for (const e of ends) {
            if (e.hide) continue;
            ctx.beginPath();
            ctx.arc(e.x, 0, bubbleR, 0, Math.PI * 2);
            ctx.fillStyle = "#fff";
            ctx.fill();
            ctx.lineWidth = 0.4 / s;
            ctx.strokeStyle = "#0a0a0a";
            ctx.stroke();
            ctx.fillStyle = "#0a0a0a";
            // teks harus tetap tegak — un-rotate
            ctx.save();
            ctx.translate(e.x, 0);
            ctx.rotate((-el.rotation * Math.PI) / 180);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
          ctx.restore();
        });
        ctx.restore();
      }
    }


    if (hover && tool === "line" && !drawing) {
      ctx.fillStyle = "rgba(232,93,58,0.9)";
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 4 / s, 0, Math.PI * 2);
      ctx.fill();
    }

    // ----- Move Tool: highlight selection + marquee (world-space) -----
    if (tool === "move" || tool === "mirror") {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(232,93,58,0.95)";
      ctx.fillStyle = "rgba(232,93,58,0.18)";
      ctx.lineWidth = 2.2 / s;
      ctx.setLineDash([]);
      const strokeLine = (a: Point, b: Point) => {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      };
      moveSel.forEach((key) => {
        const [kind, id] = key.split(":");
        if (kind === "line") {
          const ln = lines[Number(id)];
          if (ln) strokeLine(ln.a, ln.b);
        } else if (kind === "layer") {
          const ly = layers.find((l) => l.id === id);
          if (ly && ly.points.length >= 2) {
            ctx.beginPath();
            ly.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.closePath(); ctx.fill(); ctx.stroke();
          }
        } else if (kind === "circle") {
          const c = (sketch.circles ?? []).find((x) => x.id === id);
          if (c) {
            ctx.beginPath(); ctx.arc(c.c.x, c.c.y, c.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        } else if (kind === "door") {
          const d = (sketch.doors ?? []).find((x) => x.id === id);
          if (d) strokeLine(d.a, d.b);
        } else if (kind === "floor") {
          const f = (sketch.floors ?? []).find((x) => x.id === id);
          if (f && f.outer.length >= 2) {
            ctx.beginPath();
            f.outer.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.closePath(); ctx.fill(); ctx.stroke();
          }
        } else if (kind === "section") {
          const c = (sketch.sectionCuts ?? [])[Number(id)];
          if (c) strokeLine(c.p1, c.p2);
        }
      });
      // Marquee
      if (moveMarquee) {
        const mm = moveMarquee;
        const x0 = Math.min(mm.start.x, mm.cur.x);
        const y0 = Math.min(mm.start.y, mm.cur.y);
        const w = Math.abs(mm.cur.x - mm.start.x);
        const h = Math.abs(mm.cur.y - mm.start.y);
        ctx.setLineDash([6 / s, 4 / s]);
        ctx.lineWidth = 1.2 / s;
        ctx.strokeStyle = "rgba(232,93,58,0.9)";
        ctx.fillStyle = "rgba(232,93,58,0.08)";
        ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ----- Mirror Tool: axis preview + reflected ghost -----
    if (tool === "mirror" && mirrorDraft) {
      const md = mirrorDraft;
      const angleRad = (md.angleDeg * Math.PI) / 180;
      const ux = Math.cos(angleRad), uy = Math.sin(angleRad);
      const L = 100000 / s;
      const ax = { x: md.origin.x - ux * L, y: md.origin.y - uy * L };
      const bx = { x: md.origin.x + ux * L, y: md.origin.y + uy * L };
      ctx.save();
      // Axis line
      ctx.strokeStyle = "rgba(34,211,238,0.9)";
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([8 / s, 5 / s]);
      ctx.beginPath();
      ctx.moveTo(ax.x, ax.y); ctx.lineTo(bx.x, bx.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Origin marker
      ctx.fillStyle = "rgba(34,211,238,1)";
      ctx.beginPath();
      ctx.arc(md.origin.x, md.origin.y, 5 / s, 0, Math.PI * 2);
      ctx.fill();
      // Reflected ghost of selected items
      const R = (p: Point) => reflectPt(p, md.origin, angleRad);
      ctx.strokeStyle = "rgba(34,211,238,0.85)";
      ctx.fillStyle = "rgba(34,211,238,0.15)";
      ctx.lineWidth = 1.6 / s;
      const sLine = (a: Point, b: Point) => {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };
      moveSel.forEach((key) => {
        const [kind, id] = key.split(":");
        if (kind === "line") {
          const ln = lines[Number(id)];
          if (ln) sLine(R(ln.a), R(ln.b));
        } else if (kind === "layer") {
          const ly = layers.find((l) => l.id === id);
          if (ly && ly.points.length >= 2) {
            ctx.beginPath();
            ly.points.forEach((p, i) => {
              const q = R(p);
              i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
            });
            ctx.closePath(); ctx.fill(); ctx.stroke();
          }
        } else if (kind === "circle") {
          const c = (sketch.circles ?? []).find((x) => x.id === id);
          if (c) {
            const cc = R(c.c);
            ctx.beginPath(); ctx.arc(cc.x, cc.y, c.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        } else if (kind === "door") {
          const d = (sketch.doors ?? []).find((x) => x.id === id);
          if (d) sLine(R(d.a), R(d.b));
        } else if (kind === "floor") {
          const f = (sketch.floors ?? []).find((x) => x.id === id);
          if (f && f.outer.length >= 2) {
            ctx.beginPath();
            f.outer.forEach((p, i) => {
              const q = R(p);
              i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
            });
            ctx.closePath(); ctx.fill(); ctx.stroke();
          }
        } else if (kind === "section") {
          const c = (sketch.sectionCuts ?? [])[Number(id)];
          if (c) sLine(R(c.p1), R(c.p2));
        }
      });
      ctx.restore();
    }

    // ----- Edit-Titik / Lantai-Geser marquee (world-space, cyan) -----
    {
      const drawVertexMarquee = (mm: { start: Point; cur: Point }) => {
        const s2 = view.s;
        const x0 = Math.min(mm.start.x, mm.cur.x);
        const y0 = Math.min(mm.start.y, mm.cur.y);
        const w = Math.abs(mm.cur.x - mm.start.x);
        const h = Math.abs(mm.cur.y - mm.start.y);
        ctx.save();
        ctx.setLineDash([6 / s2, 4 / s2]);
        ctx.lineWidth = 1.2 / s2;
        ctx.strokeStyle = "rgba(0,212,255,0.95)";
        ctx.fillStyle = "rgba(0,212,255,0.12)";
        ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      };
      if (editVertexMarquee) drawVertexMarquee(editVertexMarquee);
      if (floorVertexMarquee) drawVertexMarquee(floorVertexMarquee);
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

    // ===== Lantai (slab) — outline + hatch + label nama level =====
    const allFloors = sketch.floors ?? [];
    if (allFloors.length) {
      ctx.save();
      ctx.translate(view.tx, view.ty);
      ctx.rotate(view.r);
      ctx.scale(view.s, view.s);
      for (const fl of allFloors) {
        const lvl = levels.find((l) => l.id === fl.levelId);
        const alpha = !lvl || activeLvlId == null || lvl.id === activeLvlId ? 1 : Math.min(lvl.opacity, 0.35);
        if (alpha <= 0.001) continue;
        ctx.globalAlpha = alpha;
        // Build path: outer CW, holes CCW (canvas evenodd will handle it regardless)
        ctx.beginPath();
        fl.outer.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.closePath();
        for (const hole of fl.holes ?? []) {
          hole.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
          ctx.closePath();
        }
        ctx.fillStyle = "rgba(232,93,58,0.10)";
        (ctx as CanvasRenderingContext2D).fill("evenodd");
        ctx.lineWidth = 2 / view.s;
        ctx.strokeStyle = "rgba(232,93,58,0.85)";
        ctx.stroke();
        // hole outlines + tanda silang (X) untuk menandai void
        for (const hole of fl.holes ?? []) {
          ctx.beginPath();
          hole.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
          ctx.closePath();
          ctx.setLineDash([6 / view.s, 4 / view.s]);
          ctx.strokeStyle = "rgba(120,40,20,0.9)";
          ctx.lineWidth = 1.5 / view.s;
          ctx.stroke();
          ctx.setLineDash([]);
          // bounding box untuk tanda silang
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of hole) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          ctx.beginPath();
          ctx.moveTo(minX, minY); ctx.lineTo(maxX, maxY);
          ctx.moveTo(maxX, minY); ctx.lineTo(minX, maxY);
          ctx.strokeStyle = "rgba(120,40,20,0.7)";
          ctx.lineWidth = 1 / view.s;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      // Label nama level + luas lantai di centroid floor (screen-space) — mirip label ruang
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const fl of allFloors) {
        const lvl = levels.find((l) => l.id === fl.levelId);
        if (!lvl) continue;
        if (activeLvlId != null && lvl.id !== activeLvlId) continue;
        const c = floorPolyCentroid(fl.outer);
        const sp = worldToScreen(c);
        const holesArr = fl.holes ?? [];
        const areaPx = Math.max(0, floorPolyArea(fl.outer) - holesArr.reduce((s, h) => s + floorPolyArea(h), 0));
        const areaM2 = areaPx / (pxPerMeter * pxPerMeter);
        const nameText = `Lantai · ${lvl.name}`;
        const areaText = `${areaM2.toFixed(2)} m²`;
        ctx.font = "600 13px Manrope, sans-serif";
        const nameW = ctx.measureText(nameText).width;
        ctx.font = "700 12px Manrope, sans-serif";
        const areaW = ctx.measureText(areaText).width;
        const boxW = Math.max(nameW, areaW) + 16;
        const boxH = 38;
        const boxR = 8;
        const bx = sp.x - boxW / 2, by = sp.y - boxH / 2;
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.beginPath();
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
        ctx.fillStyle = "rgba(180,55,30,0.95)";
        ctx.font = "600 13px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(nameText, sp.x, sp.y - 3);
        ctx.fillStyle = "rgba(80,25,10,0.95)";
        ctx.font = "700 12px Manrope, sans-serif";
        ctx.fillText(areaText, sp.x, sp.y + 14);
        ctx.textAlign = "start";
      }
      ctx.restore();
    }

    // Floor draft preview (mode "attach"): tampilkan outer + holes yang sedang dipilih
    if (tool === "floor" && floorDraft && floorDraft.outer) {
      ctx.save();
      ctx.translate(view.tx, view.ty);
      ctx.rotate(view.r);
      ctx.scale(view.s, view.s);
      ctx.beginPath();
      floorDraft.outer.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath();
      for (const h of floorDraft.holes) {
        h.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.closePath();
      }
      ctx.fillStyle = "rgba(232,93,58,0.22)";
      (ctx as CanvasRenderingContext2D).fill("evenodd");
      ctx.lineWidth = 3 / view.s;
      ctx.strokeStyle = "rgba(232,93,58,1)";
      ctx.stroke();
      ctx.restore();
    }

    // Vertex handles untuk Edit Titik Lantai
    if (tool === "floor" && floorMode === "edit") {
      ctx.save();
      const flList = (sketch.floors ?? []).filter((f) => !activeLvlId || f.levelId === activeLvlId);
      const selKey = (fid: string, ring: "outer" | number, idx: number) => `${fid}|${ring}|${idx}`;
      const selSet = new Set(selectedFloorEditVertices.map((sv) => selKey(sv.fid, sv.ring, sv.idx)));
      const drawHandle = (w: Point, isSel: boolean) => {
        const s = worldToScreen(w);
        ctx.beginPath();
        ctx.arc(s.x, s.y, isSel ? 6.5 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isSel
          ? "rgba(0,212,255,0.95)"
          : floorEditSub === "move" ? "#e85d3a" : floorEditSub === "delete" ? "#c62828" : "#fff";
        ctx.strokeStyle = isSel ? "rgba(0,120,160,1)" : "#1a1a1a";
        ctx.lineWidth = isSel ? 2 : 1.5;
        ctx.fill();
        ctx.stroke();
      };
      for (const fl of flList) {
        fl.outer.forEach((p, i) => drawHandle(p, selSet.has(selKey(fl.id, "outer", i))));
        (fl.holes ?? []).forEach((h, hi) => h.forEach((p, i) => drawHandle(p, selSet.has(selKey(fl.id, hi, i)))));
      }
      ctx.restore();

      // Preview void-draft (sub-mode "addVoid")
      if (floorVoidDraft && floorVoidDraft.points.length > 0) {
        ctx.save();
        ctx.translate(view.tx, view.ty);
        ctx.rotate(view.r);
        ctx.scale(view.s, view.s);
        ctx.lineWidth = 2 / view.s;
        ctx.strokeStyle = "rgba(245,158,11,0.95)";
        ctx.fillStyle = "rgba(245,158,11,0.18)";
        ctx.setLineDash([6 / view.s, 4 / view.s]);
        ctx.beginPath();
        floorVoidDraft.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        if (floorVoidDraft.points.length >= 3) {
          ctx.closePath();
          ctx.fill();
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // Marker titik awal (lingkaran besar)
        const first = floorVoidDraft.points[0];
        ctx.beginPath();
        ctx.arc(first.x, first.y, 8 / view.s, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(245,158,11,1)";
        ctx.lineWidth = 2.5 / view.s;
        ctx.stroke();
        // Vertex markers
        ctx.fillStyle = "rgba(245,158,11,1)";
        for (const p of floorVoidDraft.points) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4 / view.s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }



    // ===== Render area parkir + stall (level aktif) =====
    {
      const areas = (sketch.parkingAreas ?? []).filter(
        (p) => !activeLvlId || p.levelId === activeLvlId,
      );
      const stallsByArea = new Map(parkingStallsActive.map((x) => [x.areaId, x.stalls]));
      for (const area of areas) {
        // Polygon area di koordinat dunia (rotasi mengikuti mm-grid).
        const worldPoly = area.pointsLocal.map((p) => ({
          x: p.x * Math.cos(mmGridRotRad) - p.y * Math.sin(mmGridRotRad),
          y: p.x * Math.sin(mmGridRotRad) + p.y * Math.cos(mmGridRotRad),
        }));
        ctx.save();
        ctx.translate(view.tx, view.ty);
        ctx.rotate(view.r);
        ctx.scale(view.s, view.s);
        ctx.save();
        ctx.strokeStyle = "rgba(14, 165, 233, 0.85)";
        ctx.lineWidth = 1.2 / s;
        ctx.setLineDash([6 / s, 4 / s]);
        ctx.beginPath();
        ctx.moveTo(worldPoly[0].x, worldPoly[0].y);
        for (let i = 1; i < worldPoly.length; i++) ctx.lineTo(worldPoly[i].x, worldPoly[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        // Selected highlight + handles (geser/rotasi/add/remove)
        if (parkingSelectedId === area.id) {
          ctx.save();
          ctx.strokeStyle = "rgba(244, 114, 22, 0.95)";
          ctx.lineWidth = 2 / s;
          ctx.beginPath();
          ctx.moveTo(worldPoly[0].x, worldPoly[0].y);
          for (let i = 1; i < worldPoly.length; i++) ctx.lineTo(worldPoly[i].x, worldPoly[i].y);
          ctx.closePath();
          ctx.stroke();
          // titik vertex — hanya tampil pada mode edit titik
          const inEditTitik =
            parkingSubTool === "move" ||
            parkingSubTool === "addPoint" ||
            parkingSubTool === "removePoint";
          if (inEditTitik) {
            const r = 5 / s;
            ctx.fillStyle = "#f47216";
            for (const p of worldPoly) {
              ctx.beginPath();
              ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // handle rotasi: hanya tampil pada mode rotate
          if (parkingSubTool === "rotate") {
            const cx = worldPoly.reduce((s2, p) => s2 + p.x, 0) / worldPoly.length;
            const cy = worldPoly.reduce((s2, p) => s2 + p.y, 0) / worldPoly.length;
            const totalRot = mmGridRotRad + (area.stallRotation ?? 0);
            let maxR = 0;
            for (const p of worldPoly) {
              const d = Math.hypot(p.x - cx, p.y - cy);
              if (d > maxR) maxR = d;
            }
            const hr = maxR + 24 / s;
            const hx = cx + Math.cos(totalRot - Math.PI / 2) * hr;
            const hy = cy + Math.sin(totalRot - Math.PI / 2) * hr;
            ctx.strokeStyle = "rgba(244, 114, 22, 0.7)";
            ctx.setLineDash([4 / s, 3 / s]);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(hx, hy);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#fff";
            ctx.strokeStyle = "#f47216";
            ctx.lineWidth = 2 / s;
            ctx.beginPath();
            ctx.arc(hx, hy, 7 / s, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();

        }
        // stalls
        const stalls = stallsByArea.get(area.id) ?? [];
        const diffSet = (area.kind ?? "mobil") === "mobil"
          ? (parkingDiffableInfo.effectiveByArea.get(area.id) ?? new Set<string>())
          : new Set<string>();
        let diffCountArea = 0;
        for (const st of stalls) {
          if (!st.valid) continue;
          const isDiff = diffSet.has(`${st.row},${st.col}`);
          if (isDiff) {
            diffCountArea++;
            // Lot diffable: gambar persegi 3.7m × 5m di posisi stall, abu kemerahan + simbol ♿.
            const wPx = DIFFABLE_STALL_W * pxPerMeter;
            const lPx = DIFFABLE_STALL_L * pxPerMeter;
            const ang = st.angle; // facing direction (length axis)
            const ux = Math.cos(ang), uy = Math.sin(ang);             // along length
            const vx = -Math.sin(ang), vy = Math.cos(ang);            // along width
            const hl = lPx / 2, hw = wPx / 2;
            const c = st.center;
            const c1 = { x: c.x - ux * hl - vx * hw, y: c.y - uy * hl - vy * hw };
            const c2 = { x: c.x - ux * hl + vx * hw, y: c.y - uy * hl + vy * hw };
            const c3 = { x: c.x + ux * hl + vx * hw, y: c.y + uy * hl + vy * hw };
            const c4 = { x: c.x + ux * hl - vx * hw, y: c.y + uy * hl - vy * hw };
            ctx.beginPath();
            ctx.moveTo(c1.x, c1.y);
            ctx.lineTo(c2.x, c2.y);
            ctx.lineTo(c3.x, c3.y);
            ctx.lineTo(c4.x, c4.y);
            ctx.closePath();
            ctx.fillStyle = "rgba(170, 140, 140, 0.5)";   // abu dengan sedikit kemerahan
            ctx.fill();
            ctx.strokeStyle = "rgba(14, 165, 233, 0.95)"; // sama dengan perimeter lot mobil biasa
            ctx.lineWidth = 1.2 / s;
            ctx.stroke();
            // Simbol ♿ di tengah lot
            ctx.save();
            ctx.translate(c.x, c.y);
            ctx.rotate(ang + Math.PI / 2);
            const symPx = 1.6 * pxPerMeter;
            ctx.font = `${symPx}px "Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols2", system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#fff";
            ctx.fillText("♿", 0, 0);
            ctx.restore();
          } else {
            ctx.beginPath();
            ctx.moveTo(st.poly[0].x, st.poly[0].y);
            for (let i = 1; i < st.poly.length; i++) ctx.lineTo(st.poly[i].x, st.poly[i].y);
            ctx.closePath();
            ctx.fillStyle = "rgba(200, 200, 200, 0.35)";
            ctx.fill();
            ctx.strokeStyle = "rgba(14, 165, 233, 0.95)";
            ctx.lineWidth = 1.2 / s;
            ctx.stroke();
          }
        }
        ctx.restore();
        // label kapasitas
        const validCount = stalls.filter((x) => x.valid).length;
        const cx = worldPoly.reduce((s2, p) => s2 + p.x, 0) / worldPoly.length;
        const cy = worldPoly.reduce((s2, p) => s2 + p.y, 0) / worldPoly.length;
        const sp = worldToScreen({ x: cx, y: cy });
        let label: string;
        if ((area.kind ?? "mobil") === "motor") {
          label = `${validCount} motor`;
        } else {
          const reg = Math.max(0, validCount - diffCountArea);
          label = diffCountArea > 0 ? `${reg} mobil + ${diffCountArea} diffable` : `${validCount} mobil`;
        }
        ctx.font = "600 11px Manrope, sans-serif";
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = "rgba(14,165,233,0.95)";
        ctx.fillRect(sp.x - w / 2, sp.y - 9, w, 18);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, sp.x - w / 2 + 5, sp.y + 4);
      }
      // ===== Render jalur parkir (polyline obstacle) =====
      {
        const cs = Math.cos(mmGridRotRad), sn = Math.sin(mmGridRotRad);
        const localToWorld = (p: { x: number; y: number }) => ({ x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs });
        const areasLv = (sketch.parkingAreas ?? []).filter(
          (p) => !activeLvlId || p.levelId === activeLvlId,
        );
        ctx.save();
        ctx.translate(view.tx, view.ty);
        ctx.rotate(view.r);
        ctx.scale(view.s, view.s);
        for (const area of areasLv) {
          for (const path of area.paths ?? []) {
            const wpts = path.pointsLocal.map(localToWorld);
            ctx.save();
            ctx.strokeStyle = "rgba(115, 115, 115, 0.95)";
            ctx.lineWidth = 1.2 / s;
            ctx.setLineDash([6 / s, 4 / s]);
            ctx.beginPath();
            ctx.moveTo(wpts[0].x, wpts[0].y);
            for (let i = 1; i < wpts.length; i++) ctx.lineTo(wpts[i].x, wpts[i].y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
            // vertex handles bila area terpilih + mode edit jalur
            const inPathEdit =
              parkingSelectedId === area.id && (
                parkingSubTool === "pathMove" ||
                parkingSubTool === "pathAdd" ||
                parkingSubTool === "pathRemove" ||
                parkingSubTool === "pathFillet"
              );
            if (inPathEdit) {
              const r = 4.5 / s;
              ctx.fillStyle =
                parkingSubTool === "pathRemove" ? "#c62828" :
                parkingSubTool === "pathFillet" ? "#0ea5e9" :
                parkingSubTool === "pathAdd" ? "#22c55e" : "#f47216";
              ctx.strokeStyle = "#1a1a1a";
              ctx.lineWidth = 1 / s;
              for (const p of wpts) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
              }
            }
          }
        }
        // Draft polyline jalur
        if (parkingPathDraft) {
          const target = (sketch.parkingAreas ?? []).find((a) => a.id === parkingPathDraft.areaId);
          if (target && (!activeLvlId || target.levelId === activeLvlId)) {
            const wpts = parkingPathDraft.points.map(localToWorld);
            if (wpts.length >= 1) {
              ctx.save();
              ctx.strokeStyle = "#f59e0b";
              ctx.lineWidth = 1.6 / s;
              ctx.setLineDash([7 / s, 4 / s]);
              ctx.beginPath();
              ctx.moveTo(wpts[0].x, wpts[0].y);
              for (let i = 1; i < wpts.length; i++) ctx.lineTo(wpts[i].x, wpts[i].y);
              if (parkingPathHover) {
                const h = localToWorld(parkingPathHover);
                ctx.lineTo(h.x, h.y);
              }
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = "#f59e0b";
              for (const p of wpts) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4 / s, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.restore();
            }
          }
        }
        ctx.restore();
      }
      // preview drag parkir (4-titik rect ter-snap mm-grid)
      if (drawing && tool === "parking" && parkingSubTool === "draw") {
        const ang = mmGridRotRad || 0;
        const la = rotateAround(drawing.a, { x: 0, y: 0 }, -ang);
        const lb = rotateAround(drawing.b, { x: 0, y: 0 }, -ang);
        const snapL = (v: number) => Math.round(v / MINOR_PX) * MINOR_PX;
        const minX = snapL(Math.min(la.x, lb.x)), maxX = snapL(Math.max(la.x, lb.x));
        const minY = snapL(Math.min(la.y, lb.y)), maxY = snapL(Math.max(la.y, lb.y));
        const corners = [
          { x: minX, y: minY }, { x: maxX, y: minY },
          { x: maxX, y: maxY }, { x: minX, y: maxY },
        ].map((p) => rotateAround(p, { x: 0, y: 0 }, ang));
        ctx.save();
        ctx.translate(view.tx, view.ty);
        ctx.rotate(view.r);
        ctx.scale(view.s, view.s);
        ctx.strokeStyle = "rgba(14, 165, 233, 0.95)";
        ctx.fillStyle = "rgba(14, 165, 233, 0.10)";
        ctx.lineWidth = 2 / s;
        ctx.setLineDash([6 / s, 4 / s]);
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.setLineDash([]);
        ctx.restore();
      }
      // Render DRAFT area parkir (belum disimpan): outline emas + label
      if (parkingDraft && (!activeLvlId || parkingDraft.levelId === activeLvlId)) {

        const dp = parkingDraft.pointsLocal.map((p) => ({
          x: p.x * Math.cos(mmGridRotRad) - p.y * Math.sin(mmGridRotRad),
          y: p.x * Math.sin(mmGridRotRad) + p.y * Math.cos(mmGridRotRad),
        }));
        ctx.save();
        ctx.translate(view.tx, view.ty);
        ctx.rotate(view.r);
        ctx.scale(view.s, view.s);
        ctx.strokeStyle = "#f59e0b";
        ctx.fillStyle = "rgba(245, 158, 11, 0.10)";
        ctx.lineWidth = 2 / s;
        ctx.setLineDash([8 / s, 5 / s]);
        ctx.beginPath();
        ctx.moveTo(dp[0].x, dp[0].y);
        for (let i = 1; i < dp.length; i++) ctx.lineTo(dp[i].x, dp[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.setLineDash([]);
        ctx.restore();
        const cx = dp.reduce((s2, p) => s2 + p.x, 0) / dp.length;
        const cy = dp.reduce((s2, p) => s2 + p.y, 0) / dp.length;
        const sp = worldToScreen({ x: cx, y: cy });
        const label = "DRAFT — tekan Simpan Area";
        ctx.font = "700 11px Manrope, sans-serif";
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(sp.x - w / 2, sp.y - 9, w, 18);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, sp.x - w / 2 + 6, sp.y + 4);
      }
    }


    // ===== Render Ramps =====
    {
      const sortedLv = [...(levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
      const allRamps: Array<Ramp & { __isDraft?: boolean }> = [...(sketch.ramps ?? [])];
      if (rampDraft && rampDraft.anchors.length >= 1) {
        allRamps.push({
          id: "__draft__",
          levelId: rampDraft.levelId,
          anchors: rampDraft.anchors,
          offsetSide: rampDraft.offsetSide,
          widthM: rampWidthM,
          nM: rampNVal,
          createdAt: 0,
          __isDraft: true,
        });
      }
      for (const r of allRamps) {
        const baseIdx = sortedLv.findIndex((l) => l.id === r.levelId);
        const aboveId = baseIdx >= 0 && baseIdx < sortedLv.length - 1 ? sortedLv[baseIdx + 1].id : null;
        const isBase = activeLvlId === r.levelId;
        const isAbove = aboveId && activeLvlId === aboveId;
        const isDraft = (r as { __isDraft?: boolean }).__isDraft;
        if (!isBase && !isAbove && !isDraft) continue;

        const refDense = tessellateReference(r.anchors, pxPerMeter, 18);
        const wPx = r.widthM * pxPerMeter;
        const offDense = offsetPolyline(refDense, wPx, r.offsetSide);
        if (refDense.length < 2 || offDense.length < 2) continue;

        const totalLen = polylineLength(refDense);
        const midS = totalLen / 2;
        const midRef = pointAtArcLength(refDense, midS);
        const midOff = pointAtArcLength(offDense, polylineLength(offDense) / 2);
        const isSelected = rampSelectedId === r.id;

        // Build first-half (base level) and second-half (above level) ribbon polygons
        const splitRef = (s: number): { a: Point[]; b: Point[] } => {
          const a: Point[] = []; const b: Point[] = [];
          let acc = 0;
          a.push(refDense[0]);
          for (let i = 1; i < refDense.length; i++) {
            const p0 = refDense[i - 1], p1 = refDense[i];
            const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
            if (acc + d < s) {
              a.push(p1); acc += d; continue;
            }
            const u = (s - acc) / Math.max(1e-9, d);
            const mid = { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u };
            a.push(mid);
            b.push(mid);
            for (let k = i; k < refDense.length; k++) b.push(refDense[k]);
            return { a, b };
          }
          return { a, b };
        };
        const refSplit = splitRef(midS);
        const offSplit = splitRef.call(null, polylineLength(offDense) / 2);
        // for offset polyline split, redo on offDense
        const splitGeneric = (pts: Point[], s: number): { a: Point[]; b: Point[] } => {
          const a: Point[] = []; const b: Point[] = [];
          let acc = 0; a.push(pts[0]);
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
        const refA = splitGeneric(refDense, midS);
        const offA = splitGeneric(offDense, polylineLength(offDense) / 2);
        void refSplit; void offSplit;

        const drawHalf = (refPts: Point[], offPts: Point[], dashed: boolean) => {
          if (refPts.length < 2 || offPts.length < 2) return;
          // boundary polygon: refPts forward then offPts reverse
          ctx.save();
          ctx.beginPath();
          const m0 = worldToScreen(refPts[0]);
          ctx.moveTo(m0.x, m0.y);
          for (let i = 1; i < refPts.length; i++) {
            const s = worldToScreen(refPts[i]); ctx.lineTo(s.x, s.y);
          }
          for (let i = offPts.length - 1; i >= 0; i--) {
            const s = worldToScreen(offPts[i]); ctx.lineTo(s.x, s.y);
          }
          ctx.closePath();
          ctx.fillStyle = dashed ? "rgba(148,163,184,0.10)" : "rgba(20,184,166,0.14)";
          ctx.fill();
          ctx.lineWidth = isSelected ? 2.5 : 1.6;
          ctx.strokeStyle = isSelected ? "rgba(234,88,12,0.95)" : "rgba(15,23,42,0.85)";
          if (dashed) ctx.setLineDash([6, 5]); else ctx.setLineDash([]);
          // reference side stroke
          ctx.beginPath();
          const r0 = worldToScreen(refPts[0]); ctx.moveTo(r0.x, r0.y);
          for (let i = 1; i < refPts.length; i++) { const s = worldToScreen(refPts[i]); ctx.lineTo(s.x, s.y); }
          ctx.stroke();
          // offset side stroke
          ctx.beginPath();
          const o0 = worldToScreen(offPts[0]); ctx.moveTo(o0.x, o0.y);
          for (let i = 1; i < offPts.length; i++) { const s = worldToScreen(offPts[i]); ctx.lineTo(s.x, s.y); }
          ctx.stroke();
          // end caps
          ctx.beginPath();
          const cap1a = worldToScreen(refPts[0]); const cap1b = worldToScreen(offPts[0]);
          ctx.moveTo(cap1a.x, cap1a.y); ctx.lineTo(cap1b.x, cap1b.y);
          const cap2a = worldToScreen(refPts[refPts.length - 1]); const cap2b = worldToScreen(offPts[offPts.length - 1]);
          ctx.moveTo(cap2a.x, cap2a.y); ctx.lineTo(cap2b.x, cap2b.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        };

        // base level shows first half solid, second half dashed (since upper);
        // above level shows first half dashed, second half solid.
        if (isBase || isDraft) {
          drawHalf(refA.a, offA.a, false);
          drawHalf(refA.b, offA.b, true);
        } else if (isAbove) {
          drawHalf(refA.a, offA.a, true);
          drawHalf(refA.b, offA.b, false);
        }

        // Centerline arrow (mengikuti belokan ramp, tetap di dalam perimeter)
        {
          const N = Math.min(refDense.length, offDense.length);
          if (N >= 2) {
            const center: Point[] = [];
            for (let i = 0; i < N; i++) {
              center.push({ x: (refDense[i].x + offDense[i].x) / 2, y: (refDense[i].y + offDense[i].y) / 2 });
            }
            ctx.save();
            ctx.strokeStyle = isBase || isDraft ? "rgba(234,88,12,0.9)" : "rgba(100,116,139,0.75)";
            ctx.fillStyle = ctx.strokeStyle;
            ctx.setLineDash(isAbove && !isBase ? [4, 4] : []);
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            const s0 = worldToScreen(center[0]);
            ctx.moveTo(s0.x, s0.y);
            for (let i = 1; i < center.length; i++) {
              const s = worldToScreen(center[i]);
              ctx.lineTo(s.x, s.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            // arrowhead at top (puncak ramp)
            const pTop = center[center.length - 1];
            const pPrev = center[center.length - 2];
            const dxw = pTop.x - pPrev.x, dyw = pTop.y - pPrev.y;
            const Lw = Math.max(1e-6, Math.hypot(dxw, dyw));
            const ux = dxw / Lw, uy = dyw / Lw;
            const headLenPx = Math.min(wPx * 0.4, 18);
            const tip = worldToScreen(pTop);
            const baseW = worldToScreen({ x: pTop.x - ux * headLenPx, y: pTop.y - uy * headLenPx });
            // compute in screen space directly
            const sxTip = tip.x, syTip = tip.y;
            const sxBase = baseW.x, syBase = baseW.y;
            const sdx = sxTip - sxBase, sdy = syTip - syBase;
            const sL = Math.max(1e-6, Math.hypot(sdx, sdy));
            const sux = sdx / sL, suy = sdy / sL;
            const px = -suy, py = sux;
            const wHead = sL * 0.55;
            ctx.beginPath();
            ctx.moveTo(sxTip, syTip);
            ctx.lineTo(sxBase + px * wHead, syBase + py * wHead);
            ctx.lineTo(sxBase - px * wHead, syBase - py * wHead);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        // Bordes overlays
        if (r.bordes) {
          const N = Math.min(refDense.length, offDense.length);
          if (N >= 2) {
            const center: Point[] = [];
            for (let i = 0; i < N; i++) {
              center.push({ x: (refDense[i].x + offDense[i].x) / 2, y: (refDense[i].y + offDense[i].y) / 2 });
            }
            const centerLenPx = polylineLength(center);
            const centerLenM = centerLenPx / pxPerMeter;
            const spacingM = r.bordesSpacingM ?? 9;
            const bLenM = r.bordesLenM ?? 1.2;
            // derive slope length: total - n*bLen ; n = floor(...)
            // we know total = slopeLen + nB*bLen; solve nB by iterating
            const nB = numBordesForSlope(centerLenM - 0 /* unknown */, spacingM); // placeholder
            void nB;
            // We instead use saved nM × t to find slope; fall back to derive
            let slopeLenM = 0;
            const cur2 = [...(levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
            const li = cur2.findIndex((l) => l.id === r.levelId);
            const ab = li >= 0 && li < cur2.length - 1 ? cur2[li + 1] : null;
            const tHeight = ab ? Math.max(0, ab.mdpl - cur2[li].mdpl) : 0;
            slopeLenM = tHeight * r.nM;
            // Corner arc-lengths on centerline (meter) — untuk reset spasi setelah bordes belokan.
            const cornerArcsM: number[] = [];
            if (r.bordesBelokan && r.anchors.length >= 3) {
              // cumulative arc length along center
              const cumPx: number[] = [0];
              for (let i = 1; i < N; i++) {
                cumPx.push(cumPx[i - 1] + Math.hypot(center[i].x - center[i - 1].x, center[i].y - center[i - 1].y));
              }
              for (let ai = 1; ai < r.anchors.length - 1; ai++) {
                const B = r.anchors[ai];
                let bestI = 0, bestD = Infinity;
                for (let i = 0; i < refDense.length && i < N; i++) {
                  const d = Math.hypot(refDense[i].x - B.x, refDense[i].y - B.y);
                  if (d < bestD) { bestD = d; bestI = i; }
                }
                cornerArcsM.push(cumPx[bestI] / pxPerMeter);
              }
            }
            const arcs = computeBordesArcs(centerLenM, slopeLenM, spacingM, bLenM, true, cornerArcsM);
            const wPxLocal = r.widthM * pxPerMeter;
            const halfW = wPxLocal / 2;
            const pointAt = (sM: number) => pointAtArcLength(center, sM * pxPerMeter);
            // Determine dashed half boundary along centerline (meter)
            const midM = centerLenM / 2;
            const isDashedAtM = (sM: number) => {
              if (isBase || isDraft) return sM > midM;
              if (isAbove) return sM < midM;
              return false;
            };
            ctx.save();
            // Bidang bordes transparan — hanya outline.
            ctx.strokeStyle = "rgba(15,23,42,0.85)";
            ctx.lineWidth = 0.8;
            for (const a of arcs) {
              const p0 = pointAt(a.s0);
              const p1 = pointAt(a.s1);
              // perpendicular at each
              const n0 = { x: -p0.t.y, y: p0.t.x };
              const n1 = { x: -p1.t.y, y: p1.t.x };
              const q00 = { x: p0.p.x + n0.x * halfW, y: p0.p.y + n0.y * halfW };
              const q01 = { x: p0.p.x - n0.x * halfW, y: p0.p.y - n0.y * halfW };
              const q11 = { x: p1.p.x - n1.x * halfW, y: p1.p.y - n1.y * halfW };
              const q10 = { x: p1.p.x + n1.x * halfW, y: p1.p.y + n1.y * halfW };
              const s00 = worldToScreen(q00), s01 = worldToScreen(q01), s11 = worldToScreen(q11), s10 = worldToScreen(q10);
              const dashed = isDashedAtM((a.s0 + a.s1) / 2);
              if (dashed) ctx.setLineDash([6, 5]); else ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(s00.x, s00.y); ctx.lineTo(s01.x, s01.y);
              ctx.lineTo(s11.x, s11.y); ctx.lineTo(s10.x, s10.y);
              ctx.closePath();
              ctx.stroke();
            }
            ctx.setLineDash([]);
            // corner bordes — persegi dengan diagonal menghubungkan B (sisi acuan)
            // dan B' (sisi offset) pada anchor belokan.
            if (r.bordesBelokan && r.anchors.length >= 3) {
              for (let ai = 1; ai < r.anchors.length - 1; ai++) {
                const B = r.anchors[ai];
                // Cari B' = titik offset pada index yang sama (anchor tanpa fillet → ada di refDense)
                let bestI = 0, bestD = Infinity;
                for (let i = 0; i < refDense.length && i < N; i++) {
                  const d = Math.hypot(refDense[i].x - B.x, refDense[i].y - B.y);
                  if (d < bestD) { bestD = d; bestI = i; }
                }
                const Bp = offDense[bestI];
                // Persegi: B & B' = sudut diagonal. Dua titik lain = midpoint ± perp(B'-B)*half_diag.
                const mx = (B.x + Bp.x) / 2, my = (B.y + Bp.y) / 2;
                const dx = Bp.x - B.x, dy = Bp.y - B.y;
                const half = 0.5; // setengah panjang diagonal kedua = setengah panjang diagonal pertama
                // perp unit
                const dlen = Math.max(1e-6, Math.hypot(dx, dy));
                const px = -dy / dlen, py = dx / dlen;
                const halfDiag = dlen * half;
                const v3 = { x: mx + px * halfDiag, y: my + py * halfDiag };
                const v4 = { x: mx - px * halfDiag, y: my - py * halfDiag };
                const s1c = worldToScreen(B), s2c = worldToScreen(v3),
                      s3c = worldToScreen(Bp), s4c = worldToScreen(v4);
                const cornerArc = cornerArcsM[ai - 1] ?? 0;
                const dashedC = isDashedAtM(cornerArc);
                if (dashedC) ctx.setLineDash([6, 5]); else ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(s1c.x, s1c.y); ctx.lineTo(s2c.x, s2c.y);
                ctx.lineTo(s3c.x, s3c.y); ctx.lineTo(s4c.x, s4c.y);
                ctx.closePath();
                ctx.stroke();
              }
              ctx.setLineDash([]);
            }
            ctx.restore();
          }
        }



        // Anchor handles in edit modes
        if (!isDraft && tool === "ramp" && (rampSub === "geser" || rampSub === "addpt" || rampSub === "fillet")) {
          ctx.save();
          for (let i = 0; i < r.anchors.length; i++) {
            const sp = worldToScreen(r.anchors[i]);
            ctx.fillStyle = rampSelectedId === r.id ? "rgba(234,88,12,0.95)" : "rgba(15,23,42,0.85)";
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // Draft preview points
        if (isDraft) {
          ctx.save();
          for (const p of r.anchors) {
            const sp = worldToScreen(p);
            ctx.fillStyle = "rgba(234,88,12,0.95)";
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }

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

    // === AKSIS rancangan (Master Plan) ===
    // Garis sumbu yang dihindari oleh Cluster Generator. Render dgn warna
    // indigo bertekstur garis putus-putus + buffer halo tipis di kedua sisi.
    const axesAll: AxisSegment[] = sketch.axes ?? [];
    const drawAxisPath = (poly: Point[], strokeStyle: string, dash: number[], lineWidth: number) => {
      if (poly.length < 2) return;
      ctx.save();
      ctx.setLineDash(dash);
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const s0 = worldToScreen(poly[0]);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < poly.length; i++) {
        const si = worldToScreen(poly[i]);
        ctx.lineTo(si.x, si.y);
      }
      ctx.stroke();
      ctx.restore();
    };
    for (const ax of axesAll) {
      const poly = sampleAxisPolyline(ax) as Point[];
      // Buffer halo (tipis, transparan) menandakan zona hindar.
      const bufPx = ax.bufferM * pxPerMeter * view.s;
      if (bufPx > 1) {
        ctx.save();
        ctx.strokeStyle = "rgba(99,102,241,0.18)";
        ctx.lineWidth = bufPx * 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        const s0 = worldToScreen(poly[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < poly.length; i++) {
          const si = worldToScreen(poly[i]);
          ctx.lineTo(si.x, si.y);
        }
        ctx.stroke();
        ctx.restore();
      }
      drawAxisPath(poly, "#4f46e5", [8, 6], 1.6);
      // Endpoint kecil
      ctx.fillStyle = "#4f46e5";
      const sA = worldToScreen(poly[0]);
      const sB = worldToScreen(poly[poly.length - 1]);
      ctx.beginPath(); ctx.arc(sA.x, sA.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sB.x, sB.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Draft aksis tangent (multi-klik)
    if (aksisDraft && aksisDraft.kind === "tangent" && tool === "aksis") {
      const ctrl = [...aksisDraft.points, aksisDraft.cursor];
      const preview = (ctrl.length >= 3
        ? sampleAxisPolyline({ id: "_", kind: "tangent", points: ctrl, bufferM: 0, createdAt: 0 })
        : ctrl) as Point[];
      drawAxisPath(preview, "rgba(79,70,229,0.7)", [4, 4], 1.4);
      ctx.fillStyle = "#4f46e5";
      for (const p of aksisDraft.points) {
        const sp = worldToScreen(p);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Draft aksis garis (drag)
    if (drawing && tool === "aksis" && aksisSub === "garis") {
      drawAxisPath([drawing.a, drawing.b], "rgba(79,70,229,0.85)", [6, 5], 1.6);
    }
    // Jalan — koridor disatukan (union) dengan SUDUT FILLET 4 m di setiap pertemuan.
    const roadsAll: RoadSegment[] = sketch.roads ?? [];
    if (roadsAll.length > 0) {
      const FILLET_M = 4;
      const filletPx = FILLET_M * pxPerMeter;
      const corridors: Point[][] = roadsAll
        .map((rd) => buildRoadCorridor(rd, pxPerMeter) as Point[])
        .filter((c) => c.length >= 3);

      // Union semua koridor → MultiPolygon (rings with holes) yang sudut-sudutnya sudah di-fillet.
      let unionRings = unionFilletedCorridors(corridors, filletPx);
      // Trim ke perimeter "Lahan" agar tidak ada kelebihan garis jalan di luar tapak.
      const lahanForClip = layers.find((l) => isLahanLayerName(l.name) && l.points.length >= 3);
      if (lahanForClip) {
        unionRings = clipRingsByPolygon(unionRings, lahanForClip.points);
      }




      // FILL semi-transparan
      ctx.save();
      ctx.fillStyle = "rgba(63,63,70,0.22)";
      for (const { outer, holes } of unionRings) {
        const o = outer;
        if (o.length < 3) continue;
        ctx.beginPath();
        const s0 = worldToScreen(o[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < o.length; i++) {
          const s = worldToScreen(o[i]);
          ctx.lineTo(s.x, s.y);
        }
        ctx.closePath();
        for (const h of holes) {
          if (h.length < 3) continue;
          const h0 = worldToScreen(h[0]);
          ctx.moveTo(h0.x, h0.y);
          for (let i = h.length - 1; i >= 1; i--) {
            const sh = worldToScreen(h[i]);
            ctx.lineTo(sh.x, sh.y);
          }
          ctx.closePath();
        }
        ctx.fill("evenodd");
      }
      ctx.restore();

      // OUTLINE — kontur ring yang sudah di-fillet
      ctx.save();
      ctx.strokeStyle = "#27272a";
      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const { outer, holes } of unionRings) {
        for (const ring of [outer, ...holes]) {
          if (ring.length < 2) continue;
          ctx.beginPath();
          const s0 = worldToScreen(ring[0]);
          ctx.moveTo(s0.x, s0.y);
          for (let i = 1; i < ring.length; i++) {
            const s = worldToScreen(ring[i]);
            ctx.lineTo(s.x, s.y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.restore();

      // SETBACK / OFFSET — garis putus-putus offset dari perimeter jalan sejauh ½ lebar (per ruas).
      if (jalanOffsetEnabled) {
        // Per ruas: bangun koridor diperbesar dengan width = widthM + 2*(widthM/2) = 2*widthM.
        const expandedCorridors: Point[][] = roadsAll
          .map((rd) => {
            const c = roadCenterline(rd) as Point[];
            if (c.length < 2) return [] as Point[];
            const halfExpandedPx = ((rd.widthM * 2) * pxPerMeter) / 2; // = widthM*pxPerMeter
            const left = offsetRoadPolyline(c, halfExpandedPx) as Point[];
            const right = offsetRoadPolyline(c, -halfExpandedPx) as Point[];
            return [...left, ...right.slice().reverse()];
          })
          .filter((c) => c.length >= 3);
        if (expandedCorridors.length > 0) {
          // Radius fillet di pertemuan offset = fillet jalan + ½ lebar rata-rata.
          const avgHalfPx = roadsAll.reduce((s, r) => s + (r.widthM * pxPerMeter) / 2, 0) / roadsAll.length;
          const offsetFilletPx = filletPx + avgHalfPx;
          let offsetRings = unionFilletedCorridors(expandedCorridors, offsetFilletPx);
          if (lahanForClip) offsetRings = clipRingsByPolygon(offsetRings, lahanForClip.points);
          ctx.save();
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 1.1;
          ctx.setLineDash([7, 5]);
          ctx.lineCap = "butt";
          ctx.lineJoin = "round";
          for (const { outer, holes } of offsetRings) {
            for (const ring of [outer, ...holes]) {
              if (ring.length < 2) continue;
              ctx.beginPath();
              const s0 = worldToScreen(ring[0]);
              ctx.moveTo(s0.x, s0.y);
              for (let i = 1; i < ring.length; i++) {
                const s = worldToScreen(ring[i]);
                ctx.lineTo(s.x, s.y);
              }
              ctx.closePath();
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }



      // Centerline putus-putus + fillet indicator per ruas
      for (const rd of roadsAll) {
        const center = roadCenterline(rd) as Point[];
        drawAxisPath(center, "rgba(250,250,250,0.85)", [6, 6], 1.0);
        if (rd.filletM > 0 && rd.points.length >= 3) {
          ctx.save();
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 1;
          const rPx = rd.filletM * pxPerMeter * view.s;
          for (let i = 1; i < rd.points.length - 1; i++) {
            const sp = worldToScreen(rd.points[i]);
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, Math.max(3, rPx * 0.4), 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // Vertex handles untuk mode edit titik jalan
      if (tool === "jalan" && (jalanSub === "geser" || jalanSub === "tambahTitik" || jalanSub === "hapusTitik")) {
        ctx.save();
        for (const rd of roadsAll) {
          for (let i = 0; i < rd.points.length; i++) {
            const sp = worldToScreen(rd.points[i]);
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = jalanSub === "hapusTitik" ? "#dc2626" : jalanSub === "tambahTitik" ? "#16a34a" : "#2563eb";
            ctx.fill();
            ctx.lineWidth = 1.25;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
    // Draft jalan tangent
    if (jalanDraft && jalanDraft.kind === "tangent" && tool === "jalan") {
      const ctrl = [...jalanDraft.points, jalanDraft.cursor];
      const preview = (ctrl.length >= 3
        ? sampleAxisPolyline({ id: "_", kind: "tangent", points: ctrl, bufferM: 0, createdAt: 0 })
        : ctrl) as Point[];
      drawAxisPath(preview, "rgba(63,63,70,0.6)", [6, 6], (jalanWidthM * pxPerMeter * view.s) || 6);
      drawAxisPath(preview, "rgba(250,250,250,0.9)", [4, 4], 1.0);
      ctx.fillStyle = "#27272a";
      for (const p of jalanDraft.points) {
        const sp = worldToScreen(p);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Draft jalan garis (drag)
    if (drawing && tool === "jalan" && jalanSub === "garis") {
      const wpx = jalanWidthM * pxPerMeter * view.s;
      drawAxisPath([drawing.a, drawing.b], "rgba(63,63,70,0.55)", [], Math.max(2, wpx));
      drawAxisPath([drawing.a, drawing.b], "rgba(250,250,250,0.9)", [6, 6], 1.0);
    }
  }, [size, lines, drawing, hover, layers, tool, lineKind, pendingCurve, polyDraft, pxPerMeter, isLineLocked, view, editHover, addPointPreview, levels, activeLvlId, editMode, sketch.geo, sketch.sectionCuts, sketch.edgeAttrs, sketch.doors, sketch.circles, sketch.floors, sketch.parkingAreas, sketch.ramps, sketch.axes, sketch.roads, aksisDraft, aksisSub, jalanDraft, jalanSub, jalanWidthM, jalanOffsetEnabled, parkingStallsActive, parkingDiffableInfo, parkingDraft, parkingSubTool, floorDraft, floorMode, floorEditSub, floorVertexDrag, floorVoidDraft, doorDraft, doorLeaves, doorWidthCm, tileTick, onTileLoad, grid, clipDraft, gridEditMode, primaryGrid, gridExtras, editGridIdx, circleDraft, mmGridRotRad, structGridRotRad, moveSel, moveMarquee, selectedEditVertices, selectedFloorEditVertices, editVertexMarquee, floorVertexMarquee, sectionSub, sectionEndpointDrag, rampDraft, rampSub, rampSelectedId, rampWidthInput, rampNInput]);


  const getScreenPos = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const getWorldPos = (e: React.PointerEvent): Point => {
    const sp = getScreenPos(e);
    return snapPoint(screenToWorld(sp));
  };
  const getWorldPosRaw = (e: React.PointerEvent): Point => screenToWorld(getScreenPos(e));




  // ===== Grid Struktur stylus interaksi =====

  // Hitung bounds grid pada level aktif (dalam koordinat world px).
  const gridBounds = useCallback((): null | {
    xs: number[]; ys: number[]; xMin: number; xMax: number; yMin: number; yMax: number; spansX: number[]; spansY: number[];
  } => {
    if (!grid.enabled || !activeLvlId) return null;
    const lv = levels.find((l) => l.id === activeLvlId);
    if (!lv) return null;
    const { spansX, spansY } = spansForLevel(grid, lv.id);
    const ppm = pxPerMeter;
    const posX = axisPositions(spansX).map((m) => grid.origin.x + m * ppm);
    const posY = axisPositions(spansY).map((m) => grid.origin.y + m * ppm);
    return {
      xs: posX, ys: posY,
      xMin: posX[0], xMax: posX[posX.length - 1],
      yMin: posY[0], yMax: posY[posY.length - 1],
      spansX, spansY,
    };
  }, [grid, activeLvlId, levels, pxPerMeter]);

  // Hit-test sudut grid. Mengembalikan label sudut atau null.
  const hitGridCorner = useCallback(
    (raw: Point): "tl" | "tr" | "bl" | "br" | null => {
      const b = gridBounds(); if (!b) return null;
      const tol = 22 / view.s;
      const corners: Array<{ k: "tl"|"tr"|"bl"|"br"; x: number; y: number }> = [
        { k: "tl", x: b.xMin, y: b.yMin },
        { k: "tr", x: b.xMax, y: b.yMin },
        { k: "bl", x: b.xMin, y: b.yMax },
        { k: "br", x: b.xMax, y: b.yMax },
      ];
      let best: { k: "tl"|"tr"|"bl"|"br"; d: number } | null = null;
      for (const c of corners) {
        const d = Math.hypot(raw.x - c.x, raw.y - c.y);
        if (d <= tol && (!best || d < best.d)) best = { k: c.k, d };
      }
      return best ? best.k : null;
    },
    [gridBounds, view.s],
  );

  // Snap origin ke kelipatan MINOR_PX agar tetap "snap to grid" milimeter block.
  const snapOriginPx = (p: Point): Point => ({
    x: Math.round(p.x / MINOR_PX) * MINOR_PX,
    y: Math.round(p.y / MINOR_PX) * MINOR_PX,
  });

  const adjustSpans = (start: number[], added: number, unit: number, atStart: boolean): number[] => {
    if (added > 0) {
      const extra = Array(added).fill(unit);
      return atStart ? [...extra, ...start] : [...start, ...extra];
    }
    if (added < 0) {
      const remove = Math.min(-added, start.length - 1);
      return atStart ? start.slice(remove) : start.slice(0, start.length - remove);
    }
    return start;
  };

  // Commit a finished line into state, run cycle detection, push history.
  // Apply boolean subtraction: new polygon carves out overlapping area from
  // any existing same-level non-lahan layer.
  const applySubtractionToLayers = useCallback(
    (existing: Layer[], newPoly: Point[], levelId: string | undefined): Layer[] => {
      if (newPoly.length < 3) return existing;
      const newPolyArea = polygonAreaPx(newPoly);
      const newPolyCentroid = polygonCentroid(newPoly);
      const out: Layer[] = [];
      for (const ly of existing) {
        const sameLevel = (ly.levelId ?? undefined) === (levelId ?? undefined);
        if (!sameLevel || isLahanLayerName(ly.name) || ly.locked || ly.points.length < 3) {
          out.push(ly);
          continue;
        }
        const outerArea = polygonAreaPx(ly.points);
        // Kumpulkan SEMUA polygon ruang lain (yang sudah ada + ruang baru)
        // yang berada di dalam outer ring ly. Ini menjamin presisi ketika
        // banyak ruang kecil dibuat di dalam satu ruang besar: luas ly =
        // luas outer − total luas semua child yang ter-kandung.
        const subtractors: Point[][] = [];
        for (const other of existing) {
          if (other.id === ly.id) continue;
          if ((other.levelId ?? undefined) !== (levelId ?? undefined)) continue;
          if (isLahanLayerName(other.name)) continue;
          if (other.points.length < 3) continue;
          const oa = polygonAreaPx(other.points);
          if (oa >= outerArea) continue;
          const c = polygonCentroid(other.points);
          if (!pointInPolygon(c, ly.points)) continue;
          subtractors.push(other.points);
        }
        const newInside =
          newPolyArea < outerArea && pointInPolygon(newPolyCentroid, ly.points);
        if (newInside) subtractors.push(newPoly);

        let netAreaPx = outerArea;
        let nextPoints = ly.points;
        if (subtractors.length > 0) {
          let diffPolys: ReturnType<typeof polygonClipping.difference> | null = null;
          try {
            const subj = [[ptsToRing(ly.points)]] as Parameters<typeof polygonClipping.difference>[0];
            const others = subtractors.map(
              (s) => [[ptsToRing(s)]] as Parameters<typeof polygonClipping.difference>[0],
            );
            diffPolys = polygonClipping.difference(subj, ...others);
          } catch {
            diffPolys = null;
          }
          if (diffPolys && diffPolys.length > 0) {
            netAreaPx = 0;
            let bestOuter: Point[] | null = null;
            let bestOuterArea = -Infinity;
            for (const poly of diffPolys) {
              for (let i = 0; i < poly.length; i++) {
                const ring = poly[i];
                if (!ring || ring.length < 4) continue;
                const ringPts = ringToPts(ring);
                const a = polygonAreaPx(ringPts);
                if (i === 0) {
                  netAreaPx += a;
                  if (a > bestOuterArea) {
                    bestOuterArea = a;
                    bestOuter = ringPts;
                  }
                } else {
                  netAreaPx -= a;
                }
              }
            }
            // Update outer ring HANYA bila boundary ikut terpotong
            // (luas outer berubah signifikan). Untuk ruang kecil di tengah
            // tanpa menyentuh sisi, outer asli dipertahankan.
            if (bestOuter && Math.abs(bestOuterArea - outerArea) > 0.5) {
              nextPoints = bestOuter;
            }
          } else {
            toast.message(`${ly.name} terhapus karena tertutup ruang baru`);
            continue;
          }
        }
        if (netAreaPx < 1) {
          toast.message(`${ly.name} terhapus karena tertutup ruang baru`);
          continue;
        }
        const newAreaM2 = netAreaPx / (pxPerMeter * pxPerMeter);
        out.push({ ...ly, points: nextPoints, areaM2: newAreaM2 });
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
      // Persegi mengikuti rotasi grid milimeter block. Sudut diagonal di-
      // un-rotate ke frame lokal, dibangun axis-aligned, lalu dirotasi balik.
      const la = rotateAround(a, { x: 0, y: 0 }, -mmGridRotRad);
      const lb = rotateAround(b, { x: 0, y: 0 }, -mmGridRotRad);
      const lminX = Math.min(la.x, lb.x);
      const lmaxX = Math.max(la.x, lb.x);
      const lminY = Math.min(la.y, lb.y);
      const lmaxY = Math.max(la.y, lb.y);
      if (lmaxX - lminX < 4 || lmaxY - lminY < 4) return;
      const lp1 = { x: lminX, y: lminY };
      const lp2 = { x: lmaxX, y: lminY };
      const lp3 = { x: lmaxX, y: lmaxY };
      const lp4 = { x: lminX, y: lmaxY };
      const p1 = rotateAround(lp1, { x: 0, y: 0 }, mmGridRotRad);
      const p2 = rotateAround(lp2, { x: 0, y: 0 }, mmGridRotRad);
      const p3 = rotateAround(lp3, { x: 0, y: 0 }, mmGridRotRad);
      const p4 = rotateAround(lp4, { x: 0, y: 0 }, mmGridRotRad);
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
    [lines, layers, levels, activeLvlId, pxPerMeter, mmGridRotRad, pushHistory, onChange, ensureLevels, applySubtractionToLayers],
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


  // Commit floor (slab) — outer polygon + optional holes. Nama lantai otomatis
  // mengikuti nama level aktif. Top permukaan = MDPL level, ketebalan 150mm ke bawah.
  const commitFloorFromPolys = useCallback(
    (outer: Point[], holes: Point[][], replaceFloorId?: string) => {
      if (outer.length < 3) {
        toast.error("Outline lantai minimal 3 titik");
        return;
      }
      const { levels: nextLevelsBase, activeId } = ensureLevels();
      const validHoles = holes.filter((h) => h.length >= 3);
      const prev = sketch.floors ?? [];
      pushHistory();
      let nextFloors: Floor[];
      if (replaceFloorId) {
        nextFloors = prev.map((f) =>
          f.id === replaceFloorId
            ? { ...f, outer, holes: validHoles.length ? validHoles : undefined }
            : f,
        );
      } else {
        const floor: Floor = {
          id: genFloorId(),
          levelId: activeId,
          outer,
          holes: validHoles.length ? validHoles : undefined,
          thicknessMm: FLOOR_THICKNESS_MM,
          createdAt: Date.now(),
        };
        nextFloors = [...prev, floor];
      }
      const patch: Partial<Sketch> = { floors: nextFloors };
      if (nextLevelsBase !== levels) {
        patch.levels = nextLevelsBase;
        patch.activeLevelId = activeId;
      } else if (!activeLvlId) {
        patch.activeLevelId = activeId;
      }
      onChange(patch);
      const areaPx = floorPolyArea(outer) - validHoles.reduce((s, h) => s + floorPolyArea(h), 0);
      const areaM2 = Math.max(0, areaPx) / (pxPerMeter * pxPerMeter);
      toast.success(
        `${replaceFloorId ? "Lantai diperbarui" : "Lantai disimpan"} — ${areaM2.toFixed(2)} m²${validHoles.length ? ` · ${validHoles.length} void` : ""}`,
      );
      setFloorDraft(null);
    },
    [sketch.floors, levels, activeLvlId, pxPerMeter, pushHistory, onChange, ensureLevels],
  );

  // Commit dari floorDraft (semua mode: rect/line/polyline/attach).
  const commitFloor = useCallback(() => {
    if (!floorDraft || !floorDraft.outer || floorDraft.outer.length < 3) {
      toast.error("Belum ada area lantai untuk disimpan");
      return;
    }
    commitFloorFromPolys(floorDraft.outer, floorDraft.holes, floorDraft.replaceFloorId);
  }, [floorDraft, commitFloorFromPolys]);


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

    // ===== Parking sub-tool interactions =====
    if (tool === "parking" && parkingSubTool !== "draw") {
      const rawWp = getWorldPosRaw(e);
      const tol = 12 / view.s;
      const areas = (sketch.parkingAreas ?? []).filter(
        (pa) => !activeLvlId || pa.levelId === activeLvlId,
      );

      // ----- Path (jalur parkir) sub-modes -----
      const cs = Math.cos(mmGridRotRad), sn = Math.sin(mmGridRotRad);
      const localToWorld = (p: { x: number; y: number }) => ({ x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs });
      if (parkingSubTool === "pathDraw") {
        if (!parkingSelectedId && !parkingPathDraft) {
          toast.error("Pilih area parkir dulu");
          return;
        }
        const targetId = parkingPathDraft?.areaId ?? parkingSelectedId!;
        const lp = snapWorldToMmLocal(rawWp);
        if (parkingPathDraft) {
          setParkingPathDraft({ areaId: targetId, points: [...parkingPathDraft.points, lp] });
        } else {
          setParkingPathDraft({ areaId: targetId, points: [lp] });
        }
        return;
      }
      if (parkingSubTool === "pathMove" || parkingSubTool === "pathRemove" || parkingSubTool === "pathFillet") {
        for (let ai = areas.length - 1; ai >= 0; ai--) {
          const area = areas[ai];
          for (const path of area.paths ?? []) {
            const wpts = path.pointsLocal.map(localToWorld);
            for (let i = 0; i < wpts.length; i++) {
              if (Math.hypot(rawWp.x - wpts[i].x, rawWp.y - wpts[i].y) <= tol) {
                setParkingSelectedId(area.id);
                if (parkingSubTool === "pathMove") {
                  pushHistory();
                  setParkingDrag({ kind: "pathVertex", areaId: area.id, pathId: path.id, idx: i });
                  return;
                }
                if (parkingSubTool === "pathRemove") {
                  pushHistory();
                  const pts = path.pointsLocal;
                  let newPaths: ParkingPath[];
                  if (pts.length <= 2) {
                    newPaths = (area.paths ?? []).filter((p) => p.id !== path.id);
                  } else {
                    newPaths = (area.paths ?? []).map((p) =>
                      p.id === path.id ? { ...p, pointsLocal: pts.filter((_, k) => k !== i) } : p,
                    );
                  }
                  onChange({
                    parkingAreas: (sketch.parkingAreas ?? []).map((a2) =>
                      a2.id === area.id ? { ...a2, paths: newPaths } : a2,
                    ),
                  });
                  return;
                }
                if (parkingSubTool === "pathFillet") {
                  const pts = path.pointsLocal;
                  if (i === 0 || i === pts.length - 1) {
                    toast.error("Fillet hanya untuk titik tengah");
                    return;
                  }
                  const prev = pts[i - 1], cur = pts[i], nxt = pts[i + 1];
                  const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
                  const outLen = Math.hypot(nxt.x - cur.x, nxt.y - cur.y);
                  const rPx = Math.min(1 * pxPerMeter, inLen * 0.45, outLen * 0.45);
                  if (rPx < 4) { toast.error("Segmen terlalu pendek utk fillet"); return; }
                  const ux = (prev.x - cur.x) / inLen, uy = (prev.y - cur.y) / inLen;
                  const vx = (nxt.x - cur.x) / outLen, vy = (nxt.y - cur.y) / outLen;
                  const a = snapMmLocal({ x: cur.x + ux * rPx, y: cur.y + uy * rPx });
                  const b = snapMmLocal({ x: cur.x + vx * rPx, y: cur.y + vy * rPx });
                  pushHistory();
                  const newPts = [...pts.slice(0, i), a, b, ...pts.slice(i + 1)];
                  onChange({
                    parkingAreas: (sketch.parkingAreas ?? []).map((a2) =>
                      a2.id === area.id
                        ? { ...a2, paths: (a2.paths ?? []).map((p) => p.id === path.id ? { ...p, pointsLocal: newPts } : p) }
                        : a2,
                    ),
                  });
                  return;
                }
              }
            }
          }
        }
        return;
      }
      if (parkingSubTool === "pathAdd") {
        const localP = worldToMmLocal(rawWp);
        const tolLocal = 12 / view.s;
        for (let ai = areas.length - 1; ai >= 0; ai--) {
          const area = areas[ai];
          for (const path of area.paths ?? []) {
            const pts = path.pointsLocal;
            let bestI = -1, bestD = Infinity, bestProj: { x: number; y: number } | null = null;
            for (let i = 0; i < pts.length - 1; i++) {
              const a2 = pts[i], b2 = pts[i + 1];
              const vx = b2.x - a2.x, vy = b2.y - a2.y;
              const wx = localP.x - a2.x, wy = localP.y - a2.y;
              const c2 = vx * vx + vy * vy;
              if (c2 < 1e-6) continue;
              const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
              const px = a2.x + t * vx, py = a2.y + t * vy;
              const d = Math.hypot(localP.x - px, localP.y - py);
              if (d < bestD) { bestD = d; bestI = i; bestProj = { x: px, y: py }; }
            }
            if (bestI >= 0 && bestProj && bestD <= tolLocal) {
              pushHistory();
              const newPts = [...pts];
              newPts.splice(bestI + 1, 0, snapMmLocal(bestProj));
              onChange({
                parkingAreas: (sketch.parkingAreas ?? []).map((a2) =>
                  a2.id === area.id
                    ? { ...a2, paths: (a2.paths ?? []).map((p) => p.id === path.id ? { ...p, pointsLocal: newPts } : p) }
                    : a2,
                ),
              });
              setParkingSelectedId(area.id);
              return;
            }
          }
        }
        return;
      }


      // ----- Diffable: swap lot mobil terdekat di level yg sama -----
      if (parkingSubTool === "diffable") {
        // Cari stall (mobil) yg di-tap di level aktif.
        const mobilAreas = areas.filter((a) => (a.kind ?? "mobil") === "mobil");
        let hitArea: ParkingArea | null = null;
        let hitStall: ParkingStall | null = null;
        for (const area of mobilAreas) {
          const found = parkingStallsActive.find((x) => x.areaId === area.id);
          const stalls = found?.stalls ?? [];
          for (const st of stalls) {
            if (!st.valid) continue;
            // hit-test poligon stall (atau poligon diffable jika sudah diffable)
            const poly = st.poly;
            let inside = false;
            for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
              const xi = poly[k].x, yi = poly[k].y, xj = poly[j].x, yj = poly[j].y;
              if ((yi > rawWp.y) !== (yj > rawWp.y) &&
                  rawWp.x < ((xj - xi) * (rawWp.y - yi)) / (yj - yi + 1e-12) + xi) {
                inside = !inside;
              }
            }
            if (inside) { hitArea = area; hitStall = st; break; }
          }
          if (hitStall) break;
        }
        if (!hitArea || !hitStall) {
          toast.message("Tap lot mobil yang ingin dijadikan diffable");
          return;
        }
        const tappedKey = `${hitStall.row},${hitStall.col}`;
        const tappedSet = parkingDiffableInfo.effectiveByArea.get(hitArea.id) ?? new Set<string>();
        if (tappedSet.has(tappedKey)) {
          toast.message("Lot ini sudah diffable");
          return;
        }
        // Materialisasi diffable saat ini per area di level aktif.
        const lvlAreas = mobilAreas;
        const currentByArea = new Map<string, Set<string>>();
        for (const a of lvlAreas) {
          currentByArea.set(a.id, new Set(parkingDiffableInfo.effectiveByArea.get(a.id) ?? []));
        }
        // Cari diffable terdekat di level (jarak antar center stall).
        let bestAreaId: string | null = null;
        let bestKey: string | null = null;
        let bestD = Infinity;
        for (const a of lvlAreas) {
          const found = parkingStallsActive.find((x) => x.areaId === a.id);
          const stalls = found?.stalls ?? [];
          const set = currentByArea.get(a.id) ?? new Set<string>();
          for (const st of stalls) {
            const k = `${st.row},${st.col}`;
            if (!set.has(k)) continue;
            const d = Math.hypot(st.center.x - hitStall.center.x, st.center.y - hitStall.center.y);
            if (d < bestD) { bestD = d; bestAreaId = a.id; bestKey = k; }
          }
        }
        if (!bestAreaId || !bestKey) {
          toast.error("Tidak ada lot diffable di level ini untuk ditukar");
          return;
        }
        // Lakukan swap: hapus bestKey dari bestArea, tambahkan tappedKey ke hitArea.
        pushHistory();
        currentByArea.get(bestAreaId)!.delete(bestKey);
        currentByArea.get(hitArea.id)!.add(tappedKey);
        const nextAreas = (sketch.parkingAreas ?? []).map((a) => {
          if (!currentByArea.has(a.id)) return a;
          const set = currentByArea.get(a.id)!;
          return { ...a, diffable: [...set] };
        });
        onChange({ parkingAreas: nextAreas });
        toast.success("Lot diffable dipindahkan");
        return;
      }

      // 1) Rotation handle hit (jika selected)
      if (parkingSelectedId) {
        const sel = areas.find((aa) => aa.id === parkingSelectedId);
        if (sel) {
          const worldPoly = sel.pointsLocal.map((q) => ({
            x: q.x * Math.cos(mmGridRotRad) - q.y * Math.sin(mmGridRotRad),
            y: q.x * Math.sin(mmGridRotRad) + q.y * Math.cos(mmGridRotRad),
          }));
          const cx = worldPoly.reduce((s2, q) => s2 + q.x, 0) / worldPoly.length;
          const cy = worldPoly.reduce((s2, q) => s2 + q.y, 0) / worldPoly.length;
          const totalRot = mmGridRotRad + (sel.stallRotation ?? 0);
          let maxR = 0;
          for (const q of worldPoly) {
            const d = Math.hypot(q.x - cx, q.y - cy);
            if (d > maxR) maxR = d;
          }
          const hr = maxR + 24 / view.s;
          const hx = cx + Math.cos(totalRot - Math.PI / 2) * hr;
          const hy = cy + Math.sin(totalRot - Math.PI / 2) * hr;
          if (Math.hypot(rawWp.x - hx, rawWp.y - hy) <= tol) {
            const startAng = Math.atan2(rawWp.y - cy, rawWp.x - cx);
            setParkingDrag({
              kind: "rotate",
              areaId: sel.id,
              startAngle: startAng,
              startRot: sel.stallRotation ?? 0,
              centerWorld: { x: cx, y: cy },
            });
            return;
          }
        }
      }
      // 2) Vertex hit (move sub-tool)
      if (parkingSubTool === "move") {
        for (let ai = areas.length - 1; ai >= 0; ai--) {
          const area = areas[ai];
          const worldPoly = area.pointsLocal.map((q) => ({
            x: q.x * Math.cos(mmGridRotRad) - q.y * Math.sin(mmGridRotRad),
            y: q.x * Math.sin(mmGridRotRad) + q.y * Math.cos(mmGridRotRad),
          }));
          for (let i = 0; i < worldPoly.length; i++) {
            if (Math.hypot(rawWp.x - worldPoly[i].x, rawWp.y - worldPoly[i].y) <= tol) {
              setParkingSelectedId(area.id);
              pushHistory();
              setParkingDrag({ kind: "vertex", areaId: area.id, idx: i });
              return;
            }
          }
        }
      }
      // 3) Remove point: klik vertex menghapus
      if (parkingSubTool === "removePoint") {
        for (let ai = areas.length - 1; ai >= 0; ai--) {
          const area = areas[ai];
          const worldPoly = area.pointsLocal.map((q) => ({
            x: q.x * Math.cos(mmGridRotRad) - q.y * Math.sin(mmGridRotRad),
            y: q.x * Math.sin(mmGridRotRad) + q.y * Math.cos(mmGridRotRad),
          }));
          for (let i = 0; i < worldPoly.length; i++) {
            if (Math.hypot(rawWp.x - worldPoly[i].x, rawWp.y - worldPoly[i].y) <= tol) {
              if (area.pointsLocal.length <= 3) {
                toast.error("Minimal 3 titik");
                return;
              }
              pushHistory();
              const newPts = area.pointsLocal.filter((_, k) => k !== i);
              onChange({
                parkingAreas: (sketch.parkingAreas ?? []).map((a2) =>
                  a2.id === area.id ? { ...a2, pointsLocal: newPts } : a2,
                ),
              });
              setParkingSelectedId(area.id);
              return;
            }
          }
        }
        return;
      }
      // 4) Add point: klik edge menyisipkan titik baru
      if (parkingSubTool === "addPoint") {
        const localP = worldToMmLocal(rawWp);
        for (let ai = areas.length - 1; ai >= 0; ai--) {
          const area = areas[ai];
          const pts = area.pointsLocal;
          let bestI = -1, bestD = Infinity, bestProj: { x: number; y: number } | null = null;
          for (let i = 0; i < pts.length; i++) {
            const a2 = pts[i], b2 = pts[(i + 1) % pts.length];
            const vx = b2.x - a2.x, vy = b2.y - a2.y;
            const wx = localP.x - a2.x, wy = localP.y - a2.y;
            const c2 = vx * vx + vy * vy;
            if (c2 < 1e-6) continue;
            const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
            const px = a2.x + t * vx, py = a2.y + t * vy;
            const d = Math.hypot(localP.x - px, localP.y - py);
            if (d < bestD) { bestD = d; bestI = i; bestProj = { x: px, y: py }; }
          }
          if (bestI >= 0 && bestProj && bestD <= tol) {
            pushHistory();
            const newPts = [...area.pointsLocal];
            newPts.splice(bestI + 1, 0, snapMmLocal(bestProj));
            onChange({
              parkingAreas: (sketch.parkingAreas ?? []).map((a2) =>
                a2.id === area.id ? { ...a2, pointsLocal: newPts } : a2,
              ),
            });
            setParkingSelectedId(area.id);
            return;
          }
        }
        return;
      }
      // 5) Move sub-tool: klik di dalam area → drag area; klik kosong → deselect
      if (parkingSubTool === "move") {
        for (let ai = areas.length - 1; ai >= 0; ai--) {
          const area = areas[ai];
          const worldPoly = area.pointsLocal.map((q) => ({
            x: q.x * Math.cos(mmGridRotRad) - q.y * Math.sin(mmGridRotRad),
            y: q.x * Math.sin(mmGridRotRad) + q.y * Math.cos(mmGridRotRad),
          }));
          let inside = false;
          for (let k = 0, j2 = worldPoly.length - 1; k < worldPoly.length; j2 = k++) {
            const xi = worldPoly[k].x, yi = worldPoly[k].y;
            const xj = worldPoly[j2].x, yj = worldPoly[j2].y;
            if ((yi > rawWp.y) !== (yj > rawWp.y) &&
                rawWp.x < ((xj - xi) * (rawWp.y - yi)) / (yj - yi + 1e-12) + xi) {
              inside = !inside;
            }
          }
          if (inside) {
            setParkingSelectedId(area.id);
            pushHistory();
            setParkingDrag({
              kind: "area",
              areaId: area.id,
              startWorld: rawWp,
              startPoints: area.pointsLocal.map((q) => ({ x: q.x, y: q.y })),
            });
            return;
          }
        }
        setParkingSelectedId(null);
        return;
      }
      return;
    }

    // ===== Ramp tool interactions =====
    if (tool === "ramp") {
      const wp = getWorldPos(e);
      const raw = getWorldPosRaw(e);
      const tol = 14 / view.s;
      if (rampSub === "tarik") {
        if (!activeLvlId) { toast.error("Pilih level dulu"); return; }
        const cur = [...(levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
        const i = cur.findIndex((l) => l.id === activeLvlId);
        if (i < 0 || i >= cur.length - 1) { toast.error("Ramp butuh level di atasnya sebagai puncak"); return; }
        if (!rampDraft) {
          setRampDraft({ levelId: activeLvlId, anchors: [{ x: wp.x, y: wp.y }], offsetSide: "right" });
        } else {
          setRampDraft({ ...rampDraft, anchors: [...rampDraft.anchors, { x: wp.x, y: wp.y }] });
        }
        return;
      }
      // Edit subs on existing ramps
      const ramps = (sketch.ramps ?? []).filter((r) => !activeLvlId || r.levelId === activeLvlId);
      if (rampSub === "geser") {
        for (let ri = ramps.length - 1; ri >= 0; ri--) {
          const r = ramps[ri];
          for (let i = 0; i < r.anchors.length; i++) {
            if (Math.hypot(raw.x - r.anchors[i].x, raw.y - r.anchors[i].y) <= tol) {
              setRampSelectedId(r.id);
              pushHistory();
              setRampVertexDrag({ rampId: r.id, idx: i });
              return;
            }
          }
        }
        return;
      }
      if (rampSub === "addpt") {
        // insert a new point at nearest segment midpoint of nearest ramp polyline
        let best: { rampId: string; segIdx: number; d: number; proj: Point } | null = null;
        for (const r of ramps) {
          for (let i = 1; i < r.anchors.length; i++) {
            const a = r.anchors[i - 1], b = r.anchors[i];
            const dx = b.x - a.x, dy = b.y - a.y;
            const L2 = dx * dx + dy * dy;
            if (L2 < 1e-6) continue;
            let u = ((raw.x - a.x) * dx + (raw.y - a.y) * dy) / L2;
            u = Math.max(0, Math.min(1, u));
            const px = a.x + dx * u, py = a.y + dy * u;
            const d = Math.hypot(raw.x - px, raw.y - py);
            if (d <= tol && (!best || d < best.d)) {
              best = { rampId: r.id, segIdx: i, d, proj: { x: px, y: py } };
            }
          }
        }
        if (!best) { toast.error("Tidak ada segmen ramp di sekitar tap"); return; }
        pushHistory();
        onChange({
          ramps: (sketch.ramps ?? []).map((r) => {
            if (r.id !== best!.rampId) return r;
            const a = [...r.anchors];
            a.splice(best!.segIdx, 0, { x: best!.proj.x, y: best!.proj.y });
            return { ...r, anchors: a };
          }),
        });
        setRampSelectedId(best.rampId);
        toast.success("Titik ditambahkan");
        return;
      }
      if (rampSub === "fillet") {
        // pick nearest internal anchor
        let best: { rampId: string; idx: number; d: number } | null = null;
        for (const r of ramps) {
          for (let i = 1; i < r.anchors.length - 1; i++) {
            const d = Math.hypot(raw.x - r.anchors[i].x, raw.y - r.anchors[i].y);
            if (d <= tol && (!best || d < best.d)) best = { rampId: r.id, idx: i, d };
          }
        }
        if (!best) { toast.error("Tap titik tengah polyline acuan"); return; }
        pushHistory();
        onChange({
          ramps: (sketch.ramps ?? []).map((r) => {
            if (r.id !== best!.rampId) return r;
            const a = r.anchors.map((p, i) => i === best!.idx ? { ...p, filletR: rampFilletM } : p);
            return { ...r, anchors: a };
          }),
        });
        setRampSelectedId(best.rampId);
        toast.success(`Fillet R=${rampFilletM}m diterapkan`);
        return;
      }
      // lebar / kemiringan: tap to select a ramp
      let pickId: string | null = null;
      for (let ri = ramps.length - 1; ri >= 0; ri--) {
        const r = ramps[ri];
        for (let i = 1; i < r.anchors.length; i++) {
          const a = r.anchors[i - 1], b = r.anchors[i];
          const dx = b.x - a.x, dy = b.y - a.y;
          const L2 = dx * dx + dy * dy;
          if (L2 < 1e-6) continue;
          let u = ((raw.x - a.x) * dx + (raw.y - a.y) * dy) / L2;
          u = Math.max(0, Math.min(1, u));
          const px = a.x + dx * u, py = a.y + dy * u;
          if (Math.hypot(raw.x - px, raw.y - py) <= tol) { pickId = r.id; break; }
        }
        if (pickId) break;
      }
      if (pickId) {
        setRampSelectedId(pickId);
        const r = (sketch.ramps ?? []).find((x) => x.id === pickId);
        if (r) {
          setRampWidthInput(String(r.widthM));
          setRampNInput(String(r.nM));
          setRampBordesOn(r.bordes === true);
          if (r.bordesLenM) setRampBordesLenInput(String(r.bordesLenM));
          setRampBordesBelokan(r.bordesBelokan === true);
        }
      }
      return;
    }

    const p = getWorldPos(e);
    if (tool === "grid") {
      const rawWorld = getWorldPosRaw(e);
      // Konversi ke frame lokal grid (un-rotate di sekitar origin) untuk hit-test
      // sehingga semua logika di bawah tetap dapat memakai sumbu sumbu yang sejajar.
      const raw = structGridRotRad !== 0
        ? rotateAround(rawWorld, grid.origin, -structGridRotRad)
        : rawWorld;
      // -------- MODE: jadikan grid dari satu garis lurus --------
      if (gridEditMode === "fromLine") {
        const tolPx = 10 / view.s;
        let bestIdx = -1;
        let bestD = Infinity;
        lines.forEach((ln, i) => {
          if ((ln.kind ?? "straight") !== "straight") return;
          if (activeLvlId && ln.levelId && ln.levelId !== activeLvlId) return;
          const d = pointToLine(rawWorld, ln);
          if (d < bestD) { bestD = d; bestIdx = i; }
        });
        if (bestIdx < 0 || bestD > tolPx) {
          toast.error("Tidak ada garis yang dipilih");
          return;
        }
        const startLn = lines[bestIdx];
        const lnOrigin = { ...startLn.a };
        const vx = startLn.b.x - startLn.a.x;
        const vy = startLn.b.y - startLn.a.y;
        const rotDeg = (Math.atan2(vy, vx) * 180) / Math.PI;
        const lenPx = Math.hypot(vx, vy);
        const lenM = lenPx / pxPerMeter;
        if (lenM < 0.1) {
          toast.error("Garis terlalu pendek");
          return;
        }
        // Gabungkan ke grid yang sedang aktif (primer atau extra yg dipilih).
        const prevExtraLines = grid.extraLines ?? [];
        const newExtra = {
          id: `xl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          origin: lnOrigin,
          rotation: rotDeg,
          lengthM: Number(lenM.toFixed(2)),
        };
        updateGrid({ extraLines: [...prevExtraLines, newExtra] });
        // Hapus garis aslinya, tapi pertahankan mode "fromLine" agar bisa
        // pilih garis lain secara berurutan.
        const nextLines = lines.filter((_, i) => i !== bestIdx);
        onChange({ lines: nextLines });
        toast.success("Garis ditambahkan ke grid aktif");
        return;
      }
      // -------- MODE: edit kolom (clip polygon) --------
      if (gridEditMode === "clip") {
        const ppm = pxPerMeter;
        const ox = grid.origin.x, oy = grid.origin.y;
        const tolPx = 14 / view.s;
        // 1) hit-test handle pada clip yang sudah ada atau draft
        type Hit = { clipId: string; idx: number; d: number };
        const hits: Hit[] = [];
        const collect = (clipId: string, ptsM: Array<{x:number;y:number}>) => {
          for (let i = 0; i < ptsM.length; i++) {
            const wx = ox + ptsM[i].x * ppm;
            const wy = oy + ptsM[i].y * ppm;
            const d = Math.hypot(raw.x - wx, raw.y - wy);
            if (d <= tolPx) hits.push({ clipId, idx: i, d });
          }
        };
        for (const c of grid.columnClips ?? []) collect(c.id, c.pts);
        if (clipDraft) collect("__draft__", clipDraft.pts);
        hits.sort((a, b) => a.d - b.d);
        const best = hits[0];
        if (best) {
          setClipDrag({
            clipId: best.clipId,
            idx: best.idx,
            moved: false,
            startScreen: getScreenPos(e),
          });
          return;
        }
        // 2) klik di area kosong → tambah titik ke draft (commit pas pointerUp tanpa drag)
        setClipDrag({
          clipId: "__add__",
          idx: -1,
          moved: false,
          startScreen: getScreenPos(e),
        });
        return;
      }
      // -------- MODE: expand (default) --------
      const corner = hitGridCorner(raw);
      const b = gridBounds();
      if (corner && b) {
        const startSpansX = b.spansX.slice();
        const startSpansY = b.spansY.slice();
        const avgX = startSpansX.reduce((s, n) => s + n, 0) / startSpansX.length;
        const avgY = startSpansY.reduce((s, n) => s + n, 0) / startSpansY.length;
        const unit = Math.max(1, Math.round(((avgX + avgY) / 2) * 2) / 2); // snap unit ke 0.5m
        setGridDrag({
          kind: "corner", corner,
          startWorld: raw,
          startOrigin: { ...grid.origin },
          startSpansX, startSpansY, unit,
        });
        return;
      }
      if (b && raw.x >= b.xMin && raw.x <= b.xMax && raw.y >= b.yMin && raw.y <= b.yMax) {
        setGridDrag({ kind: "move", startWorld: rawWorld, startOrigin: { ...grid.origin } });
        return;
      }
      // klik di luar → set origin ke titik klik (snap bila paralel dgn mm grid)
      const snapped = gridsParallel
        ? (() => {
            const local = rotateAround(rawWorld, { x: 0, y: 0 }, -mmGridRotRad);
            const sl = { x: Math.round(local.x / MINOR_PX) * MINOR_PX, y: Math.round(local.y / MINOR_PX) * MINOR_PX };
            return rotateAround(sl, { x: 0, y: 0 }, mmGridRotRad);
          })()
        : rawWorld;
      updateGrid({ origin: snapped });
      return;
    }
    if (tool === "floor") {
      if (floorMode === "rect") {
        setDrawing({ a: p, b: p });
      } else if (floorMode === "polyline" || floorMode === "line") {
        // Reuse polyDraft; floor commit handled in pointerUp branch via tool guard.
        const tolClose = 14 / view.s;
        if (!polyDraft) {
          setPolyDraft({ points: [p], lastSample: p, cursor: p, anchors: [p] });
        } else {
          const anchors = polyDraft.anchors && polyDraft.anchors.length > 0
            ? polyDraft.anchors
            : polyDraft.points.slice();
          const first = anchors[0];
          if (anchors.length >= 3 && dist(p, first) <= tolClose) {
            // Close back to first anchor with a straight segment
            const pts = [...polyDraft.points, first];
            setPolyDraft(null);
            if (pts.length >= 3) {
              setFloorDraft({ outer: pts, holes: [], levelId: activeLvlId });
              toast.success("Area disiapkan — tekan Simpan Area");
            }
          } else {
            setPolyDraft({
              points: [...polyDraft.points, p],
              lastSample: p,
              cursor: p,
              anchors: [...anchors, p],
            });
          }
        }
      } else if (floorMode === "arc" || floorMode === "bezier") {
        // Curve-based floor: each click is an anchor. Segment between consecutive
        // anchors is tessellated as arc (auto-bulge) or cubic bezier (auto-handles).
        const tolClose = 14 / view.s;
        if (!polyDraft) {
          setPolyDraft({ points: [p], lastSample: p, cursor: p, anchors: [p] });
        } else {
          // Backfill anchors from existing straight points if needed (mixed-tool draft)
          const anchors = polyDraft.anchors && polyDraft.anchors.length > 0
            ? polyDraft.anchors
            : polyDraft.points.slice();
          const first = anchors[0];
          const prev = anchors[anchors.length - 1];
          // Close when clicking near first anchor (≥ 2 existing anchors → ≥ 3 after closing curve back)
          if (anchors.length >= 2 && dist(p, first) <= tolClose) {
            const closingLine: Line = floorMode === "arc"
              ? { a: prev, b: first, kind: "arc", bulge: defaultBulgePx(prev, first) }
              : { a: prev, b: first, kind: "bezier", ...defaultBezierHandles(prev, first) };
            const tail = sampleLine(closingLine, 28).slice(1, -1);
            const pts = [...polyDraft.points, ...tail];
            setPolyDraft(null);
            if (pts.length >= 3) {
              setFloorDraft({ outer: pts, holes: [], levelId: activeLvlId });
              toast.success("Area disiapkan — tekan Simpan Area");
            }
          } else {
            const segLine: Line = floorMode === "arc"
              ? { a: prev, b: p, kind: "arc", bulge: defaultBulgePx(prev, p) }
              : { a: prev, b: p, kind: "bezier", ...defaultBezierHandles(prev, p) };
            const seg = sampleLine(segLine, 28).slice(1); // skip duplicate prev
            setPolyDraft({
              points: [...polyDraft.points, ...seg],
              lastSample: p,
              cursor: p,
              anchors: [...anchors, p],
            });
          }
        }
      } else if (floorMode === "attach") {
        // Pick segmen terdekat di level aktif, lalu cari cycle terkecil
        // yang melewatinya. Pertama → outer, berikutnya → hole.
        const tolPx = 12 / view.s;
        const raw = getWorldPosRaw(e);
        const candidates: { a: Point; b: Point; idx: number }[] = [];
        lines.forEach((ln, i) => {
          if (activeLvlId && ln.levelId && ln.levelId !== activeLvlId) return;
          if ((ln.kind ?? "straight") !== "straight") return;
          candidates.push({ a: ln.a, b: ln.b, idx: candidates.length });
        });
        let bestIdx = -1;
        let bestD = tolPx;
        candidates.forEach((c, i) => {
          const d = pointToSegmentDist(raw, c.a, c.b);
          if (d < bestD) { bestD = d; bestIdx = i; }
        });
        if (bestIdx < 0) {
          toast.error("Tidak ada garis di dekat klik");
          return;
        }
        const segs = candidates.map((c) => ({ a: c.a, b: c.b }));
        const cycle = findCycleThroughSegment(segs, bestIdx, SNAP_TOL);
        if (!cycle || cycle.length < 3) {
          toast.error("Segmen tidak membentuk poligon tertutup");
          return;
        }
        const cur = floorDraft ?? { outer: null as Point[] | null, holes: [] as Point[][], levelId: activeLvlId };
        if (!cur.outer) {
          setFloorDraft({ outer: cycle, holes: [], levelId: activeLvlId });
          toast.success("Outer dipilih — klik segmen lubang berikutnya atau tekan Selesai");
        } else {
          // Validasi: centroid hole harus berada di dalam outer
          const c = floorPolyCentroid(cycle);
          if (!floorPointInPolygon(c, cur.outer)) {
            toast.error("Poligon ini bukan lubang di dalam outer");
            return;
          }
          setFloorDraft({ outer: cur.outer, holes: [...cur.holes, cycle], levelId: cur.levelId });
          toast.success(`Void #${cur.holes.length + 1} ditambahkan`);
        }
      } else if (floorMode === "edit") {
        // Edit Titik — sub-mode "move" (geser) atau "add" (tambah titik).
        const raw = getWorldPosRaw(e);
        const tolPx = 14 / view.s;
        const flList = (sketch.floors ?? []).filter(
          (f) => !activeLvlId || f.levelId === activeLvlId,
        );
        if (floorEditSub === "addVoid") {
          // Klik titik-titik di dalam lantai untuk membentuk void (hole).
          const snapped = snapPoint(raw);
          // Tentukan floor target: pakai draft yg sedang aktif, atau cari floor yg memuat klik.
          let targetFid = floorVoidDraft?.fid ?? null;
          if (!targetFid) {
            const inside = flList.find(
              (fl) =>
                floorPointInPolygon(snapped, fl.outer) &&
                !(fl.holes ?? []).some((h) => floorPointInPolygon(snapped, h)),
            );
            if (!inside) {
              toast.error("Klik di dalam area lantai untuk memulai void");
              return;
            }
            targetFid = inside.id;
          } else {
            // Pastikan titik berikutnya masih di dalam outer floor target & bukan dalam hole lain.
            const fl = flList.find((f) => f.id === targetFid);
            if (!fl) { setFloorVoidDraft(null); return; }
            if (!floorPointInPolygon(snapped, fl.outer)) {
              toast.error("Titik harus berada di dalam lantai");
              return;
            }
            if ((fl.holes ?? []).some((h) => floorPointInPolygon(snapped, h))) {
              toast.error("Titik tidak boleh berada di dalam void yang sudah ada");
              return;
            }
          }
          const cur = floorVoidDraft && floorVoidDraft.fid === targetFid ? floorVoidDraft.points : [];
          // Cek close: klik dekat titik awal & sudah ada ≥3 titik → komit void.
          if (cur.length >= 3) {
            const first = cur[0];
            if (Math.hypot(first.x - snapped.x, first.y - snapped.y) < tolPx) {
              const tgt = (sketch.floors ?? []).find((f) => f.id === targetFid);
              if (!tgt) { setFloorVoidDraft(null); return; }
              const newHole = cur.slice();
              pushHistory();
              const nextFloors = (sketch.floors ?? []).map((fl) =>
                fl.id === targetFid
                  ? { ...fl, holes: [...(fl.holes ?? []), newHole] }
                  : fl,
              );
              onChange({ floors: nextFloors });
              setFloorVoidDraft(null);
              toast.success("Void ditambahkan");
              return;
            }
          }
          setFloorVoidDraft({ fid: targetFid, points: [...cur, snapped] });
          return;
        }
        if (floorEditSub === "move" || floorEditSub === "delete") {
          // cari vertex terdekat
          type VHit = { fid: string; ring: "outer" | number; idx: number; d: number };
          const hits: VHit[] = [];
          for (const fl of flList) {
            fl.outer.forEach((v, i) => {
              const d = Math.hypot(v.x - raw.x, v.y - raw.y);
              if (d < tolPx) hits.push({ fid: fl.id, ring: "outer", idx: i, d });
            });
            (fl.holes ?? []).forEach((h, hi) => {
              h.forEach((v, i) => {
                const d = Math.hypot(v.x - raw.x, v.y - raw.y);
                if (d < tolPx) hits.push({ fid: fl.id, ring: hi, idx: i, d });
              });
            });
          }
          if (hits.length === 0) {
            if (floorEditSub === "move") {
              // Mulai marquee untuk pilih banyak titik lantai dengan stylus.
              setFloorVertexMarquee({ start: raw, cur: raw, additive: e.shiftKey || e.metaKey || e.ctrlKey });
              return;
            }
            toast.error("Tidak ada titik lantai di dekat klik");
            return;
          }
          hits.sort((a, b) => a.d - b.d);
          const bestV = hits[0];
          if (floorEditSub === "move") {
            const tgt = flList.find((f) => f.id === bestV.fid);
            const coord = tgt
              ? (bestV.ring === "outer"
                  ? tgt.outer[bestV.idx]
                  : (tgt.holes ?? [])[bestV.ring as number]?.[bestV.idx])
              : null;
            if (!coord) { return; }
            const sel: FloorVertexSel = { fid: bestV.fid, ring: bestV.ring, idx: bestV.idx, coord: { x: coord.x, y: coord.y } };
            const keyEq = (a: FloorVertexSel, b: FloorVertexSel) =>
              a.fid === b.fid && a.ring === b.ring && a.idx === b.idx;
            if (e.shiftKey || e.metaKey || e.ctrlKey) {
              setSelectedFloorEditVertices((prev) => {
                const exists = prev.some((p) => keyEq(p, sel));
                return exists ? prev.filter((p) => !keyEq(p, sel)) : [...prev, sel];
              });
              return;
            }
            pushHistory();
            setFloorVertexDrag({ fid: bestV.fid, ring: bestV.ring, idx: bestV.idx });
            setSelectedFloorEditVertices((prev) => (prev.some((p) => keyEq(p, sel)) ? prev : [sel]));
          } else {
            // delete vertex — izinkan hingga habis; <2 titik otomatis hapus area/void
            const target = flList.find((f) => f.id === bestV.fid);
            if (!target) return;
            pushHistory();
            let removedFloor = false;
            let removedVoid = false;
            const nextFloors = (sketch.floors ?? []).flatMap((fl) => {
              if (fl.id !== bestV.fid) return [fl];
              if (bestV.ring === "outer") {
                const next = fl.outer.slice();
                next.splice(bestV.idx, 1);
                if (next.length < 2) {
                  removedFloor = true;
                  return [];
                }
                return [{ ...fl, outer: next }];
              }
              const holes = (fl.holes ?? [])
                .map((h, hi) => {
                  if (hi !== bestV.ring) return h;
                  const nh = h.slice();
                  nh.splice(bestV.idx, 1);
                  return nh;
                })
                .filter((h) => {
                  if (h.length < 2) { removedVoid = true; return false; }
                  return true;
                });
              return [{ ...fl, holes: holes.length ? holes : undefined }];
            });
            onChange({ floors: nextFloors });
            if (removedFloor) toast.message("Lantai dihapus — titik kurang dari 2");
            else if (removedVoid) toast.message("Void dihapus — titik kurang dari 2");
            else toast.success("Titik dihapus");
          }
        } else {
          // tambah titik: cari segmen terdekat, sisipkan vertex baru di proyeksi
          type EHit = { fid: string; ring: "outer" | number; segIdx: number; proj: Point; d: number };
          const ehits: EHit[] = [];
          const projectOnSeg = (p: Point, a: Point, b: Point): Point => {
            const dx = b.x - a.x, dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            if (len2 < 1e-9) return { x: a.x, y: a.y };
            let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            return { x: a.x + t * dx, y: a.y + t * dy };
          };
          const scan = (ring: Point[], fid: string, ringKey: "outer" | number) => {
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i];
              const b = ring[(i + 1) % ring.length];
              const d = pointToSegmentDist(raw, a, b);
              if (d < tolPx) ehits.push({ fid, ring: ringKey, segIdx: i, proj: projectOnSeg(raw, a, b), d });
            }
          };
          for (const fl of flList) {
            scan(fl.outer, fl.id, "outer");
            (fl.holes ?? []).forEach((h, hi) => scan(h, fl.id, hi));
          }
          if (ehits.length === 0) {
            toast.error("Tidak ada tepi lantai di dekat klik");
            return;
          }
          ehits.sort((a, b) => a.d - b.d);
          const bestE = ehits[0];
          const snapped = snapPoint(bestE.proj);
          pushHistory();
          const nextFloors = (sketch.floors ?? []).map((fl) => {
            if (fl.id !== bestE.fid) return fl;
            if (bestE.ring === "outer") {
              const next = fl.outer.slice();
              next.splice(bestE.segIdx + 1, 0, snapped);
              return { ...fl, outer: next };
            }
            const holes = (fl.holes ?? []).map((h, hi) => {
              if (hi !== bestE.ring) return h;
              const nh = h.slice();
              nh.splice(bestE.segIdx + 1, 0, snapped);
              return nh;
            });
            return { ...fl, holes };
          });
          onChange({ floors: nextFloors });
          toast.success("Titik ditambahkan");
        }
      }
      return;
    }
    if (tool === "mirror") {
      if (moveSel.size === 0) {
        toast.error("Pilih objek dulu di tool Move sebelum mirror");
        return;
      }
      const origin = snapPoint(getWorldPosRaw(e));
      setMirrorDraft({ origin, cur: origin, angleDeg: 0 });
      return;
    }
    if (tool === "move") {
      const raw = getWorldPosRaw(e);
      const tol = 10 / view.s;
      const hit = moveHitTest(raw, tol);
      const shift = e.shiftKey;
      if (hit) {
        // Tentukan selection awal drag.
        let nextSel = new Set(moveSel);
        const wasSelected = nextSel.has(hit);
        if (shift) {
          // Shift: tambahkan ke selection (jangan hapus pilihan lain).
          if (!wasSelected) nextSel.add(hit);
        } else if (!wasSelected) {
          // Klik baru pada entitas → ganti selection.
          nextSel = new Set([hit]);
        }
        setMoveSel(nextSel);
        // Mulai potensi drag.
        pushHistory();
        setMoveDrag({
          startWorld: raw,
          snapshot: buildMoveSnapshot(),
          moved: false,
          hitKey: hit,
          hitWasSelected: wasSelected,
          prevSel: new Set(moveSel),
          shiftKey: shift,
          appliedDx: 0,
          appliedDy: 0,
        });
      } else {
        // Klik di area kosong → mulai rubber-band marquee.
        setMoveMarquee({ start: raw, cur: raw, additive: shift });
      }
      return;
    }
    if (tool === "section" && sectionSub !== "add") {
      const raw = getWorldPosRaw(e);
      const tol = 18 / view.s;
      const cuts = sketch.sectionCuts ?? [];
      let bestIdx = -1;
      let bestWhich: "p1" | "p2" = "p1";
      let bestD = Infinity;
      cuts.forEach((c, i) => {
        const d1 = dist(raw, c.p1);
        const d2 = dist(raw, c.p2);
        if (d1 < bestD) { bestD = d1; bestIdx = i; bestWhich = "p1"; }
        if (d2 < bestD) { bestD = d2; bestIdx = i; bestWhich = "p2"; }
      });
      if (sectionSub === "flip") {
        let segIdx = -1;
        let segD = Infinity;
        cuts.forEach((c, i) => {
          const d = pointToSegmentDist(raw, c.p1, c.p2);
          if (d < segD) { segD = d; segIdx = i; }
        });
        const useIdx = bestD <= tol ? bestIdx : (segD <= tol ? segIdx : -1);
        if (useIdx >= 0) {
          pushHistory();
          const next = cuts.map((c, i) =>
            i === useIdx ? { ...c, p1: c.p2, p2: c.p1, updatedAt: Date.now() } : c,
          );
          onChange({ sectionCuts: next });
          toast.success(`Arah Potongan ${next[useIdx].label || sectionLabelFor(useIdx)} dibalik`);
        } else {
          toast.message("Ketuk garis potong untuk membalik arah pandang");
        }
        return;
      }
      // geser bubble ujung
      if (bestIdx >= 0 && bestD <= tol) {
        pushHistory();
        setSectionEndpointDrag({ idx: bestIdx, which: bestWhich });
      } else {
        toast.message("Ketuk bubble ujung garis potong untuk menggeser");
      }
      return;
    }
    if (tool === "line" && lineSub === "room") {
      // Jadikan Ruang — klik di dalam area tertutup yang dibentuk garis-garis
      // (mengabaikan garis potong & grid struktur). Garis dipecah pada tiap
      // titik potong sehingga garis yang bersilangan tetap membentuk cycle.
      const raw = getWorldPosRaw(e);
      const allSegs = computeStraightSegments(lines).filter(
        (s) => !activeLvlId || s.levelId === activeLvlId,
      );
      const segs = allSegs.map((s) => ({ a: s.a, b: s.b }));
      if (segs.length < 3) {
        toast.error("Belum cukup garis untuk membentuk ruang");
        return;
      }
      let bestCycle: Point[] | null = null;
      let bestArea = Infinity;
      for (let i = 0; i < segs.length; i++) {
        const cyc = findCycleThroughSegment(segs, i, SNAP_TOL);
        if (!cyc || cyc.length < 3) continue;
        if (!floorPointInPolygon(raw, cyc)) continue;
        const a = floorPolyArea(cyc);
        if (a > 25 && a < bestArea) {
          bestArea = a;
          bestCycle = cyc;
        }
      }
      if (!bestCycle) {
        toast.error("Klik di dalam area garis tertutup");
        return;
      }
      const { activeId } = ensureLevels();
      const areaM2 = bestArea / (pxPerMeter * pxPerMeter);
      const idx = layers.length + 1;
      const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];
      const layer: Layer = {
        id: `L${Date.now()}`,
        name: `Ruang ${idx}`,
        points: bestCycle,
        areaM2,
        color,
        locked: false,
        levelId: activeId,
        coefficient: 1,
      };
      const carved = applySubtractionToLayers(layers, bestCycle, activeId);
      pushHistory();
      onChange({ layers: [...carved, layer] });
      toast.success(`${layer.name} terbentuk — ${areaM2.toFixed(2)} m²`);
      return;
    }
    if (
      tool === "line" || tool === "rect" || tool === "section" || tool === "separasi" ||
      (tool === "parking" && parkingSubTool === "draw") ||
      (tool === "aksis" && aksisSub === "garis") ||
      (tool === "jalan" && jalanSub === "garis")
    ) {
      setDrawing({ a: p, b: p });


    } else if (tool === "aksis" && aksisSub === "tangent") {
      if (!aksisDraft) {
        setAksisDraft({ kind: "tangent", points: [p], cursor: p });
      } else {
        setAksisDraft({ ...aksisDraft, points: [...aksisDraft.points, p], cursor: p });
      }
    } else if (tool === "jalan" && jalanSub === "tangent") {
      if (!jalanDraft) {
        setJalanDraft({ kind: "tangent", points: [p], cursor: p });
      } else {
        setJalanDraft({ ...jalanDraft, points: [...jalanDraft.points, p], cursor: p });
      }
    } else if (tool === "jalan" && jalanSub === "fillet") {
      // Klik dekat vertex internal jalan → set radius fillet jalan tsb.
      const tolPx = 12 / view.s;
      const roads = sketch.roads ?? [];
      let bestIdx = -1, bestD = Infinity;
      for (let i = 0; i < roads.length; i++) {
        const rd = roads[i];
        for (let v = 1; v < rd.points.length - 1; v++) {
          const d = Math.hypot(rd.points[v].x - p.x, rd.points[v].y - p.y);
          if (d < bestD) { bestD = d; bestIdx = i; }
        }
        // tangent multi-segmen — boleh klik tengah-tengah sebagai update global
        const d2 = Math.hypot(rd.points[0].x - p.x, rd.points[0].y - p.y);
        if (d2 < bestD) { bestD = d2; bestIdx = i; }
      }
      if (bestIdx >= 0 && bestD <= Math.max(tolPx, jalanWidthM * pxPerMeter)) {
        const nextR = roads.map((rd, i) => i === bestIdx ? { ...rd, filletM: jalanFilletM } : rd);
        onChange({ roads: nextR });
        toast.success(`Fillet jalan = ${jalanFilletM.toFixed(2)} m`);
      }
    } else if (tool === "jalan" && jalanSub === "hapus") {
      const roads = sketch.roads ?? [];
      let bestIdx = -1, bestD = Infinity;
      for (let i = 0; i < roads.length; i++) {
        const rd = roads[i];
        const center = roadCenterline(rd);
        const halfPx = (rd.widthM * pxPerMeter) / 2;
        for (let s = 0; s < center.length - 1; s++) {
          const a2 = center[s], b2 = center[s + 1];
          const dx = b2.x - a2.x, dy = b2.y - a2.y;
          const l2 = dx * dx + dy * dy;
          let t = l2 > 1e-9 ? ((p.x - a2.x) * dx + (p.y - a2.y) * dy) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const cx = a2.x + t * dx, cy = a2.y + t * dy;
          const d = Math.hypot(p.x - cx, p.y - cy);
          if (d < bestD && d <= halfPx + 8 / view.s) { bestD = d; bestIdx = i; }
        }
      }
      if (bestIdx >= 0) {
        pushHistory();
        onChange({ roads: roads.filter((_, i) => i !== bestIdx) });
        toast.success("Jalan dihapus");
      } else {
        toast.error("Klik di atas jalan untuk menghapus");
      }
    } else if (tool === "jalan" && jalanSub === "geser") {
      const roads = sketch.roads ?? [];
      const tolPx = 14 / view.s;
      let best: { ri: number; vi: number; d: number } | null = null;
      for (let i = 0; i < roads.length; i++) {
        for (let v = 0; v < roads[i].points.length; v++) {
          const d = Math.hypot(roads[i].points[v].x - p.x, roads[i].points[v].y - p.y);
          if (d <= tolPx && (!best || d < best.d)) best = { ri: i, vi: v, d };
        }
      }
      if (best) {
        pushHistory();
        setRoadVertexDrag({ roadId: roads[best.ri].id, idx: best.vi });
      } else {
        toast.error("Klik tepat pada titik jalan untuk menggeser");
      }
    } else if (tool === "jalan" && jalanSub === "tambahTitik") {
      const roads = sketch.roads ?? [];
      const tolPx = 12 / view.s;
      let best: { ri: number; segIdx: number; pt: Point; d: number } | null = null;
      for (let i = 0; i < roads.length; i++) {
        const pts = roads[i].points;
        for (let s = 0; s < pts.length - 1; s++) {
          const a2 = pts[s], b2 = pts[s + 1];
          const dx = b2.x - a2.x, dy = b2.y - a2.y;
          const l2 = dx * dx + dy * dy;
          let t = l2 > 1e-9 ? ((p.x - a2.x) * dx + (p.y - a2.y) * dy) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const cx = a2.x + t * dx, cy = a2.y + t * dy;
          const d = Math.hypot(p.x - cx, p.y - cy);
          if (d <= tolPx && (!best || d < best.d)) best = { ri: i, segIdx: s, pt: { x: cx, y: cy }, d };
        }
      }
      if (best) {
        pushHistory();
        const next = roads.map((rd, i) => {
          if (i !== best!.ri) return rd;
          const np = rd.points.slice();
          np.splice(best!.segIdx + 1, 0, best!.pt);
          return { ...rd, points: np };
        });
        onChange({ roads: next });
        toast.success("Titik ditambahkan");
      } else {
        toast.error("Klik pada centerline jalan untuk menambah titik");
      }
    } else if (tool === "jalan" && jalanSub === "hapusTitik") {
      const roads = sketch.roads ?? [];
      const tolPx = 14 / view.s;
      let best: { ri: number; vi: number; d: number } | null = null;
      for (let i = 0; i < roads.length; i++) {
        for (let v = 0; v < roads[i].points.length; v++) {
          const d = Math.hypot(roads[i].points[v].x - p.x, roads[i].points[v].y - p.y);
          if (d <= tolPx && (!best || d < best.d)) best = { ri: i, vi: v, d };
        }
      }
      if (best) {
        const rd = roads[best.ri];
        const minPts = rd.kind === "tangent" ? 3 : 2;
        if (rd.points.length <= minPts) {
          toast.error(`Tidak bisa hapus — jalan minimum ${minPts} titik`);
        } else {
          pushHistory();
          const next = roads.map((r, i) => i === best!.ri ? { ...r, points: r.points.filter((_, v) => v !== best!.vi) } : r);
          onChange({ roads: next });
          toast.success("Titik dihapus");
        }
      } else {
        toast.error("Klik pada titik jalan untuk menghapus");
      }
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
      if (!hit) {
        // Tidak ada titik di bawah kursor → mulai marquee untuk pilih banyak titik.
        setEditVertexMarquee({ start: raw, cur: raw, additive: e.shiftKey || e.metaKey || e.ctrlKey });
        return;
      }
      const k = keyOf(hit.coord);
      const sel = { target: hit.target, coord: hit.coord };
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        // toggle membership; do not drag
        setSelectedEditVertices((prev) => {
          const exists = prev.some((p) => keyOf(p.coord) === k);
          return exists ? prev.filter((p) => keyOf(p.coord) !== k) : [...prev, sel];
        });
        return;
      }
      if (lockedVertexKeys.has(k)) {
        toast.error("Titik terkunci");
        return;
      }
      pushHistory();
      setEditDrag({ key: k, coord: hit.coord, target: hit.target });
      setSelectedEditVertices((prev) => (prev.some((p) => keyOf(p.coord) === k) ? prev : [sel]));
    } else if (tool === "pick") {
      if (!activeLvlId) {
        toast.error("Pilih Level aktif terlebih dahulu");
        return;
      }
      const raw = getWorldPosRaw(e);
      const tol = 10 / view.s;
      const segs = computeStraightSegments(lines).filter(
        (s) => s.levelId === activeLvlId,
      );
      const hit = pickSegmentAt(raw, segs, tol);
      if (!hit) return;
      const prev = sketch.edgeAttrs ?? {};
      const next: Record<string, EdgeMaterial> = { ...prev };
      // Alt/Shift = hapus attribute.
      if (e.altKey || e.shiftKey) {
        delete next[hit.id];
      } else {
        next[hit.id] = pickMaterial;
      }
      pushHistory();
      onChange({ edgeAttrs: next });
    } else if (tool === "door") {
      const raw = getWorldPosRaw(e);
      if (doorEraseMode) {
        const doors = sketch.doors ?? [];
        if (doors.length === 0) {
          toast.error("Belum ada pintu untuk dihapus");
          return;
        }
        const tolPx = 18 / view.s;
        let bestId: string | null = null;
        let bestD = Infinity;
        for (const d of doors) {
          if (activeLvlId && d.levelId && d.levelId !== activeLvlId) continue;
          const proj = projectOnSegment(raw, d.a, d.b);
          const dd = dist(raw, proj);
          // juga cek jarak ke titik engsel agar mudah di-tap
          const dh = dist(raw, d.a);
          const m = Math.min(dd, dh);
          if (m < bestD) { bestD = m; bestId = d.id; }
        }
        if (!bestId || bestD > tolPx) {
          toast.error("Tap dekat pintu yang ingin dihapus");
          return;
        }
        pushHistory();
        onChange({ doors: doors.filter((d) => d.id !== bestId) });
        toast.success("Pintu dihapus");
        return;
      }
      // Step 1 — Snap engsel (Titik A) ke garis lurus terdekat di level aktif.
      const tolPx = 16 / view.s;
      let bestLn: Line | null = null;
      let bestProj: Point | null = null;
      let bestD = Infinity;
      for (const ln of lines) {
        if (activeLvlId && ln.levelId !== activeLvlId) continue;
        if ((ln.kind ?? "straight") !== "straight") continue;
        const proj = projectOnSegment(raw, ln.a, ln.b);
        const d = dist(raw, proj);
        if (d < bestD) { bestD = d; bestProj = proj; bestLn = ln; }
      }
      if (!bestLn || !bestProj || bestD > tolPx) {
        toast.error("Tap pada garis dinding untuk menempatkan engsel pintu");
        return;
      }
      const dxL = bestLn.b.x - bestLn.a.x;
      const dyL = bestLn.b.y - bestLn.a.y;
      const Llen = Math.hypot(dxL, dyL) || 1;
      const dirX = dxL / Llen, dirY = dyL / Llen;
      // Pastikan ada cukup ruang di sisa garis: jika dekat ujung, balik arah default.
      const widthPx = (doorWidthCm / 100) * pxPerMeter;
      const remainFwd = (bestLn.b.x - bestProj.x) * dirX + (bestLn.b.y - bestProj.y) * dirY;
      const initSign = remainFwd >= widthPx * 0.5 ? 1 : -1;
      const bx = bestProj.x + dirX * initSign * widthPx;
      const by = bestProj.y + dirY * initSign * widthPx;
      // Normal default: +90° dari arah.
      setDoorDraft({
        a: bestProj,
        dirX, dirY,
        b: { x: bx, y: by },
        nx: -dirY, ny: dirX,
        levelId: bestLn.levelId ?? activeLvlId ?? undefined,
      });
    } else if (tool === "circle") {
      setCircleDraft({ c: p, cur: p, levelId: activeLvlId ?? undefined });
    } else if (tool === "trim" || tool === "offset") {
      const raw = getWorldPosRaw(e);
      const tolPx = 14 / view.s;
      // cari garis lurus terdekat di level aktif
      let bestIdx = -1;
      let bestD = Infinity;
      let bestProj: Point | null = null;
      lines.forEach((ln, i) => {
        if (activeLvlId && ln.levelId !== activeLvlId) return;
        if ((ln.kind ?? "straight") !== "straight") return;
        if (isLineLocked(ln)) return;
        const proj = projectOnSegment(raw, ln.a, ln.b);
        const d = dist(raw, proj);
        if (d < bestD) { bestD = d; bestIdx = i; bestProj = proj; }
      });
      if (bestIdx < 0 || !bestProj || bestD > tolPx * 3) {
        toast.error("Tap pada garis lurus");
        return;
      }
      const ln = lines[bestIdx];
      if (tool === "offset") {
        // arah normal: dari proyeksi ke titik tap
        const dx = ln.b.x - ln.a.x, dy = ln.b.y - ln.a.y;
        const L = Math.hypot(dx, dy) || 1;
        let nx = -dy / L, ny = dx / L;
        const bp: Point = bestProj;
        const side = (raw.x - bp.x) * nx + (raw.y - bp.y) * ny;
        if (side < 0) { nx = -nx; ny = -ny; }
        const offPx = (offsetCm / 100) * pxPerMeter;
        const newLine: Line = {
          a: { x: ln.a.x + nx * offPx, y: ln.a.y + ny * offPx },
          b: { x: ln.b.x + nx * offPx, y: ln.b.y + ny * offPx },
          kind: "straight",
          levelId: ln.levelId,
        };
        pushHistory();
        onChange({ lines: [...lines, newLine] });
        toast.success(`Offset ${offsetCm} cm`);
        return;
      }
      // TRIM/EXTEND: cari garis lurus lain terdekat sebagai boundary
      let bIdx = -1;
      let bD = Infinity;
      lines.forEach((ln2, j) => {
        if (j === bestIdx) return;
        if (activeLvlId && ln2.levelId !== activeLvlId) return;
        if ((ln2.kind ?? "straight") !== "straight") return;
        const proj = projectOnSegment(raw, ln2.a, ln2.b);
        const d = dist(raw, proj);
        if (d < bD) { bD = d; bIdx = j; }
      });
      if (bIdx < 0) {
        toast.error("Butuh garis lain sebagai batas");
        return;
      }
      const lnB = lines[bIdx];
      // hitung interseksi infinite-line A vs infinite-line B
      const x1 = ln.a.x, y1 = ln.a.y, x2 = ln.b.x, y2 = ln.b.y;
      const x3 = lnB.a.x, y3 = lnB.a.y, x4 = lnB.b.x, y4 = lnB.b.y;
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(den) < 1e-6) {
        toast.error("Garis sejajar — tidak ada interseksi");
        return;
      }
      const tA = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      const ix = x1 + tA * (x2 - x1);
      const iy = y1 + tA * (y2 - y1);
      // ujung mana dari ln yang lebih dekat ke titik tap → itu yang dipindah ke interseksi
      const dA = dist(raw, ln.a);
      const dB = dist(raw, ln.b);
      const moveA = dA <= dB;
      const nextLn: Line = moveA
        ? { ...ln, a: { x: ix, y: iy } }
        : { ...ln, b: { x: ix, y: iy } };
      // cegah panjang ~0
      if (dist(nextLn.a, nextLn.b) < 1) {
        toast.error("Hasil terlalu pendek");
        return;
      }
      pushHistory();
      onChange({ lines: lines.map((x, i) => (i === bestIdx ? nextLn : x)) });
      const lenM = dist(nextLn.a, nextLn.b) / pxPerMeter;
      toast.success(`Trim/Extend → ${lenM.toFixed(2)} m`);
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
        return;
      }
      // Coba hapus lingkaran: jarak ke keliling
      const circles = sketch.circles ?? [];
      let cIdx = -1;
      let cBestD = Infinity;
      circles.forEach((cc, i) => {
        if (activeLvlId && cc.levelId !== activeLvlId) return;
        const d = Math.abs(Math.hypot(p.x - cc.c.x, p.y - cc.c.y) - cc.r);
        if (d < cBestD) { cBestD = d; cIdx = i; }
      });
      if (cIdx >= 0 && cBestD <= tol) {
        pushHistory();
        onChange({ circles: circles.filter((_, i) => i !== cIdx) });
        return;
      }
      // Coba hapus area parkir bila klik di dalam bbox-nya
      const parkAreas = sketch.parkingAreas ?? [];
      for (let i = parkAreas.length - 1; i >= 0; i--) {
        const a = parkAreas[i];
        if (activeLvlId && a.levelId !== activeLvlId) continue;
        // Hit-test polygon di koordinat dunia.
        const worldPoly = a.pointsLocal.map((q) => ({
          x: q.x * Math.cos(mmGridRotRad) - q.y * Math.sin(mmGridRotRad),
          y: q.x * Math.sin(mmGridRotRad) + q.y * Math.cos(mmGridRotRad),
        }));
        let inside = false;
        for (let k = 0, j2 = worldPoly.length - 1; k < worldPoly.length; j2 = k++) {
          const xi = worldPoly[k].x, yi = worldPoly[k].y;
          const xj = worldPoly[j2].x, yj = worldPoly[j2].y;
          if ((yi > p.y) !== (yj > p.y) &&
              p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi) {
            inside = !inside;
          }
        }
        if (inside) {
          pushHistory();
          onChange({ parkingAreas: parkAreas.filter((_, j) => j !== i) });
          toast.success("Area parkir dihapus");
          return;
        }
      }
      const hitLocked = lines.find((ln) => (!activeLvlId || ln.levelId === activeLvlId) && isLineLocked(ln) && pointToLine(p, ln) <= tol);
      if (hitLocked) toast.error("Garis terkunci");
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Ramp vertex drag
    if (roadVertexDrag) {
      const wp = getWorldPos(e);
      onChange({
        roads: (sketch.roads ?? []).map((r) =>
          r.id !== roadVertexDrag.roadId ? r : { ...r, points: r.points.map((pt, i) => i === roadVertexDrag.idx ? { x: wp.x, y: wp.y } : pt) }
        ),
      });
      return;
    }
    if (rampVertexDrag) {
      const wp = getWorldPos(e);
      onChange({
        ramps: (sketch.ramps ?? []).map((r) => {
          if (r.id !== rampVertexDrag.rampId) return r;
          const idx = rampVertexDrag.idx;
          let a = r.anchors.map((p, i) => i === idx ? { ...p, x: wp.x, y: wp.y } : p);
          const lockedPx = (r.lockedLenM ?? 0) * pxPerMeter;
          if (lockedPx > 0 && a.length >= 2) {
            const lastIdx = a.length - 1;
            if (idx === lastIdx) {
              // Dragging the last anchor: user sets direction, length is locked
              let used = 0;
              for (let i = 1; i < lastIdx; i++) used += Math.hypot(a[i].x - a[i - 1].x, a[i].y - a[i - 1].y);
              const remain = Math.max(1, lockedPx - used);
              const prev = a[lastIdx - 1];
              const dx = wp.x - prev.x, dy = wp.y - prev.y;
              const L = Math.hypot(dx, dy) || 1;
              a = a.map((p, i) => i === lastIdx ? { ...p, x: prev.x + (dx / L) * remain, y: prev.y + (dy / L) * remain } : p);
            } else {
              // Dragging an interior/start anchor: slide the last anchor along its current direction
              let cur = 0;
              for (let i = 1; i < a.length; i++) cur += Math.hypot(a[i].x - a[i - 1].x, a[i].y - a[i - 1].y);
              const diff = lockedPx - cur;
              const last = a[lastIdx], prev = a[lastIdx - 1];
              const dx = last.x - prev.x, dy = last.y - prev.y;
              const L = Math.hypot(dx, dy) || 1;
              const segLen = L;
              const newSeg = Math.max(1, segLen + diff);
              a = a.map((p, i) => i === lastIdx ? { ...p, x: prev.x + (dx / L) * newSeg, y: prev.y + (dy / L) * newSeg } : p);
            }
          }
          return { ...r, anchors: a };
        }),
      });
      return;
    }
    // Garis Potong: geser bubble ujung
    if (sectionEndpointDrag) {
      const np = getWorldPos(e);
      const cuts = sketch.sectionCuts ?? [];
      const idx = sectionEndpointDrag.idx;
      if (idx < cuts.length) {
        const next = cuts.map((c, i) =>
          i === idx ? { ...c, [sectionEndpointDrag.which]: np, updatedAt: Date.now() } : c,
        );
        onChange({ sectionCuts: next });
      }
      return;
    }
    // Parking drag (vertex / rotate / area)
    if (parkingDrag) {
      const rawWp = getWorldPosRaw(e);
      const areas = sketch.parkingAreas ?? [];
      if (parkingDrag.kind === "vertex") {
        const lp = snapWorldToMmLocal(rawWp);
        onChange({
          parkingAreas: areas.map((a) => {
            if (a.id !== parkingDrag.areaId) return a;
            const next = [...a.pointsLocal];
            next[parkingDrag.idx] = lp;
            return { ...a, pointsLocal: next };
          }),
        });
        return;
      }
      if (parkingDrag.kind === "rotate") {
        const ang = Math.atan2(rawWp.y - parkingDrag.centerWorld.y, rawWp.x - parkingDrag.centerWorld.x);
        const newRot = parkingDrag.startRot + (ang - parkingDrag.startAngle);
        onChange({
          parkingAreas: areas.map((a) =>
            a.id === parkingDrag.areaId ? { ...a, stallRotation: newRot } : a,
          ),
        });
        return;
      }
      if (parkingDrag.kind === "area") {
        const dxW = rawWp.x - parkingDrag.startWorld.x;
        const dyW = rawWp.y - parkingDrag.startWorld.y;
        const dLx = dxW * Math.cos(-mmGridRotRad) - dyW * Math.sin(-mmGridRotRad);
        const dLy = dxW * Math.sin(-mmGridRotRad) + dyW * Math.cos(-mmGridRotRad);
        const snapDx = Math.round(dLx / MINOR_PX) * MINOR_PX;
        const snapDy = Math.round(dLy / MINOR_PX) * MINOR_PX;
        onChange({
          parkingAreas: areas.map((a) =>
            a.id === parkingDrag.areaId
              ? { ...a, pointsLocal: parkingDrag.startPoints.map((q) => ({ x: q.x + snapDx, y: q.y + snapDy })) }
              : a,
          ),
        });
        return;
      }
      if (parkingDrag.kind === "pathVertex") {
        const lp = snapWorldToMmLocal(rawWp);
        onChange({
          parkingAreas: areas.map((a) => {
            if (a.id !== parkingDrag.areaId) return a;
            return {
              ...a,
              paths: (a.paths ?? []).map((p) =>
                p.id === parkingDrag.pathId
                  ? { ...p, pointsLocal: p.pointsLocal.map((q, k) => k === parkingDrag.idx ? lp : q) }
                  : p,
              ),
            };
          }),
        });
        return;
      }
    }

    // Hover untuk live-preview segment terakhir saat pathDraw
    if (tool === "parking" && parkingSubTool === "pathDraw" && parkingPathDraft) {
      setParkingPathHover(snapWorldToMmLocal(getWorldPosRaw(e)));
    } else if (parkingPathHover) {
      setParkingPathHover(null);
    }


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

    if (mirrorDraft && tool === "mirror") {
      const raw = getWorldPosRaw(e);
      const ang = snapMirrorAngle(mirrorDraft.origin, raw);
      setMirrorDraft({ ...mirrorDraft, cur: raw, angleDeg: ang });
      return;
    }

    if (moveDrag) {
      const raw = getWorldPosRaw(e);
      const rawDx = raw.x - moveDrag.startWorld.x;
      const rawDy = raw.y - moveDrag.startWorld.y;
      const moved = moveDrag.moved || Math.hypot(rawDx, rawDy) * view.s > 4;
      const { dx, dy } = snapDeltaMm(rawDx, rawDy);
      if (moved && (dx !== moveDrag.appliedDx || dy !== moveDrag.appliedDy)) {
        const patch = buildTranslatedPatch(moveDrag.snapshot, moveSel, dx, dy);
        onChange(patch);
        setMoveDrag({ ...moveDrag, moved: true, appliedDx: dx, appliedDy: dy });
      } else if (moved !== moveDrag.moved) {
        setMoveDrag({ ...moveDrag, moved: true });
      }
      return;
    }
    if (moveMarquee) {
      const raw = getWorldPosRaw(e);
      setMoveMarquee({ ...moveMarquee, cur: raw });
      return;
    }
    if (editVertexMarquee) {
      const raw = getWorldPosRaw(e);
      setEditVertexMarquee({ ...editVertexMarquee, cur: raw });
      return;
    }
    if (floorVertexMarquee) {
      const raw = getWorldPosRaw(e);
      setFloorVertexMarquee({ ...floorVertexMarquee, cur: raw });
      return;
    }



    if (gridDrag) {
      const rawWorld = getWorldPosRaw(e);
      if (gridDrag.kind === "move") {
        // Move: pakai world delta. Snap origin ke mm grid hanya bila kedua grid paralel.
        const dx = rawWorld.x - gridDrag.startWorld.x;
        const dy = rawWorld.y - gridDrag.startWorld.y;
        const cand = { x: gridDrag.startOrigin.x + dx, y: gridDrag.startOrigin.y + dy };
        const next = gridsParallel
          ? (() => {
              // Snap dalam frame mm grid (rotasi mmGridRotRad di sekitar 0,0)
              const local = rotateAround(cand, { x: 0, y: 0 }, -mmGridRotRad);
              const snapLocal = { x: Math.round(local.x / MINOR_PX) * MINOR_PX, y: Math.round(local.y / MINOR_PX) * MINOR_PX };
              return rotateAround(snapLocal, { x: 0, y: 0 }, mmGridRotRad);
            })()
          : cand;
        if (next.x !== grid.origin.x || next.y !== grid.origin.y) updateGrid({ origin: next });
      } else {
        // Corner: delta dihitung di frame lokal grid (rotasi struct).
        const rawLocal = structGridRotRad !== 0
          ? rotateAround(rawWorld, gridDrag.startOrigin, -structGridRotRad)
          : rawWorld;
        const dxm = (rawLocal.x - gridDrag.startWorld.x) / pxPerMeter;
        const dym = (rawLocal.y - gridDrag.startWorld.y) / pxPerMeter;
        const extX = gridDrag.corner === "tr" || gridDrag.corner === "br" ? 1 : -1;
        const extY = gridDrag.corner === "bl" || gridDrag.corner === "br" ? 1 : -1;
        const addX = Math.round((dxm * extX) / gridDrag.unit);
        const addY = Math.round((dym * extY) / gridDrag.unit);
        const newSpansX = adjustSpans(gridDrag.startSpansX, addX, gridDrag.unit, extX < 0);
        const newSpansY = adjustSpans(gridDrag.startSpansY, addY, gridDrag.unit, extY < 0);
        const actualAddX = newSpansX.length - gridDrag.startSpansX.length;
        const actualAddY = newSpansY.length - gridDrag.startSpansY.length;
        // Pergeseran origin saat extend ke arah negatif: vektor sumbu lokal × jarak,
        // dirotasi ke world.
        const dxLocal = extX < 0 ? -actualAddX * gridDrag.unit * pxPerMeter : 0;
        const dyLocal = extY < 0 ? -actualAddY * gridDrag.unit * pxPerMeter : 0;
        const cs = Math.cos(structGridRotRad), sn = Math.sin(structGridRotRad);
        const newOriginX = gridDrag.startOrigin.x + dxLocal * cs - dyLocal * sn;
        const newOriginY = gridDrag.startOrigin.y + dxLocal * sn + dyLocal * cs;
        updateGrid({ spansX: newSpansX, spansY: newSpansY, origin: { x: newOriginX, y: newOriginY } });
      }
      return;
    }

    if (clipDrag && clipDrag.idx >= 0) {
      const rawWorld = getWorldPosRaw(e);
      const raw = structGridRotRad !== 0
        ? rotateAround(rawWorld, grid.origin, -structGridRotRad)
        : rawWorld;
      const ppm = pxPerMeter;
      const mx = (raw.x - grid.origin.x) / ppm;
      const my = (raw.y - grid.origin.y) / ppm;
      const sp = getScreenPos(e);
      const moved = Math.hypot(sp.x - clipDrag.startScreen.x, sp.y - clipDrag.startScreen.y) > 4;
      if (clipDrag.clipId === "__draft__") {
        if (clipDraft) {
          const next = clipDraft.pts.slice();
          next[clipDrag.idx] = { x: mx, y: my };
          setClipDraft({ pts: next });
        }
      } else {
        const clips = (grid.columnClips ?? []).map((c) => {
          if (c.id !== clipDrag.clipId) return c;
          const pts = c.pts.slice();
          pts[clipDrag.idx] = { x: mx, y: my };
          return { ...c, pts };
        });
        updateGrid({ columnClips: clips });
      }

      if (moved && !clipDrag.moved) setClipDrag({ ...clipDrag, moved: true });
      return;
    }

    if (doorDraft) {
      // Step 2 (arah/lebar) & Step 3 (swing) — dihitung kontinu selama drag.
      const raw = getWorldPosRaw(e);
      const ox = raw.x - doorDraft.a.x;
      const oy = raw.y - doorDraft.a.y;
      const along = ox * doorDraft.dirX + oy * doorDraft.dirY;
      const perp = ox * (-doorDraft.dirY) + oy * doorDraft.dirX;
      const signAlong = along < 0 ? -1 : 1;
      const widthPx = (doorWidthCm / 100) * pxPerMeter;
      const bx = doorDraft.a.x + doorDraft.dirX * signAlong * widthPx;
      const by = doorDraft.a.y + doorDraft.dirY * signAlong * widthPx;
      // Sign perp tetap pakai default jika user belum bergerak tegak lurus signifikan.
      const perpThresh = 4 / view.s;
      let nx = doorDraft.nx, ny = doorDraft.ny;
      if (Math.abs(perp) > perpThresh) {
        const signPerp = perp < 0 ? -1 : 1;
        nx = -doorDraft.dirY * signPerp;
        ny = doorDraft.dirX * signPerp;
      }
      setDoorDraft({ ...doorDraft, b: { x: bx, y: by }, nx, ny });
      return;
    }

    if (editDrag) {
      const newPos = getWorldPos(e);
      moveVertexTarget(editDrag.target, editDrag.coord, newPos);
      setEditDrag({ key: keyOf(newPos), coord: newPos, target: editDrag.target });
      setSelectedEditVertices((prev) => prev.map((p) => (keyOf(p.coord) === keyOf(editDrag.coord) ? { target: editDrag.target, coord: newPos } : p)));
      setEditHover(newPos);
      setEditHover(newPos);
      return;
    }

    if (floorVertexDrag) {
      const newPos = getWorldPos(e);
      const fd = floorVertexDrag;
      const nextFloors = (sketch.floors ?? []).map((fl) => {
        if (fl.id !== fd.fid) return fl;
        if (fd.ring === "outer") {
          const next = fl.outer.slice();
          if (fd.idx < next.length) next[fd.idx] = newPos;
          return { ...fl, outer: next };
        }
        const holes = (fl.holes ?? []).map((h, hi) => {
          if (hi !== fd.ring) return h;
          const nh = h.slice();
          if (fd.idx < nh.length) nh[fd.idx] = newPos;
          return nh;
        });
        return { ...fl, holes };
      });
      onChange({ floors: nextFloors });
      setSelectedFloorEditVertices((prev) => prev.map((p) => (p.fid === fd.fid && p.ring === fd.ring && p.idx === fd.idx ? { ...p, coord: newPos } : p)));
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
    if (circleDraft && tool === "circle") setCircleDraft({ ...circleDraft, cur: p });
    if (aksisDraft && tool === "aksis" && aksisSub === "tangent") setAksisDraft({ ...aksisDraft, cursor: p });
    if (jalanDraft && tool === "jalan" && jalanSub === "tangent") setJalanDraft({ ...jalanDraft, cursor: p });
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
    if (sectionEndpointDrag) {
      setSectionEndpointDrag(null);
      endPointer(e);
      return;
    }
    if (roadVertexDrag) {
      setRoadVertexDrag(null);
      endPointer(e);
      return;
    }
    if (rampVertexDrag) {
      setRampVertexDrag(null);
      endPointer(e);
      return;
    }
    if (parkingDrag) {
      setParkingDrag(null);
      // pointer release: tidak perlu commit lain — onChange sudah update.
      const wasGesture = !!gestureRef.current;
      endPointer(e);
      if (wasGesture) return;
      return;
    }
    const wasGesture = !!gestureRef.current;
    endPointer(e);
    if (wasGesture) return;

    if (mirrorDraft && tool === "mirror") {
      const draft = mirrorDraft;
      setMirrorDraft(null);
      const dragPx = Math.hypot(draft.cur.x - draft.origin.x, draft.cur.y - draft.origin.y) * view.s;
      if (dragPx < 6) {
        toast.error("Tarik untuk menentukan arah sumbu mirror");
        return;
      }
      applyMirrorCommit(draft);
      return;
    }

    if (moveDrag) {
      const md = moveDrag;
      setMoveDrag(null);
      if (!md.moved) {
        // Klik tanpa drag → toggle / pertahankan selection.
        if (md.hitKey) {
          if (md.shiftKey && md.hitWasSelected) {
            // Shift+klik pada item yg sudah terpilih → lepaskan.
            const next = new Set(moveSel);
            next.delete(md.hitKey);
            setMoveSel(next);
          } else if (!md.shiftKey && md.hitWasSelected && md.prevSel.size > 1) {
            // Klik (tanpa shift) pada item yg sudah terpilih dalam multi-select
            // tanpa menggeser → fokuskan hanya ke item itu.
            setMoveSel(new Set([md.hitKey]));
          }
          // Selain itu: selection sudah benar (saat down).
        }
      }
      // Drag yang sudah moved → state sudah ter-commit via onChange. Selesai.
      return;
    }
    if (moveMarquee) {
      const mm = moveMarquee;
      setMoveMarquee(null);
      const moved = Math.hypot(mm.cur.x - mm.start.x, mm.cur.y - mm.start.y) * view.s > 4;
      if (!moved) {
        // Klik kosong → kosongkan selection (kecuali shift).
        if (!mm.additive) setMoveSel(new Set());
        return;
      }
      const x0 = Math.min(mm.start.x, mm.cur.x);
      const x1 = Math.max(mm.start.x, mm.cur.x);
      const y0 = Math.min(mm.start.y, mm.cur.y);
      const y1 = Math.max(mm.start.y, mm.cur.y);
      const inRect = (p: Point) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      const lvl = activeLvlId;
      const inLvl = (l?: string) => !lvl || !l || l === lvl;
      const next = new Set(mm.additive ? moveSel : []);
      lines.forEach((ln, i) => {
        if (!inLvl(ln.levelId)) return;
        if ((ln.kind ?? "straight") !== "straight") return;
        if (inRect(ln.a) && inRect(ln.b)) next.add(`line:${i}`);
      });
      layers.forEach((ly) => {
        if (!inLvl(ly.levelId)) return;
        if (ly.points.length < 2) return;
        if (ly.points.every(inRect)) next.add(`layer:${ly.id}`);
      });
      (sketch.circles ?? []).forEach((c) => {
        if (!inLvl(c.levelId)) return;
        if (c.c.x - c.r >= x0 && c.c.x + c.r <= x1 && c.c.y - c.r >= y0 && c.c.y + c.r <= y1) {
          next.add(`circle:${c.id}`);
        }
      });
      (sketch.doors ?? []).forEach((d) => {
        if (!inLvl(d.levelId)) return;
        if (inRect(d.a) && inRect(d.b)) next.add(`door:${d.id}`);
      });
      (sketch.floors ?? []).forEach((f) => {
        if (!inLvl(f.levelId)) return;
        if (f.outer.length < 2) return;
        if (f.outer.every(inRect)) next.add(`floor:${f.id}`);
      });
      (sketch.sectionCuts ?? []).forEach((c, i) => {
        if (inRect(c.p1) && inRect(c.p2)) next.add(`section:${i}`);
      });
      setMoveSel(next);
      return;
    }



    if (gridDrag) {
      setGridDrag(null);
      return;
    }
    if (clipDrag) {
      const cd = clipDrag;
      setClipDrag(null);
      // Tap statis (tidak digeser) di area kosong → tambah titik ke draft
      if (cd.clipId === "__add__" && !cd.moved) {
        const rawWorld = getWorldPosRaw(e);
        const raw = structGridRotRad !== 0
          ? rotateAround(rawWorld, grid.origin, -structGridRotRad)
          : rawWorld;
        const mx = (raw.x - grid.origin.x) / pxPerMeter;
        const my = (raw.y - grid.origin.y) / pxPerMeter;
        const draft = clipDraft ?? { pts: [] };
        setClipDraft({ pts: [...draft.pts, { x: mx, y: my }] });
      }
      return;
    }
    if (draggingHandle) {
      setDraggingHandle(null);
      return;
    }
    if (doorDraft) {
      const d = doorDraft;
      setDoorDraft(null);
      // Tap tanpa drag tetap commit (default sign +). Spec: rekam pelepasan sentuhan.
      pushHistory();
      const door: Door = {
        id: genDoorId(),
        levelId: d.levelId,
        a: d.a,
        b: d.b,
        nx: d.nx,
        ny: d.ny,
        leaves: doorLeaves,
        widthCm: doorWidthCm,
      };
      const prev = sketch.doors ?? [];
      onChange({ doors: [...prev, door] });
      toast.success(`Pintu ${doorLeaves === 2 ? "2 daun" : "1 daun"} · ${doorWidthCm}cm ditambahkan`);
      return;
    }
    if (circleDraft && tool === "circle") {
      const r = Math.hypot(circleDraft.cur.x - circleDraft.c.x, circleDraft.cur.y - circleDraft.c.y);
      const c0 = circleDraft.c;
      const lvlId = circleDraft.levelId;
      setCircleDraft(null);
      if (r < 4) return;
      pushHistory();
      const newCir: Circle = {
        id: `CIR${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        c: c0, r, levelId: lvlId ?? activeLvlId ?? undefined,
      };
      onChange({ circles: [...(sketch.circles ?? []), newCir] });
      toast.success(`Lingkaran R ${(r / pxPerMeter).toFixed(2)} m`);
      return;
    }
    if (editDrag) {
      setEditDrag(null);
      return;
    }
    if (floorVertexDrag) {
      setFloorVertexDrag(null);
      return;
    }
    if (editVertexMarquee) {
      const mm = editVertexMarquee;
      setEditVertexMarquee(null);
      const moved = Math.hypot(mm.cur.x - mm.start.x, mm.cur.y - mm.start.y) * view.s > 4;
      if (!moved) {
        if (!mm.additive) setSelectedEditVertices([]);
        return;
      }
      const x0 = Math.min(mm.start.x, mm.cur.x);
      const x1 = Math.max(mm.start.x, mm.cur.x);
      const y0 = Math.min(mm.start.y, mm.cur.y);
      const y1 = Math.max(mm.start.y, mm.cur.y);
      const inRect = (p: Point) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      const collected: { target: EditTarget; coord: Point }[] = [];
      const seenKeys = new Set<string>();
      const pushSel = (target: EditTarget, coord: Point) => {
        const k = keyOf(coord);
        if (seenKeys.has(k)) return;
        seenKeys.add(k);
        collected.push({ target, coord });
      };
      layers.forEach((l) => {
        if (activeLvlId && l.levelId !== activeLvlId) return;
        l.points.forEach((pt, i) => {
          if (inRect(pt)) pushSel({ kind: "layer", layerId: l.id, idx: i }, pt);
        });
      });
      lines.forEach((ln, i) => {
        if (activeLvlId && ln.levelId !== activeLvlId) return;
        if (inRect(ln.a)) pushSel({ kind: "line", lineIdx: i, end: "a" }, ln.a);
        if (inRect(ln.b)) pushSel({ kind: "line", lineIdx: i, end: "b" }, ln.b);
      });
      setSelectedEditVertices((prev) => {
        if (!mm.additive) return collected;
        const merged = [...prev];
        const exist = new Set(prev.map((p) => keyOf(p.coord)));
        for (const s of collected) {
          const k = keyOf(s.coord);
          if (!exist.has(k)) { exist.add(k); merged.push(s); }
        }
        return merged;
      });
      if (collected.length > 0) toast.success(`${collected.length} titik dipilih`);
      return;
    }
    if (floorVertexMarquee) {
      const mm = floorVertexMarquee;
      setFloorVertexMarquee(null);
      const moved = Math.hypot(mm.cur.x - mm.start.x, mm.cur.y - mm.start.y) * view.s > 4;
      if (!moved) {
        if (!mm.additive) setSelectedFloorEditVertices([]);
        return;
      }
      const x0 = Math.min(mm.start.x, mm.cur.x);
      const x1 = Math.max(mm.start.x, mm.cur.x);
      const y0 = Math.min(mm.start.y, mm.cur.y);
      const y1 = Math.max(mm.start.y, mm.cur.y);
      const inRect = (p: Point) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      const flList = (sketch.floors ?? []).filter(
        (f) => !activeLvlId || f.levelId === activeLvlId,
      );
      const collected: FloorVertexSel[] = [];
      const keyEq = (a: FloorVertexSel, b: FloorVertexSel) =>
        a.fid === b.fid && a.ring === b.ring && a.idx === b.idx;
      for (const fl of flList) {
        fl.outer.forEach((v, i) => {
          if (inRect(v)) collected.push({ fid: fl.id, ring: "outer", idx: i, coord: { x: v.x, y: v.y } });
        });
        (fl.holes ?? []).forEach((h, hi) => {
          h.forEach((v, i) => {
            if (inRect(v)) collected.push({ fid: fl.id, ring: hi, idx: i, coord: { x: v.x, y: v.y } });
          });
        });
      }
      setSelectedFloorEditVertices((prev) => {
        if (!mm.additive) return collected;
        const merged = [...prev];
        for (const s of collected) {
          if (!merged.some((p) => keyEq(p, s))) merged.push(s);
        }
        return merged;
      });
      if (collected.length > 0) toast.success(`${collected.length} titik lantai dipilih`);
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

    if (tool === "floor" && floorMode === "rect") {
      // Bangun persegi axis-aligned (mengikuti rotasi mm-grid) lalu commit sebagai outer floor.
      const la = rotateAround(a, { x: 0, y: 0 }, -mmGridRotRad);
      const lb = rotateAround(b, { x: 0, y: 0 }, -mmGridRotRad);
      // a/b sudah ter-snap (vertex/midpoint/grid) lewat snapPoint di pointer handler;
      // jangan re-snap ke mm-grid karena akan menghancurkan snap vertex/midpoint.
      const lminX = Math.min(la.x, lb.x);
      const lmaxX = Math.max(la.x, lb.x);
      const lminY = Math.min(la.y, lb.y);
      const lmaxY = Math.max(la.y, lb.y);
      if (lmaxX - lminX < MINOR_PX * 0.5 || lmaxY - lminY < MINOR_PX * 0.5) return;
      const p1 = rotateAround({ x: lminX, y: lminY }, { x: 0, y: 0 }, mmGridRotRad);
      const p2 = rotateAround({ x: lmaxX, y: lminY }, { x: 0, y: 0 }, mmGridRotRad);
      const p3 = rotateAround({ x: lmaxX, y: lmaxY }, { x: 0, y: 0 }, mmGridRotRad);
      const p4 = rotateAround({ x: lminX, y: lmaxY }, { x: 0, y: 0 }, mmGridRotRad);
      const rectPts = [p1, p2, p3, p4];
      // Stage rect sebagai draft (belum permanen). User menekan "Simpan Area" untuk commit.
      // Aturan:
      //  - Jika draft sudah punya outer & rect baru ada di dalam outer → push ke holes draft.
      //  - Jika belum ada draft, dan rect ada di dalam floor existing pada level aktif →
      //    seed draft dari floor itu + tambah rect sebagai hole; replaceFloorId di-set.
      //  - Selain itu, set rect baru sebagai outer draft.
      const existing = sketch.floors ?? [];
      const cur = floorDraft;
      if (cur && cur.outer && rectPts.every((c) => floorPointInPolygon(c, cur.outer!))) {
        setFloorDraft({ ...cur, holes: [...cur.holes, rectPts] });
        toast.success(`Void #${cur.holes.length + 1} ditambahkan ke draft`);
        return;
      }
      if (!cur || !cur.outer) {
        const hostIdx = existing.findIndex((fl) =>
          fl.levelId === activeLvlId &&
          rectPts.every((c) => floorPointInPolygon(c, fl.outer)) &&
          !(fl.holes ?? []).some((h) => rectPts.every((c) => floorPointInPolygon(c, h))),
        );
        if (hostIdx >= 0) {
          const host = existing[hostIdx];
          setFloorDraft({
            outer: host.outer.slice(),
            holes: [...(host.holes ?? []).map((h) => h.slice()), rectPts],
            levelId: activeLvlId,
            replaceFloorId: host.id,
          });
          toast.success("Void disiapkan — tekan Simpan Area");
          return;
        }
      }
      setFloorDraft({ outer: rectPts, holes: [], levelId: activeLvlId });
      toast.success("Area disiapkan — tekan Simpan Area atau tambah void");
      return;
    }

    if (curTool === "rect") {
      commitRect(a, b);
      return;
    }

    if (curTool === "parking") {
      // Hanya draw mode yang membuat area baru.
      if (parkingSubTool !== "draw") return;
      // Tarik kotak parkir di KOORDINAT LOKAL mm-grid; saat grid berputar,
      // area otomatis ikut karena disimpan di local-frame.
      const la = snapWorldToMmLocal(a);
      const lb = snapWorldToMmLocal(b);
      const minX = Math.min(la.x, lb.x), maxX = Math.max(la.x, lb.x);
      const minY = Math.min(la.y, lb.y), maxY = Math.max(la.y, lb.y);
      if ((maxX - minX) < pxPerMeter * 5 || (maxY - minY) < pxPerMeter * 5) {
        if (parkingKind === "motor") {
          if ((maxX - minX) < pxPerMeter * 2 || (maxY - minY) < pxPerMeter * 2) {
            toast.error("Area parkir motor terlalu kecil (min 2 m × 2 m)");
            return;
          }
        } else {
          toast.error("Area parkir terlalu kecil (min 5 m × 5 m)");
          return;
        }
      }
      const pointsLocal = [
        { x: minX, y: minY }, { x: maxX, y: minY },
        { x: maxX, y: maxY }, { x: minX, y: maxY },
      ];
      // Simpan sebagai DRAFT — belum masuk sketch sampai user tekan "Simpan Area".
      const draft: ParkingArea = {
        id: genParkingId(),
        levelId: activeLvlId ?? undefined,
        kind: parkingKind,
        pointsLocal,
        orientation: "auto",
        stallRotation: 0,
      };
      setParkingDraft(draft);
      toast.success(`Draft area parkir ${parkingKind} — tekan Simpan Area untuk mengunci`);
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

    if (curTool === "aksis" && aksisSub === "garis") {
      const ax: AxisSegment = {
        id: newAxisId(), kind: "garis",
        points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
        bufferM: aksisBufferM, createdAt: Date.now(),
      };
      onChange({ axes: [...(sketch.axes ?? []), ax] });
      toast.success("Aksis tersimpan");
      return;
    }

    if (curTool === "jalan" && jalanSub === "garis") {
      const rd: RoadSegment = {
        id: newRoadId(), kind: "garis",
        points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
        widthM: jalanWidthM, filletM: jalanFilletM, createdAt: Date.now(),
      };
      onChange({ roads: [...(sketch.roads ?? []), rd] });
      toast.success(`Jalan tersimpan (${jalanWidthM.toFixed(1)} m)`);
      return;
    }


    if (curTool === "separasi") {
      // Separasi Ruang: belah salah satu polygon ruang aktif menjadi dua
      // dengan garis tak-hingga melalui (a, b). Hanya berlaku pada ruang yang
      // benar-benar terbelah (2 titik perpotongan dengan perimeter).
      const cand = layers.filter(
        (l) =>
          (l.levelId ?? activeLvlId) === activeLvlId &&
          !l.locked &&
          l.points.length >= 3 &&
          !isLahanLayerName(l.name) &&
          !isVoidLayerName(l.name),
      );
      let best: { layer: Layer; res: NonNullable<ReturnType<typeof splitPolygonByInfiniteLine>>; la: number; ra: number } | null = null;
      let bestScore = -Infinity;
      for (const ly of cand) {
        // Hanya belah ruang yang benar-benar dilalui stylus:
        // kedua ujung garis (a, b) harus berada di LUAR polygon ruang,
        // sehingga garis masuk dari satu tepi dan keluar di tepi seberang.
        if (pointInPolygon(a, ly.points) || pointInPolygon(b, ly.points)) continue;
        const r = splitPolygonByInfiniteLine(ly.points, a, b);
        if (!r) continue;
        const la = polygonAreaPx(r.left);
        const ra = polygonAreaPx(r.right);
        if (la < 25 || ra < 25) continue;
        // Pastikan kedua titik perpotongan berada di antara a dan b
        // (stylus benar-benar melewati ruang, bukan hanya garis perpanjangannya).
        const dx = b.x - a.x, dy = b.y - a.y;
        const segLen2 = dx * dx + dy * dy;
        if (segLen2 < 1) continue;
        const tOf = (p: Point) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / segLen2;
        const tA = tOf(r.iA), tB = tOf(r.iB);
        const eps = 1e-3;
        if (tA < -eps || tA > 1 + eps || tB < -eps || tB > 1 + eps) continue;
        // Pilih ruang terkecil yang berhasil dibelah (paling spesifik).
        const totalArea = la + ra;
        const score = -totalArea;
        if (score > bestScore) {
          bestScore = score;
          best = { layer: ly, res: r, la, ra };
        }
      }
      if (!best) {
        toast.error("Tarik garis menembus ruang dari satu tepi ke tepi seberang");
        return;
      }
      const { layer, res, la, ra } = best;
      const leftAreaM2 = la / (pxPerMeter * pxPerMeter);
      const rightAreaM2 = ra / (pxPerMeter * pxPerMeter);
      const now = Date.now();
      const baseName = layer.name;
      const lyA: Layer = {
        ...layer,
        id: `L${now}_${Math.random().toString(36).slice(2, 6)}a`,
        name: `${baseName} A`,
        points: res.left,
        areaM2: leftAreaM2,
      };
      const lyB: Layer = {
        ...layer,
        id: `L${now}_${Math.random().toString(36).slice(2, 6)}b`,
        name: `${baseName} B`,
        points: res.right,
        areaM2: rightAreaM2,
      };
      const dividerLine: Line = {
        a: res.iA,
        b: res.iB,
        kind: "straight",
        levelId: layer.levelId ?? activeLvlId ?? undefined,
      };
      pushHistory();
      onChange({
        layers: layers.flatMap((l) => (l.id === layer.id ? [lyA, lyB] : [l])),
        lines: [...lines, dividerLine],
      });
      toast.success(
        `${baseName} dibelah · ${leftAreaM2.toFixed(2)} m² + ${rightAreaM2.toFixed(2)} m²`,
      );
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
    setGridDrag(null);
    setClipDrag(null);
    setDoorDraft(null);
    setCircleDraft(null);
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
    const bound = bindLahanLayersToMdplZero(levels, nextLayers);
    onChange({ levels: bound.levels, layers: bound.layers });
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
  // Luas Lahan = HANYA layer bernama "Lahan" di Level 1 (MDPL 0). Tidak boleh ditambah luas lain.
  const sortedLvForLahan = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const groundLevelForLahan = findMdplZeroLevel(sortedLvForLahan) ?? sortedLvForLahan[0];
  const lahanLayers = layers.filter(
    (l) => isLahanName(l.name) && groundLevelForLahan && l.levelId === groundLevelForLahan.id,
  );
  const totalLahanM2 = lahanLayers.reduce((s, l) => s + l.areaM2, 0);

  // Rekapitulasi panel (rendered below canvas in normal mode, inside SidePanel in fullscreen)
  const RekapPanel = (() => {
    const sortedLv = [...levels].sort((a, b) => a.mdpl - b.mdpl);
    const groundLevel = findMdplZeroLevel(sortedLv) ?? sortedLv[0];
    const groundIdx = groundLevel ? sortedLv.findIndex((l) => l.id === groundLevel.id) : -1;
    const b1Level = groundIdx > 0 ? sortedLv[groundIdx - 1] : undefined;
    const isTaman = (n: string) => isTamanLayerName(n);
    const ruangLayers = layers.filter(
      (l) => !isLahanName(l.name) && !isVoidLayerName(l.name) && !isTaman(l.name),
    );
    const tamanLayers = layers.filter(
      (l) => isTaman(l.name) && groundLevel && l.levelId === groundLevel.id,
    );
    const kdbRencana = groundLevel
      ? ruangLayers.filter((l) => l.levelId === groundLevel.id).reduce((s, l) => s + l.areaM2, 0)
      : 0;
    const klbRencana = ruangLayers.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);
    const kdhRencana = tamanLayers.reduce((s, l) => s + l.areaM2, 0);
    const ktbRencana = b1Level
      ? layers
          .filter((l) => l.levelId === b1Level.id && !isLahanName(l.name) && !isVoidLayerName(l.name) && !isTaman(l.name))
          .reduce((s, l) => s + l.areaM2, 0)
      : 0;
    const kdbLimit = (kdbPct ?? 0) > 0 && totalLahanM2 > 0 ? (kdbPct! / 100) * totalLahanM2 : 0;
    const klbLimit = (klbCoef ?? 0) > 0 && totalLahanM2 > 0 ? klbCoef! * totalLahanM2 : 0;
    const kdhLimit = (kdhPct ?? 0) > 0 && totalLahanM2 > 0 ? (kdhPct! / 100) * totalLahanM2 : 0;
    const ktbLimit = (ktbPct ?? 0) > 0 && totalLahanM2 > 0 ? (ktbPct! / 100) * totalLahanM2 : 0;
    const kdbDev = kdbRencana - kdbLimit;
    const klbDev = klbRencana - klbLimit;
    // For KDH (green): being under the minimum is "bad" (deficit), being over is good.
    const kdhDev = kdhRencana - kdhLimit;
    const ktbDev = ktbRencana - ktbLimit;
    const fmt = (v: number) => v.toFixed(2);
    const pct = (num: number) => (totalLahanM2 > 0 ? (num / totalLahanM2) * 100 : 0);
    const devNode = (dev: number, hasLimit: boolean, invert = false) => {
      if (!hasLimit) return <span className="text-muted-foreground">—</span>;
      const over = dev > 0.005;
      const under = dev < -0.005;
      // For "invert" (KDH), over = green (good), under = red (deficit).
      const badIsOver = !invert;
      const color = over
        ? badIsOver ? "text-red-500" : "text-green-500"
        : under
          ? badIsOver ? "text-green-500" : "text-red-500"
          : "text-muted-foreground";
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
              Acuan KDB/KLB/KDH/KTB. "Taman" di Level 1 dihitung sebagai KDH dan tidak ikut KDB/KLB.
            </p>
          </div>

          {/* KDB */}
          <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">KDB</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
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
              <span className="text-[11px] text-muted-foreground">
                KDB Rencana ({pct(kdbRencana).toFixed(1)}%)
              </span>
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
                  type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
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

          {/* KDH */}
          <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">KDH</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
                  min={0}
                  max={100}
                  step={1}
                  placeholder="0"
                  value={kdhPct ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange({ kdhPct: v === "" ? undefined : Math.max(0, Math.min(100, Number(v))) });
                  }}
                  className="h-7 w-16 text-right text-xs"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-muted-foreground">Minimum (KDH × Lahan)</span>
              <span className="font-display text-sm font-semibold">
                {kdhLimit > 0 ? fmt(kdhLimit) : "—"}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-muted-foreground">
                KDH Rencana ({pct(kdhRencana).toFixed(1)}%)
              </span>
              <span className="font-display text-sm font-semibold text-green-500">
                {kdhRencana > 0 ? fmt(kdhRencana) : "—"}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-border/40 pt-1.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Deviasi</span>
              {devNode(kdhDev, kdhLimit > 0, true)}
            </div>
          </div>

          {/* KTB */}
          <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">KTB</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
                  min={0}
                  max={100}
                  step={1}
                  placeholder="0"
                  value={ktbPct ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange({ ktbPct: v === "" ? undefined : Math.max(0, Math.min(100, Number(v))) });
                  }}
                  className="h-7 w-16 text-right text-xs"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-muted-foreground">Maksimum (KTB × Lahan)</span>
              <span className="font-display text-sm font-semibold">
                {ktbLimit > 0 ? fmt(ktbLimit) : "—"}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-muted-foreground">
                KTB Rencana ({pct(ktbRencana).toFixed(1)}% · {b1Level ? "LT B1" : "—"})
              </span>
              <span className="font-display text-sm font-semibold">
                {ktbRencana > 0 ? fmt(ktbRencana) : "—"}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-border/40 pt-1.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Deviasi</span>
              {devNode(ktbDev, ktbLimit > 0)}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <GeoPanel geo={sketch.geo} onChange={(g) => onChange({ geo: g })} />
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
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ekspor CAD</Label>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            try {
              const activeLayers = layers.filter((l) => !activeLvlId || l.levelId === activeLvlId);
              const activeLines = lines.filter((l) => !activeLvlId || l.levelId === activeLvlId);
              const activeDoors = (sketch.doors ?? []).filter((d) => !activeLvlId || d.levelId === activeLvlId);
              const activeAreas = (sketch.parkingAreas ?? []).filter((a) => !activeLvlId || a.levelId === activeLvlId);
              const dxf = buildDxf({
                pxPerMeter,
                wallThicknessM: 0.15,
                lines: activeLines,
                layers: activeLayers.map((l) => ({ name: l.name, points: l.points })),
                doors: activeDoors,
                parkingStallsByArea: parkingStallsActive,
                parkingAreas: activeAreas,
                mmGridRotRad,
              });
              const safe = (sketch.title || "Konsep_Denah").replace(/[^\w\-]+/g, "_");
              downloadDxf(`${safe}.dxf`, dxf);
              toast.success("DXF terunduh — buka di AutoCAD/CAD favoritmu");
            } catch (err) {
              console.error(err);
              toast.error("Gagal mengekspor DXF");
            }
          }}
          title="Unduh denah aktif sebagai file .dxf (skala asli 1:1, satuan meter)"
        >
          <Download className="mr-1.5 h-4 w-4" /> Download as CAD (DXF)
        </Button>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Skala asli 1:1 dalam meter. Dinding diekspor sebagai 2 garis sejajar (tebal 150 mm), pintu sebagai ARC + LINE, lot parkir sebagai POLYLINE tertutup.
        </p>
      </div>




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
            <SelectItem value="1:1200">1 : 1200 (1 kotak besar = 12 m)</SelectItem>
            <SelectItem value="1:1500">1 : 1500 (1 kotak besar = 15 m)</SelectItem>
            <SelectItem value="1:2000">1 : 2000 (1 kotak besar = 20 m)</SelectItem>
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
                type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
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
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Rotasi Grid</Label>
        <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2.5">
          {/* Grid milimeter block (display-only) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Milimeter Block</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {mmGridRotation.toFixed(1)}°
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
                step="1"
                value={Number.isFinite(mmGridRotation) ? mmGridRotation : 0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  onChange({ mmGridRotation: Number.isFinite(v) ? v : 0 });
                }}
                className="h-7 text-xs"
              />
              <Button
                variant="outline" size="sm" className="h-7 px-2 text-[10px]"
                onClick={() => onChange({ mmGridRotation: 0 })}
                disabled={mmGridRotation === 0}
                title="Kembalikan ke 0° tanpa memindahkan sketsa"
              >
                Reset
              </Button>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Memutar tampilan kertas milimeter block saja. Tidak mengubah koordinat sketsa, dapat dikembalikan ke 0° tanpa pergeseran.
            </p>
          </div>

          {/* Grid struktur (per grid aktif) */}
          <div className="space-y-1 border-t border-border/40 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Grid Struktur {editGridIdx === 0 ? "(Primer)" : `(Extra ${editGridIdx})`}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {structGridRotation.toFixed(1)}°
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
                step="1"
                value={Number.isFinite(structGridRotation) ? structGridRotation : 0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  updateGrid({ rotation: Number.isFinite(v) ? v : 0 });
                }}
                className="h-7 text-xs"
              />
              <Button
                variant="outline" size="sm" className="h-7 px-2 text-[10px]"
                onClick={() => updateGrid({ rotation: 0 })}
                disabled={structGridRotation === 0}
                title="Kembalikan rotasi grid struktur ke 0°"
              >
                Reset
              </Button>
              <Button
                variant="outline" size="sm" className="h-7 px-2 text-[10px]"
                onClick={() => updateGrid({ rotation: mmGridRotation })}
                disabled={structGridRotation === mmGridRotation}
                title="Samakan dengan rotasi milimeter block agar paralel"
              >
                = mm
              </Button>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              {gridsParallel
                ? "Paralel dengan milimeter block → snap to grid aktif saat menggeser titik nol grid struktur."
                : "Tidak paralel dengan milimeter block → snap to grid dimatikan untuk menggeser grid struktur."}
            </p>
          </div>
        </div>
      </div>





      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Alat</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={tool === "line" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("line"); }}
            className={cn(tool === "line" && "bg-gradient-primary shadow-primary")}
          >
            <Pencil className="mr-1.5 h-4 w-4" /> Garis
          </Button>
          <Button
            variant={tool === "rect" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("rect"); }}
            className={cn(tool === "rect" && "bg-gradient-primary shadow-primary")}
          >
            <Square className="mr-1.5 h-4 w-4" /> Persegi
          </Button>
          <Button
            variant={tool === "polyline" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setPolyDraft(null); setTool("polyline"); }}
            className={cn(tool === "polyline" && "bg-gradient-primary shadow-primary")}
          >
            <Waypoints className="mr-1.5 h-4 w-4" /> Polyline
          </Button>
          <Button
            variant={tool === "edit" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("edit"); }}
            className={cn(tool === "edit" && "bg-gradient-primary shadow-primary")}
          >
            <Move className="mr-1.5 h-4 w-4" /> Edit Titik
          </Button>
          <Button
            variant={tool === "move" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("move"); }}
            className={cn(tool === "move" && "bg-gradient-primary shadow-primary")}
            title="Move — pilih satu/banyak objek lalu drag (snap mm) atau geser numerik ΔX/ΔY mm."
          >
            <GripHorizontal className="mr-1.5 h-4 w-4" /> Move
          </Button>
          <Button
            variant={tool === "mirror" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("mirror"); }}
            className={cn(tool === "mirror" && "bg-gradient-primary shadow-primary")}
            title="Mirror — pilih objek lewat Move, lalu tarik sumbu (snap 0/45/90/135°) untuk menduplikasi cerminan."
          >
            <FlipHorizontal className="mr-1.5 h-4 w-4" /> Mirror
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
            className={cn(tool === "section" && "bg-gradient-primary shadow-primary")}
            title="Tarik satu garis lurus di kanvas untuk menentukan bidang irisan. Slide potongan akan otomatis dibuat."
          >
            <Scissors className="mr-1.5 h-4 w-4" /> Garis Potong
          </Button>
          <Button
            variant={tool === "separasi" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("separasi"); }}
            className={cn(tool === "separasi" && "bg-gradient-primary shadow-primary")}
            title="Separasi Ruang — tarik garis dari satu tepi ruang ke tepi lain; ruang otomatis terbelah dua dengan luas terpisah."
          >
            <SplitSquareHorizontal className="mr-1.5 h-4 w-4" /> Separasi Ruang
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setClusterOpen(true)}
            title="Buka Node Editor (Grasshopper-style) untuk merancang relasi antar ruang, lalu generate cluster polygon otomatis."
          >
            <Waypoints className="mr-1.5 h-4 w-4" /> Cluster Generator
          </Button>
          <Button
            variant={tool === "grid" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("grid"); if (!grid.enabled) updateGrid({ enabled: true }); }}
            className={cn(tool === "grid" && "bg-gradient-primary shadow-primary")}
            title="Modul Struktur — grid as + kolom parametric"
          >
            <Grid3x3 className="mr-1.5 h-4 w-4" /> Grid Struktur
          </Button>
          <Button
            variant={tool === "pick" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("pick"); }}
            className={cn(tool === "pick" && "bg-gradient-primary shadow-primary")}
            title="Pick Material — klik segmen garis untuk menandai jenis selubung (Solid/Curtain/Window). Alt-klik untuk hapus."
          >
            <Paintbrush className="mr-1.5 h-4 w-4" /> Pick Material
          </Button>
          <Button
            variant={tool === "door" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("door"); }}
            className={cn(tool === "door" && "bg-gradient-primary shadow-primary")}
            title="Pintu — tap di dinding (engsel A), geser searah dinding (lebar), lalu tegak lurus untuk arah ayun."
          >
            <DoorOpen className="mr-1.5 h-4 w-4" /> Pintu
          </Button>
          <Button
            variant={tool === "circle" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("circle"); }}
            className={cn(tool === "circle" && "bg-gradient-primary shadow-primary")}
            title="Lingkaran — tap di pusat, geser untuk menentukan radius."
          >
            <CircleIcon className="mr-1.5 h-4 w-4" /> Lingkaran
          </Button>
          <Button
            variant={tool === "trim" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("trim"); }}
            className={cn(tool === "trim" && "bg-gradient-primary shadow-primary")}
            title="Trim / Extend — tap di garis dekat ujung yang ingin disesuaikan, gunakan garis lain sebagai batas."
          >
            <Crop className="mr-1.5 h-4 w-4" /> Trim / Extend
          </Button>
          <Button
            variant={tool === "offset" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("offset"); }}
            className={cn(tool === "offset" && "bg-gradient-primary shadow-primary")}
            title="Offset — tap garis pada sisi yang diinginkan; jarak diatur di bawah."
          >
            <MoveHorizontal className="mr-1.5 h-4 w-4" /> Offset
          </Button>
          <Button
            variant={tool === "floor" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setFloorDraft(null); setTool("floor"); }}
            className={cn(tool === "floor" && "bg-gradient-primary shadow-primary")}
            title="Alat Lantai — slab 150mm di bawah MDPL level aktif (Persegi / Garis / Polyline / Attach Garis)"
          >
            <BoxIcon className="mr-1.5 h-4 w-4" /> Lantai
          </Button>
          <Button
            variant={tool === "parking" && parkingKind === "mobil" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("parking"); setParkingKind("mobil"); setParkingSubTool("draw"); setParkingSelectedId(null); }}
            className={cn(tool === "parking" && parkingKind === "mobil" && "bg-gradient-primary shadow-primary")}
            title="Lot Parkir Mobil — 2.4 × 5 m, aisle 5.5 m, buffer jalur 1.75 m."
          >
            <Car className="mr-1.5 h-4 w-4" /> Mobil
          </Button>
          <Button
            variant={tool === "parking" && parkingKind === "motor" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("parking"); setParkingKind("motor"); setParkingSubTool("draw"); setParkingSelectedId(null); }}
            className={cn(tool === "parking" && parkingKind === "motor" && "bg-gradient-primary shadow-primary")}
            title="Lot Parkir Motor — 0.75 × 2 m, aisle 1.5 m, buffer jalur 0.5 m."
          >
            <Car className="mr-1.5 h-4 w-4" /> Motor
          </Button>
          <Button
            variant={tool === "ramp" ? "default" : "outline"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("ramp"); setRampSub("tarik"); setRampDraft(null); setRampSelectedId(null); }}
            className={cn(tool === "ramp" && "bg-gradient-primary shadow-primary")}
            title="Ramp — polyline acuan + offset; berakhir di level di atas (puncak ramp)."
          >
            <BoxIcon className="mr-1.5 h-4 w-4" /> Ramp
          </Button>
          {mode === "masterplan" && (
            <Button
              variant={tool === "aksis" ? "default" : "outline"}
              size="sm"
              onClick={() => { cancelPendingCurve(); setTool("aksis"); setAksisDraft(null); }}
              className={cn(tool === "aksis" && "bg-gradient-primary shadow-primary")}
              title="Aksis — sumbu rancangan yang dihindari oleh Cluster Generator."
            >
              <Waypoints className="mr-1.5 h-4 w-4" /> Aksis
            </Button>
          )}
          {mode === "masterplan" && (
            <Button
              variant={tool === "jalan" ? "default" : "outline"}
              size="sm"
              onClick={() => { cancelPendingCurve(); setTool("jalan"); setJalanDraft(null); }}
              className={cn(tool === "jalan" && "bg-gradient-primary shadow-primary")}
              title="Jalan — koridor dengan lebar & fillet; memandu Cluster Generator."
            >
              <Spline className="mr-1.5 h-4 w-4" /> Jalan
            </Button>
          )}
        </div>
        {tool === "aksis" && mode === "masterplan" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Aksis</span>
            <Button
              size="sm"
              variant={aksisSub === "garis" ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => { setAksisSub("garis"); setAksisDraft(null); }}
            >Garis</Button>
            <Button
              size="sm"
              variant={aksisSub === "tangent" ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => { setAksisSub("tangent"); setAksisDraft(null); }}
            >Tangent</Button>
            <div className="ml-2 flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">Buffer</span>
              <Input
                value={aksisBufferInput}
                onChange={(e) => setAksisBufferInput(e.target.value)}
                className="h-7 w-14 text-[11px]"
              />
              <span className="text-[10px] text-muted-foreground">m</span>
            </div>
            {aksisSub === "tangent" && aksisDraft && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  if (!aksisDraft || aksisDraft.points.length < 2) { setAksisDraft(null); return; }
                  const ax: AxisSegment = {
                    id: newAxisId(), kind: "tangent",
                    points: aksisDraft.points.map((p) => ({ x: p.x, y: p.y })),
                    bufferM: aksisBufferM, createdAt: Date.now(),
                  };
                  onChange({ axes: [...(sketch.axes ?? []), ax] });
                  setAksisDraft(null);
                  toast.success("Aksis tangent tersimpan");
                }}
              >Selesai ({aksisDraft.points.length} titik)</Button>
            )}
            {(sketch.axes ?? []).length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2 text-[11px] text-rose-600 hover:bg-rose-50"
                onClick={() => { onChange({ axes: [] }); toast.success("Semua aksis dihapus"); }}
              >Hapus semua ({(sketch.axes ?? []).length})</Button>
            )}
          </div>
        )}
        {tool === "jalan" && mode === "masterplan" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-zinc-500/40 bg-zinc-500/5 px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-700">Jalan</span>
            <Button
              size="sm"
              variant={jalanSub === "garis" ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => { setJalanSub("garis"); setJalanDraft(null); }}
            >Garis</Button>
            <Button
              size="sm"
              variant={jalanSub === "tangent" ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => { setJalanSub("tangent"); setJalanDraft(null); }}
            >Tangent</Button>
            <Button
              size="sm"
              variant={jalanSub === "fillet" ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => { setJalanSub("fillet"); setJalanDraft(null); }}
            >Fillet</Button>
            <Button
              size="sm"
              variant={jalanSub === "hapus" ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => { setJalanSub("hapus"); setJalanDraft(null); }}
              title="Klik di atas sebuah jalan untuk menghapus jalan tersebut"
            >Hapus</Button>
            <div className="ml-2 flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">Lebar</span>
              <Input
                value={jalanWidthInput}
                onChange={(e) => setJalanWidthInput(e.target.value)}
                className="h-7 w-14 text-[11px]"
              />
              <span className="text-[10px] text-muted-foreground">m</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">Fillet</span>
              <Input
                value={jalanFilletInput}
                onChange={(e) => setJalanFilletInput(e.target.value)}
                className="h-7 w-14 text-[11px]"
              />
              <span className="text-[10px] text-muted-foreground">m</span>
            </div>
            <label className="flex items-center gap-1 text-[11px] text-zinc-700 cursor-pointer select-none" title="Tampilkan garis setback putus-putus sejauh ½ lebar jalan dari perimeter (mengikuti fillet pertemuan).">
              <input
                type="checkbox"
                checked={jalanOffsetEnabled}
                onChange={(e) => setJalanOffsetEnabled(e.target.checked)}
                className="h-3.5 w-3.5 accent-rose-600"
              />
              <span>Offset (½ lebar)</span>
            </label>
            {jalanSub === "tangent" && jalanDraft && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  if (!jalanDraft || jalanDraft.points.length < 2) { setJalanDraft(null); return; }
                  const rd: RoadSegment = {
                    id: newRoadId(), kind: "tangent",
                    points: jalanDraft.points.map((p) => ({ x: p.x, y: p.y })),
                    widthM: jalanWidthM, filletM: jalanFilletM, createdAt: Date.now(),
                  };
                  onChange({ roads: [...(sketch.roads ?? []), rd] });
                  setJalanDraft(null);
                  toast.success("Jalan tangent tersimpan");
                }}
              >Selesai ({jalanDraft.points.length} titik)</Button>
            )}
            {(sketch.roads ?? []).length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2 text-[11px] text-rose-600 hover:bg-rose-50"
                onClick={() => { onChange({ roads: [] }); toast.success("Semua jalan dihapus"); }}
              >Hapus semua ({(sketch.roads ?? []).length})</Button>
            )}
          </div>
        )}
        {tool === "parking" && (
          <ParkingSubToolbar
            parkingKind={parkingKind}
            sub={parkingSubTool}
            setSub={setParkingSubTool}
            selectedId={parkingSelectedId}
            clipboardSize={parkingClipboard?.length ?? 0}
            orientation={
              ((sketch.parkingAreas ?? []).find((a) => a.id === parkingSelectedId)?.orientation ?? "auto")
            }
            onOrientation={(o) => {
              if (!parkingSelectedId) { toast.error("Pilih area parkir dulu"); return; }
              pushHistory();
              onChange({
                parkingAreas: (sketch.parkingAreas ?? []).map((a) =>
                  a.id === parkingSelectedId ? { ...a, orientation: o } : a,
                ),
              });
            }}
            onCopy={() => {
              if (!parkingSelectedId) { toast.error("Pilih area parkir dulu"); return; }
              const sel = (sketch.parkingAreas ?? []).find((a) => a.id === parkingSelectedId);
              if (!sel) return;
              setParkingClipboard([{ ...sel, levelId: undefined }]);
              toast.success("Disalin ke clipboard");
            }}
            onPaste={() => {
              if (!parkingClipboard || parkingClipboard.length === 0) { toast.error("Clipboard kosong"); return; }
              pushHistory();
              const pasted: ParkingArea[] = parkingClipboard.map((a) => ({
                ...a,
                id: genParkingId(),
                levelId: activeLvlId ?? undefined,
                pointsLocal: a.pointsLocal.map((q) => ({ x: q.x, y: q.y })),
                 paths: (a.paths ?? []).map((p) => ({
                   id: genParkingPathId(),
                   pointsLocal: p.pointsLocal.map((q) => ({ x: q.x, y: q.y })),
                 })),
              }));
              onChange({ parkingAreas: [...(sketch.parkingAreas ?? []), ...pasted] });
              setParkingSelectedId(pasted[0]?.id ?? null);
              toast.success(`Ditempel di ${activeLvlId ? "level aktif" : "proyek"}`);
            }}
            onDelete={() => {
              if (!parkingSelectedId) { toast.error("Pilih area parkir dulu"); return; }
              pushHistory();
              onChange({
                parkingAreas: (sketch.parkingAreas ?? []).filter((a) => a.id !== parkingSelectedId),
              });
              setParkingSelectedId(null);
              toast.success("Area parkir dihapus");
            }}
            hasDraft={!!parkingDraft}
            onSaveDraft={() => {
              if (!parkingDraft) return;
              pushHistory();
              const newArea = { ...parkingDraft, levelId: activeLvlId ?? parkingDraft.levelId };
              onChange({ parkingAreas: [...(sketch.parkingAreas ?? []), newArea] });
              setParkingSelectedId(newArea.id);
              setParkingDraft(null);
              setParkingSubTool("move");
              toast.success("Area parkir tersimpan");
            }}
            onCancelDraft={() => { setParkingDraft(null); toast.message("Draft dibatalkan"); }}
            hasPathDraft={!!parkingPathDraft}
            pathDraftCount={parkingPathDraft?.points.length ?? 0}
            onSavePathDraft={() => {
              if (!parkingPathDraft || parkingPathDraft.points.length < 2) {
                toast.error("Butuh ≥ 2 titik");
                return;
              }
              pushHistory();
              const newPath: ParkingPath = {
                id: genParkingPathId(),
                pointsLocal: parkingPathDraft.points.map((p) => ({ x: p.x, y: p.y })),
              };
              onChange({
                parkingAreas: (sketch.parkingAreas ?? []).map((a) =>
                  a.id === parkingPathDraft.areaId
                    ? { ...a, paths: [...(a.paths ?? []), newPath] }
                    : a,
                ),
              });
              setParkingPathDraft(null);
              toast.success("Jalur parkir tersimpan");
            }}
            onCancelPathDraft={() => { setParkingPathDraft(null); toast.message("Draft jalur dibatalkan"); }}
          />

        )}
        {tool === "ramp" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card/60 p-2">
            {(["tarik", "geser", "addpt", "lebar", "kemiringan", "fillet"] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={rampSub === m ? "default" : "outline"}
                className={cn(rampSub === m && "bg-gradient-primary shadow-primary")}
                onClick={() => {
                  setRampSub(m);
                  if (m !== "tarik") setRampDraft(null);
                }}
              >
                {m === "tarik" ? "Tarik" : m === "geser" ? "Geser Titik" : m === "addpt" ? "Tambah Titik" : m === "lebar" ? "Lebar" : m === "kemiringan" ? "Kemiringan" : "Fillet"}
              </Button>
            ))}
            {rampSub === "lebar" && (
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Lebar (m)</Label>
                <Input
                  type="number"
                  step="0.1"
                  className="h-8 w-20"
                  value={rampWidthInput}
                  onChange={(e) => setRampWidthInput(e.target.value)}
                />
                <Button size="sm" variant="outline" onClick={() => {
                  if (!rampSelectedId) { toast.error("Pilih ramp dulu"); return; }
                  pushHistory();
                  onChange({ ramps: (sketch.ramps ?? []).map((r) => r.id === rampSelectedId ? { ...r, widthM: rampWidthM } : r) });
                  toast.success("Lebar ramp diperbarui");
                }}>Terapkan</Button>
              </div>
            )}
            {rampSub === "kemiringan" && (
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">1 : n (n meter)</Label>
                <Input
                  type="number"
                  step="0.5"
                  className="h-8 w-20"
                  value={rampNInput}
                  onChange={(e) => setRampNInput(e.target.value)}
                />
                <Button size="sm" variant="outline" onClick={() => {
                  if (!rampSelectedId) { toast.error("Pilih ramp dulu"); return; }
                  const r = (sketch.ramps ?? []).find((x) => x.id === rampSelectedId);
                  if (!r) { toast.error("Ramp tidak ditemukan"); return; }
                  const cur = [...(levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
                  const i = cur.findIndex((l) => l.id === r.levelId);
                  const above = i >= 0 && i < cur.length - 1 ? cur[i + 1] : null;
                  const t = above ? Math.max(0, above.mdpl - cur[i].mdpl) : 0;
                  const dense = tessellateReference(r.anchors, pxPerMeter, 18);
                  const wPx = Math.max(0.01, r.widthM) * pxPerMeter;
                  const offDense = offsetPolyline(dense, wPx, r.offsetSide);
                  const centerDense = dense.map((p, idx) => {
                    const q = offDense[Math.min(idx, offDense.length - 1)];
                    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
                  });
                  const curLenM = polylineLength(centerDense) / pxPerMeter;
                  pushHistory();
                  let nextAnchors = r.anchors;
                  const slopeLenM = t * rampNVal;
                  const nBordes = rampBordesOn ? numBordesForSlope(slopeLenM, rampBordesSpacingM) : 0;
                  const addLenM = nBordes * rampBordesLenM;
                  const targetLenM = slopeLenM + addLenM;
                  if (t > 0 && curLenM > 1e-3 && targetLenM > 0) {
                    const factor = targetLenM / curLenM;
                    const p0 = r.anchors[0];
                    nextAnchors = r.anchors.map((p, idx) => idx === 0 ? p : { ...p, x: p0.x + (p.x - p0.x) * factor, y: p0.y + (p.y - p0.y) * factor });
                  }
                  const lockedAnchorLenM = polylineLength(nextAnchors) / pxPerMeter;
                  onChange({ ramps: (sketch.ramps ?? []).map((rr) => rr.id === rampSelectedId ? {
                    ...rr,
                    nM: rampNVal,
                    anchors: nextAnchors,
                    lockedLenM: t > 0 ? lockedAnchorLenM : undefined,
                    bordes: rampBordesOn,
                    bordesLenM: rampBordesOn ? rampBordesLenM : undefined,
                    bordesSpacingM: rampBordesOn ? rampBordesSpacingM : undefined,
                    bordesBelokan: rampBordesOn && rampBordesBelokan,
                  } : rr) });
                  if (t > 0) toast.success(`Kemiringan 1:${rampNVal} → slope ${slopeLenM.toFixed(2)} m${nBordes > 0 ? ` + ${nBordes} bordes (${addLenM.toFixed(2)} m) = ${targetLenM.toFixed(2)} m` : ""}`);
                  else toast.success("Kemiringan ramp diperbarui");
                }}>Terapkan</Button>
                {(() => {
                  const r = (sketch.ramps ?? []).find((x) => x.id === rampSelectedId);
                  if (!r) return null;
                  const cur = [...(levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
                  const i = cur.findIndex((l) => l.id === r.levelId);
                  const above = i >= 0 && i < cur.length - 1 ? cur[i + 1] : null;
                  const t = above ? Math.max(0, above.mdpl - cur[i].mdpl) : 0;
                  const slopeLenM = t * rampNVal;
                  const nBordes = rampBordesOn ? numBordesForSlope(slopeLenM, rampBordesSpacingM) : 0;
                  const total = slopeLenM + nBordes * rampBordesLenM;
                  return <span className="text-[11px] text-muted-foreground">t = {t.toFixed(2)} m · slope = {slopeLenM.toFixed(2)} m{nBordes > 0 ? ` + ${nBordes}×${rampBordesLenM}m bordes = ${total.toFixed(2)} m` : ""}</span>;
                })()}
              </div>
            )}
            {rampSub === "kemiringan" && (
              <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2 py-1">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={rampBordesOn}
                    onChange={(e) => setRampBordesOn(e.target.checked)}
                  />
                  Bordes
                </label>
                {rampBordesOn && (
                  <>
                    <Label className="text-xs">Panjang (m)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      className="h-8 w-20"
                      value={rampBordesLenInput}
                      onChange={(e) => setRampBordesLenInput(e.target.value)}
                    />
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={rampBordesBelokan}
                        onChange={(e) => setRampBordesBelokan(e.target.checked)}
                      />
                      Bordes Belokan
                    </label>
                  </>
                )}
              </div>
            )}
            {rampSub === "fillet" && (
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Radius (m)</Label>
                <Input
                  type="number"
                  step="0.1"
                  className="h-8 w-20"
                  value={rampFilletInput}
                  onChange={(e) => setRampFilletInput(e.target.value)}
                />
                <span className="text-[11px] text-muted-foreground">Tap titik tengah polyline acuan</span>
              </div>
            )}
            {rampSub === "tarik" && rampDraft && (
              <>
                <span className="text-[11px] text-muted-foreground">Titik: {rampDraft.anchors.length}</span>
                <Button size="sm" variant="outline" onClick={() => {
                  setRampDraft({ ...rampDraft, offsetSide: rampDraft.offsetSide === "right" ? "left" : "right" });
                }}>Flip Sisi ({rampDraft.offsetSide})</Button>
                <Button size="sm" onClick={() => {
                  if (!rampDraft || rampDraft.anchors.length < 2) { toast.error("Butuh ≥ 2 titik"); return; }
                  pushHistory();
                  const ramp = makeRamp(rampDraft.levelId, rampDraft.anchors, { offsetSide: rampDraft.offsetSide, widthM: rampWidthM, nM: rampNVal });
                  onChange({ ramps: [...(sketch.ramps ?? []), ramp] });
                  setRampSelectedId(ramp.id);
                  setRampDraft(null);
                  toast.success("Ramp tersimpan");
                }} className="bg-gradient-primary shadow-primary">Simpan</Button>
                <Button size="sm" variant="outline" onClick={() => { setRampDraft(null); toast.message("Dibatalkan"); }}>Batal</Button>
              </>
            )}
            <div className="flex items-center gap-1.5 ml-auto">
              <Button size="sm" variant="outline" onClick={() => {
                if (!rampSelectedId) { toast.error("Pilih ramp dulu"); return; }
                const r = (sketch.ramps ?? []).find((x) => x.id === rampSelectedId);
                if (!r) { toast.error("Ramp tidak ditemukan"); return; }
                setRampClipboard(JSON.parse(JSON.stringify(r)) as Ramp);
                toast.success("Ramp disalin");
              }} title="Salin ramp terpilih">Copy</Button>
              <Button size="sm" variant="outline" onClick={() => {
                if (!rampClipboard) { toast.error("Clipboard kosong"); return; }
                pushHistory();
                const targetLevel = activeLvlId || rampClipboard.levelId;
                const newRamp: Ramp = {
                  ...JSON.parse(JSON.stringify(rampClipboard)),
                  id: genRampId(),
                  levelId: targetLevel,
                  createdAt: Date.now(),
                };
                onChange({ ramps: [...(sketch.ramps ?? []), newRamp] });
                setRampSelectedId(newRamp.id);
                toast.success("Ramp ditempel pada koordinat sama");
              }} title="Tempel ramp (koordinat x,y tetap)">Paste</Button>
            </div>
            {rampSelectedId && rampSub !== "tarik" && (
              <Button size="sm" variant="destructive" onClick={() => {
                pushHistory();
                onChange({ ramps: (sketch.ramps ?? []).filter((r) => r.id !== rampSelectedId) });
                setRampSelectedId(null);
                toast.success("Ramp dihapus");
              }}>Hapus</Button>
            )}
          </div>
        )}
        {tool === "floor" && (
          <FloorToolPanel
            mode={floorMode}
            onMode={(m) => {
              const drawModes = new Set(["line", "polyline", "arc", "bezier"]);
              const preserveDraft = drawModes.has(floorMode) && drawModes.has(m);
              setFloorMode(m);
              setFloorDraft(null);
              if (!preserveDraft) setPolyDraft(null);
              setDrawing(null);
              setFloorVertexDrag(null);
              setSelectedFloorEditVertices([]);
              setFloorVoidDraft(null);
            }}
            draft={floorDraft}
            level={levels.find((l) => l.id === activeLvlId) ?? null}
            onCommit={() => commitFloor()}
            onCancel={() => { setFloorDraft(null); setPolyDraft(null); setDrawing(null); }}
            editSub={floorEditSub}
            onEditSub={(s) => { setFloorEditSub(s); setFloorVertexDrag(null); setSelectedFloorEditVertices([]); setFloorVoidDraft(null); }}
            selectedFloorVertex={selectedFloorEditVertex}
            selectedFloorVertexCount={selectedFloorEditVertices.length}
            onClearFloorSelection={() => setSelectedFloorEditVertices([])}
            floorVxDxMm={floorVxDxMm}
            floorVxDyMm={floorVxDyMm}
            onFloorVxDxMm={setFloorVxDxMm}
            onFloorVxDyMm={setFloorVxDyMm}
            pxPerMeter={pxPerMeter}
            onApplyFloorVertexMove={() => {
              if (selectedFloorEditVertices.length === 0) return;
              const dxMm = Number(floorVxDxMm) || 0;
              const dyMm = Number(floorVxDyMm) || 0;
              if (dxMm === 0 && dyMm === 0) { toast.error("Isi ΔX atau ΔY terlebih dahulu"); return; }
              const dxPx = (dxMm / 1000) * pxPerMeter;
              const dyPx = (dyMm / 1000) * pxPerMeter;
              pushHistory();
              const selByFid = new Map<string, FloorVertexSel[]>();
              for (const s of selectedFloorEditVertices) {
                const arr = selByFid.get(s.fid) ?? [];
                arr.push(s); selByFid.set(s.fid, arr);
              }
              const nextFloors = (sketch.floors ?? []).map((fl) => {
                const sels = selByFid.get(fl.id);
                if (!sels || sels.length === 0) return fl;
                const outerSet = new Set(sels.filter((s) => s.ring === "outer").map((s) => s.idx));
                const holeMap = new Map<number, Set<number>>();
                for (const s of sels) {
                  if (s.ring === "outer") continue;
                  const ri = s.ring as number;
                  const set = holeMap.get(ri) ?? new Set<number>();
                  set.add(s.idx); holeMap.set(ri, set);
                }
                const nextOuter = fl.outer.map((p, i) => outerSet.has(i) ? { x: p.x + dxPx, y: p.y + dyPx } : p);
                const nextHoles = (fl.holes ?? []).map((h, hi) => {
                  const set = holeMap.get(hi);
                  if (!set) return h;
                  return h.map((p, i) => set.has(i) ? { x: p.x + dxPx, y: p.y + dyPx } : p);
                });
                return { ...fl, outer: nextOuter, holes: nextHoles.length ? nextHoles : fl.holes };
              });
              onChange({ floors: nextFloors });
              setSelectedFloorEditVertices((prev) => prev.map((p) => ({ ...p, coord: { x: p.coord.x + dxPx, y: p.coord.y + dyPx } })));
              setFloorVxDxMm("0"); setFloorVxDyMm("0");
              toast.success(`${selectedFloorEditVertices.length} titik lantai digeser ΔX ${dxMm}mm, ΔY ${dyMm}mm`);
            }}
            floorsInLevel={(sketch.floors ?? []).filter((f) => f.levelId === activeLvlId)}
            clipboardCount={floorClipboard.length}
            onCopyFloors={() => {
              const inLvl = (sketch.floors ?? []).filter((f) => f.levelId === activeLvlId);
              if (inLvl.length === 0) { toast.error("Tidak ada lantai untuk disalin"); return; }
              const clones: Floor[] = inLvl.map((f) => ({
                ...f,
                outer: f.outer.map((p) => ({ x: p.x, y: p.y })),
                holes: f.holes ? f.holes.map((h) => h.map((p) => ({ x: p.x, y: p.y }))) : undefined,
              }));
              setFloorClipboard(clones);
              toast.success(`${clones.length} lantai disalin`);
            }}
            onPasteFloors={() => {
              if (floorClipboard.length === 0) return;
              const { activeId } = ensureLevels();
              pushHistory();
              const pasted: Floor[] = floorClipboard.map((f) => ({
                ...f,
                id: genFloorId(),
                levelId: activeId,
                createdAt: Date.now(),
                outer: f.outer.map((p) => ({ x: p.x, y: p.y })),
                holes: f.holes ? f.holes.map((h) => h.map((p) => ({ x: p.x, y: p.y }))) : undefined,
              }));
              onChange({ floors: [...(sketch.floors ?? []), ...pasted] });
              toast.success(`${pasted.length} lantai ditempel di level ini`);
            }}
            onDeleteFloors={() => {
              const inLvl = (sketch.floors ?? []).filter((f) => f.levelId === activeLvlId);
              if (inLvl.length === 0) { toast.error("Tidak ada lantai untuk dihapus"); return; }
              pushHistory();
              const remaining = (sketch.floors ?? []).filter((f) => f.levelId !== activeLvlId);
              onChange({ floors: remaining });
              setFloorDraft(null);
              setFloorVertexDrag(null);
              toast.success(`${inLvl.length} lantai dihapus dari level ini`);
            }}
          />
        )}
        {tool === "offset" && (
          <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Offset — Jarak (cm)</Label>
            <Input
              type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
              min={1}
              max={10000}
              step={1}
              value={offsetCm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) setOffsetCm(v);
              }}
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Tap garis pada sisi tempat duplikat ingin diletakkan. Hanya garis lurus.
            </p>
          </div>
        )}
        {tool === "trim" && (
          <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <p className="text-[11px] text-muted-foreground">
              Tap garis pada ujung yang ingin di-trim/extend. Garis lurus terdekat lainnya dipakai sebagai batas; ujung digerakkan ke titik perpotongan kedua garis (memperpendek atau memperpanjang otomatis).
            </p>
          </div>
        )}
        {tool === "circle" && (
          <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <p className="text-[11px] text-muted-foreground">
              Tap di pusat, lalu geser untuk menentukan radius. Hapus dengan tool Hapus.
            </p>
          </div>
        )}
        {tool === "door" && (
          <div className="space-y-2.5 rounded-md border border-border/60 bg-background/40 p-2.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Pintu — Parameter</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {([1, 2] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDoorLeaves(n)}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs font-medium transition",
                    doorLeaves === n
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border/60 hover:bg-muted/40",
                  )}
                >
                  {n === 1 ? "1 Daun" : "2 Daun"}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground">Lebar (cm)</Label>
                <Input
                  type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
                  min={90}
                  max={200}
                  step={5}
                  value={doorWidthCm}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    setDoorWidthCm(Math.max(90, Math.min(200, Math.round(v))));
                  }}
                  className="h-7 w-20 text-xs"
                />
              </div>
              <input
                type="range"
                min={90}
                max={200}
                step={1}
                value={doorWidthCm}
                onChange={(e) => setDoorWidthCm(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              1) Tap di garis dinding — titik akan snap ke dinding (engsel).
              2) Geser searah dinding untuk menentukan arah pintu.
              3) Geser tegak lurus untuk memilih sisi ayun, lalu lepas.
              Notasi muncul di Slide Denah; massa 3D tidak berubah.
            </p>
            {(() => {
              const doorsInLevel = (sketch.doors ?? []).filter(
                (d) => (d.levelId ?? activeLvlId) === activeLvlId,
              );
              const canCopy = doorsInLevel.length > 0;
              const canPaste = doorClipboard.length > 0;
              if (!canCopy && !canPaste) return null;
              return (
                <div className="grid grid-cols-2 gap-1.5 border-t border-border/60 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canCopy}
                    onClick={() => {
                      const clones: Door[] = doorsInLevel.map((d) => ({ ...d }));
                      setDoorClipboard(clones);
                      toast.success(`${clones.length} pintu disalin`);
                    }}
                    className="h-7 text-xs"
                    title="Salin semua pintu di level aktif"
                  >
                    <Copy className="mr-1.5 h-3 w-3" /> Copy Pintu
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canPaste}
                    onClick={() => {
                      pushHistory();
                      const pasted: Door[] = doorClipboard.map((d) => ({
                        ...d,
                        id: genDoorId(),
                        levelId: activeLvlId,
                      }));
                      onChange({ doors: [...(sketch.doors ?? []), ...pasted] });
                      toast.success(`${pasted.length} pintu ditempel di level ini`);
                    }}
                    className="h-7 text-xs"
                    title="Tempel pintu pada koordinat X/Y yang sama di level aktif"
                  >
                    <ClipboardPaste className="mr-1.5 h-3 w-3" /> Paste Pintu
                  </Button>
                </div>
              );
            })()}
            {(sketch.doors?.length ?? 0) > 0 && (
              <div className="space-y-1.5 border-t border-border/60 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{sketch.doors!.length} pintu</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      pushHistory();
                      onChange({ doors: [] });
                      setDoorEraseMode(false);
                      toast.success("Semua pintu dihapus");
                    }}
                    className="h-7 text-xs"
                  >
                    <Trash2 className="mr-1.5 h-3 w-3" /> Reset
                  </Button>
                </div>
                <Button
                  variant={doorEraseMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDoorEraseMode((v) => !v)}
                  className={cn(
                    "h-7 w-full text-xs",
                    doorEraseMode && "bg-gradient-primary shadow-primary",
                  )}
                >
                  <Trash2 className="mr-1.5 h-3 w-3" />
                  {doorEraseMode ? "Mode Hapus Aktif — tap pintu" : "Hapus Pintu (per item)"}
                </Button>
              </div>
            )}
          </div>
        )}
        {tool === "pick" && (
          <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Material Selubung
            </Label>
            <div className="grid grid-cols-1 gap-1.5">
              {(["solid", "curtain", "window", "railing"] as EdgeMaterial[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPickMaterial(m)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition",
                    pickMaterial === m
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border/60 hover:bg-muted/40",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-4 w-4 rounded-sm border border-black/20"
                    style={{ background: MATERIAL_COLORS[m] }}
                  />
                  <span className="font-medium">{MATERIAL_LABELS[m]}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Klik segmen garis di kanvas untuk menandai. Segmen dipecah otomatis
              pada tiap titik potong (node). Alt/Shift + klik = hapus tanda.
              Tanda ini hanya mengubah notasi di slide Denah & Potongan, tidak
              memengaruhi massa 3D.
            </p>
            {Object.keys(sketch.edgeAttrs ?? {}).length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  pushHistory();
                  onChange({ edgeAttrs: {} });
                  toast.success("Semua tanda material dihapus");
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Reset semua tanda
              </Button>
            )}
          </div>
        )}
        {tool === "move" && (
          <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Move — {moveSel.size} terpilih
            </Label>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Klik objek untuk pilih (Shift untuk tambah). Drag area kosong = marquee.
              Drag objek terpilih = geser (snap 1 blok milimeter). Atau isi ΔX/ΔY mm di bawah.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMoveSel(new Set(moveAllKeysActiveLevel()))}
              >
                Pilih Semua
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMoveSel(new Set())}
                disabled={moveSel.size === 0}
              >
                Kosongkan
              </Button>
            </div>
            {/* ===== Copy / Paste lintas-level ===== */}
            <div className="space-y-1.5 rounded-md border border-border/40 bg-surface/30 p-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Clipboard
                </Label>
                <span className="text-[10px] text-muted-foreground">
                  {moveClipboard
                    ? `${moveClipboard.lines.length + moveClipboard.layers.length + moveClipboard.circles.length + moveClipboard.doors.length + moveClipboard.floors.length} obj`
                    : "kosong"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopySelection}
                  disabled={moveSel.size === 0}
                  title="Salin objek terpilih (Ctrl+C konseptual)"
                >
                  Copy
                </Button>
                <Button
                  size="sm"
                  className="bg-gradient-primary shadow-primary"
                  onClick={() => handlePasteClipboard()}
                  disabled={!moveClipboard}
                  title="Tempel ke level aktif"
                >
                  Paste
                </Button>
              </div>
              {moveClipboard && (
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">
                    Tempel ke level tertentu
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {levels.map((lv) => (
                      <Button
                        key={lv.id}
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => handlePasteClipboard(lv.id)}
                      >
                        {lv.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] leading-snug text-muted-foreground">
                Salin objek dari level mana pun, lalu tempel ke level aktif atau pilih level tujuan di atas. Koordinat dipertahankan; ID baru dibuat otomatis.
              </p>
            </div>

            <div className="space-y-1.5 rounded-md border border-border/40 bg-surface/30 p-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Geser Numerik (mm)
              </Label>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <Label className="text-[10px] text-muted-foreground">ΔX</Label>
                  <Input
                    type="text" inputMode="text" pattern="-?[0-9]*\.?[0-9]*"
                    value={moveDxMm}
                    onChange={(e) => setMoveDxMm(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">ΔY</Label>
                  <Input
                    type="text" inputMode="text" pattern="-?[0-9]*\.?[0-9]*"
                    value={moveDyMm}
                    onChange={(e) => setMoveDyMm(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="0"
                  />
                </div>
              </div>
              <Button
                size="sm"
                className="w-full bg-gradient-primary shadow-primary"
                disabled={moveSel.size === 0}
                onClick={() => {
                  const dxMm = Number(moveDxMm) || 0;
                  const dyMm = Number(moveDyMm) || 0;
                  if (dxMm === 0 && dyMm === 0) {
                    toast.error("Isi ΔX atau ΔY terlebih dahulu");
                    return;
                  }
                  // Konversi mm → px world. 1 m = pxPerMeter px.
                  const dxPx = (dxMm / 1000) * pxPerMeter;
                  const dyPx = (dyMm / 1000) * pxPerMeter;
                  pushHistory();
                  const snap = buildMoveSnapshot();
                  const patch = buildTranslatedPatch(snap, moveSel, dxPx, dyPx);
                  onChange(patch);
                  toast.success(`Digeser ΔX ${dxMm}mm, ΔY ${dyMm}mm`);
                  setMoveDxMm("0"); setMoveDyMm("0");
                }}
              >
                Apply
              </Button>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Positif ΔX = ke kanan, positif ΔY = ke bawah (mengikuti orientasi mm-grid layar).
              </p>
            </div>
          </div>
        )}

        {tool === "mirror" && (
          <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Mirror — {moveSel.size} terpilih
            </Label>
            <p className="text-[10px] leading-snug text-muted-foreground">
              1. Pilih objek dulu di tool <b>Move</b> (garis, ruang, lantai, lingkaran, pintu, atau garis potong).<br />
              2. Kembali ke tool ini. Klik titik pusat sumbu (snap ke vertex / midpoint / grid sesuai snap aktif), lalu tarik untuk menentukan arah.<br />
              3. Sudut sumbu otomatis <b>snap</b> ke 0° / 45° / 90° / 135°.<br />
              4. Lepaskan untuk mencerminkan — objek baru dibuat sebagai duplikat terpisah (tidak terhubung dengan sumber).
            </p>
            {mirrorDraft && (
              <div className="rounded-md border border-border/40 bg-surface/30 p-2 text-[11px]">
                Sumbu aktif: <b>{mirrorDraft.angleDeg}°</b>
              </div>
            )}
            {moveSel.size === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setTool("move")}
              >
                Buka tool Move untuk memilih
              </Button>
            )}
          </div>
        )}



        {tool === "grid" && (
          <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Aktif</Label>
              <Switch checked={grid.enabled} onCheckedChange={(v) => updateGrid({ enabled: v })} />
            </div>
            {/* ===== Pilih grid (primer + extras) + Paste Grid ===== */}
            <div className="space-y-1.5 rounded-md border border-border/40 bg-surface/30 p-2">
              <div className="flex items-center justify-between gap-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Grid Aktif untuk Edit
                </Label>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    title="Tambah grid struktur baru (bangunan terpisah) — bisa berada di level yang sama dengan grid primer"
                    onClick={() => {
                      const src = primaryGrid;
                      const offsetPx = pxPerMeter * 1.5;
                      const fresh: StructuralGrid = {
                        ...DEFAULT_GRID,
                        enabled: true,
                        origin: { x: src.origin.x + offsetPx, y: src.origin.y + offsetPx },
                        colSizeCm: src.colSizeCm,
                        fromLevelId: src.fromLevelId,
                        toLevelId: src.toLevelId,
                      };
                      const nextExtras = [...gridExtras, fresh];
                      onChange({ structuralGridExtras: nextExtras });
                      setEditGridIdx(nextExtras.length);
                      setClipDraft(null);
                      toast.success("Grid baru ditambah — atur bentang & geser posisinya");
                    }}
                  >
                    + Grid
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    title="Paste salinan grid primer di sini — bisa digeser & di-clip terpisah"
                    onClick={() => {
                      const src = primaryGrid;
                      const offsetPx = pxPerMeter * 1.5;
                      const pasted: StructuralGrid = {
                        enabled: true,
                        origin: { x: src.origin.x + offsetPx, y: src.origin.y + offsetPx },
                        rotation: src.rotation,
                        spansX: [...src.spansX],
                        spansY: [...src.spansY],
                        colSizeCm: src.colSizeCm,
                        fromLevelId: src.fromLevelId,
                        toLevelId: src.toLevelId,
                        perLevel: undefined,
                        columnClips: undefined,
                      };
                      const nextExtras = [...gridExtras, pasted];
                      onChange({ structuralGridExtras: nextExtras });
                      setEditGridIdx(nextExtras.length);
                      setClipDraft(null);
                      toast.success("Grid dipaste — geser ke posisi yang diinginkan");
                    }}
                  >
                    <Copy className="mr-1 h-3 w-3" /> Paste Grid
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant={editGridIdx === 0 ? "default" : "outline"}
                  className={cn("h-6 px-2 text-[10px]", editGridIdx === 0 && "bg-gradient-primary shadow-primary")}
                  onClick={() => { setEditGridIdx(0); setClipDraft(null); }}
                >
                  Primer
                </Button>
                {gridExtras.map((_, i) => (
                  <div key={`gex-${i}`} className="flex items-center gap-0.5">
                    <Button
                      size="sm"
                      variant={editGridIdx === i + 1 ? "default" : "outline"}
                      className={cn("h-6 px-2 text-[10px]", editGridIdx === i + 1 && "bg-gradient-primary shadow-primary")}
                      onClick={() => { setEditGridIdx(i + 1); setClipDraft(null); }}
                    >
                      Extra {i + 1}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-[10px]"
                      title="Hapus grid extra"
                      onClick={() => {
                        const next = gridExtras.filter((_, idx) => idx !== i);
                        onChange({ structuralGridExtras: next.length ? next : undefined });
                        if (editGridIdx === i + 1) setEditGridIdx(0);
                        else if (editGridIdx > i + 1) setEditGridIdx(editGridIdx - 1);
                        setClipDraft(null);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              {editGridIdx > 0 && (
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Mengedit <span className="font-medium text-foreground">Extra {editGridIdx}</span>.
                  Bentang, kolom, clip, dan range level di bawah ini hanya berlaku pada grid ini — tidak mempengaruhi grid primer. Beberapa grid boleh berada pada level yang sama (mis. bangunan terpisah).
                </p>
              )}

            </div>

            <SpanAxisEditor label="Bentang Sumbu X (m)" spans={grid.spansX}
              onChange={(next) => updateGrid({ spansX: next })} />
            <SpanAxisEditor label="Bentang Sumbu Y (m)" spans={grid.spansY}
              onChange={(next) => updateGrid({ spansY: next })} />
            <p className="text-[10px] leading-snug text-muted-foreground">
              Tip: di kanvas, tarik 4 kotak sudut grid (oranye) dengan stylus untuk menambah/mengurangi bentang otomatis. Tarik bagian dalam grid untuk menggeser titik nol (snap milimeter block).
            </p>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Dimensi Kolom (cm)</Label>
              <div className="flex flex-wrap gap-1">
                {COL_PRESETS.map((c) => (
                  <Button key={`c-${c}`} size="sm" variant={grid.colSizeCm === c ? "default" : "outline"} className="h-6 px-2 text-[10px]"
                    onClick={() => updateGrid({ colSizeCm: c })}>
                    {c}
                  </Button>
                ))}
                <Input
                  className="h-6 w-16 text-[10px]"
                  type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*" min={10} step={5}
                  value={grid.colSizeCm}
                  onChange={(e) => updateGrid({ colSizeCm: Math.max(5, Number(e.target.value) || 50) })}
                />
              </div>
            </div>
            {/* ===== Edit Kolom (Clip Polygon) ===== */}
            <div className="space-y-1.5 rounded-md border border-border/50 bg-background/30 p-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Mode Edit</Label>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant={gridEditMode === "expand" ? "default" : "outline"}
                    className="h-6 px-2 text-[10px]"
                    onClick={() => { setGridEditMode("expand"); setClipDraft(null); }}
                  >
                    Bentang
                  </Button>
                  <Button
                    size="sm"
                    variant={gridEditMode === "clip" ? "default" : "outline"}
                    className={cn("h-6 px-2 text-[10px]", gridEditMode === "clip" && "bg-gradient-primary shadow-primary")}
                    onClick={() => setGridEditMode("clip")}
                  >
                    Clip Kolom
                  </Button>
                  <Button
                    size="sm"
                    variant={gridEditMode === "fromLine" ? "default" : "outline"}
                    className={cn("h-6 px-2 text-[10px]", gridEditMode === "fromLine" && "bg-gradient-primary shadow-primary")}
                    onClick={() => { setGridEditMode("fromLine"); setClipDraft(null); }}
                    title="Klik garis lurus / polyline di kanvas — grid extra dibuat mengikuti panjang segmen, dengan buble otomatis menyambung dari grid sebelumnya."
                  >
                    Jadikan Grid
                  </Button>
                </div>
              </div>
              {gridEditMode === "fromLine" && (
                <div className="space-y-1.5">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Klik garis lurus di kanvas — garis akan ditambahkan sebagai
                    sumbu grid pada grid <span className="font-medium text-foreground">{editGridIdx === 0 ? "Primer" : `Extra ${editGridIdx}`}</span> yang
                    sedang aktif, dan garis aslinya dihapus. Mode tetap aktif
                    sehingga bisa pilih beberapa garis berurutan. Tekan tombol
                    <span className="font-medium text-foreground"> Jadikan Grid</span> lagi atau
                    <span className="font-medium text-foreground"> Bentang</span> untuk selesai.
                  </p>
                  {(grid.extraLines ?? []).length > 0 && (
                    <div className="space-y-1 rounded border border-border/50 bg-surface/40 p-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Garis tergabung ({grid.extraLines!.length})
                      </div>
                      {grid.extraLines!.map((el, i) => {
                        const baseIdx = (grid.labelOffsetX ?? 0) + grid.spansX.length + 1;
                        const lbl = xAxisLabelAt(baseIdx + i, 0);
                        return (
                          <div key={el.id} className="flex items-center justify-between gap-1.5">
                            <span className="text-[11px] font-medium">{lbl} · {el.lengthM.toFixed(2)}m</span>
                            <div className="flex items-center gap-1.5">
                              <label className="flex items-center gap-1 text-[10px]" title="Sembunyikan buble ujung awal">
                                <input type="checkbox" checked={!!el.hideStart}
                                  onChange={(e) => {
                                    const next = (grid.extraLines ?? []).map((x, k) =>
                                      k === i ? { ...x, hideStart: e.target.checked } : x);
                                    updateGrid({ extraLines: next });
                                  }} />
                                Awal
                              </label>
                              <label className="flex items-center gap-1 text-[10px]" title="Sembunyikan buble ujung akhir">
                                <input type="checkbox" checked={!!el.hideEnd}
                                  onChange={(e) => {
                                    const next = (grid.extraLines ?? []).map((x, k) =>
                                      k === i ? { ...x, hideEnd: e.target.checked } : x);
                                    updateGrid({ extraLines: next });
                                  }} />
                                Akhir
                              </label>
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]"
                                onClick={() => {
                                  const next = (grid.extraLines ?? []).filter((_, k) => k !== i);
                                  updateGrid({ extraLines: next.length ? next : undefined });
                                }}
                                title="Hapus garis dari grid">
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {gridEditMode === "clip" && (
                <>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Tap di kanvas untuk menambah titik perimeter. Geser titik untuk mengatur bentuk. Setelah ≥3 titik, tekan <span className="font-medium text-foreground">Simpan Area</span> untuk menyembunyikan kolom di dalam area.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => {
                        if (!clipDraft || clipDraft.pts.length < 3) {
                          toast.error("Butuh minimal 3 titik");
                          return;
                        }
                        const newClip: ColumnClip = {
                          id: `clip-${Date.now().toString(36)}`,
                          pts: clipDraft.pts.slice(),
                        };
                        const clips = [...(grid.columnClips ?? []), newClip];
                        updateGrid({ columnClips: clips });
                        setClipDraft(null);
                        toast.success("Area clip tersimpan");
                      }}
                      disabled={!clipDraft || clipDraft.pts.length < 3}
                    >
                      Simpan Area
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => {
                        if (!clipDraft || !clipDraft.pts.length) return;
                        setClipDraft({ pts: clipDraft.pts.slice(0, -1) });
                      }}
                      disabled={!clipDraft || !clipDraft.pts.length}
                    >
                      <X className="mr-1 h-3 w-3" /> Titik Terakhir
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => setClipDraft(null)}
                      disabled={!clipDraft}
                    >
                      Batal Draft
                    </Button>
                  </div>
                  {(grid.columnClips ?? []).length > 0 && (
                    <div className="space-y-1 pt-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Area Clip ({grid.columnClips!.length})</div>
                      {grid.columnClips!.map((c, idx) => (
                        <div key={c.id} className="flex items-center justify-between gap-1.5 rounded border border-border/50 bg-surface/40 px-2 py-1">
                          <span className="text-[11px]">Area {idx + 1} · {c.pts.length} titik</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[10px]"
                            onClick={() => {
                              const clips = (grid.columnClips ?? []).filter((x) => x.id !== c.id);
                              updateGrid({ columnClips: clips.length ? clips : undefined });
                            }}
                            title="Hapus area"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* ===== Edit Buble (label) ===== */}
            <div className="space-y-1.5 rounded-md border border-border/50 bg-background/30 p-2">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Edit Buble</Label>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Atur buble paling kecil (sudut kiri atas) untuk grid ini. Tombol
                <span className="font-medium text-foreground"> Chain</span> akan menomori ulang
                grid extra lain di level yang sama agar bublenya melanjutkan serial dari grid ini.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Mulai X (angka)</Label>
                  <Input
                    className="h-7 text-xs"
                    type="text"
                    inputMode="numeric"
                    defaultValue={xAxisLabelAt(0, grid.labelOffsetX ?? 0)}
                    onBlur={(e) => {
                      const v = parseXAxisLabel(e.target.value);
                      if (v == null) { e.target.value = xAxisLabelAt(0, grid.labelOffsetX ?? 0); return; }
                      updateGrid({ labelOffsetX: v });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Mulai Y (huruf)</Label>
                  <Input
                    className="h-7 text-xs uppercase"
                    type="text"
                    defaultValue={yAxisLabelAt(0, grid.labelOffsetY ?? 0)}
                    onBlur={(e) => {
                      const v = parseYAxisLabel(e.target.value);
                      if (v == null) { e.target.value = yAxisLabelAt(0, grid.labelOffsetY ?? 0); return; }
                      updateGrid({ labelOffsetY: v });
                    }}
                  />
                </div>
              </div>
              <Button
                size="sm" variant="outline" className="h-7 w-full text-[10px]"
                onClick={() => {
                  // Chain offset ke grid extras lain pada level yang sama (urutan extras).
                  const lvId = grid.fromLevelId ?? activeLvlId ?? undefined;
                  const baseX = (grid.labelOffsetX ?? 0) + grid.spansX.length + 1;
                  const baseY = (grid.labelOffsetY ?? 0) + grid.spansY.length + 1;
                  let accX = baseX;
                  let accY = baseY;
                  // chainKind: kalau grid ini orientasi vertikal (rotasi mendekati 90°/270°),
                  // chain Y; selain itu chain X. Sederhana: pakai X.
                  const next = gridExtras.map((g, i) => {
                    // skip grid ini sendiri (kalau sedang edit extra ke-N)
                    if (editGridIdx > 0 && i === editGridIdx - 1) return g;
                    const same = lvId
                      ? (g.fromLevelId === lvId || g.toLevelId === lvId || (!g.fromLevelId && !g.toLevelId))
                      : true;
                    if (!same) return g;
                    const updated: StructuralGrid = { ...g, labelOffsetX: accX, labelOffsetY: accY };
                    accX += g.spansX.length + 1;
                    accY += g.spansY.length + 1;
                    return updated;
                  });
                  onChange({ structuralGridExtras: next });
                  toast.success("Buble grid extra dichain dari grid ini");
                }}
                title="Setel ulang buble grid extra lain di level yang sama agar melanjutkan serial dari grid ini"
              >
                Chain ke grid extra lain
              </Button>
            </div>
            {/* ===== Sembunyikan Buble ===== */}
            <div className="space-y-1.5 rounded-md border border-border/50 bg-background/30 p-2">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Sembunyikan Buble</Label>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Sembunyikan buble di ujung sumbu agar mudah menyambung grid lain.
              </p>
              {grid.lineOnly ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="flex items-center gap-1.5 text-[11px]">
                    <input type="checkbox" checked={!!grid.hideBubbleStartX}
                      onChange={(e) => updateGrid({ hideBubbleStartX: e.target.checked })} />
                    Ujung Awal
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px]">
                    <input type="checkbox" checked={!!grid.hideBubbleEndX}
                      onChange={(e) => updateGrid({ hideBubbleEndX: e.target.checked })} />
                    Ujung Akhir
                  </label>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-1.5 gap-y-1">
                  <label className="flex items-center gap-1.5 text-[11px]">
                    <input type="checkbox" checked={!!grid.hideBubbleStartY}
                      onChange={(e) => updateGrid({ hideBubbleStartY: e.target.checked })} />
                    X · Atas
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px]">
                    <input type="checkbox" checked={!!grid.hideBubbleEndY}
                      onChange={(e) => updateGrid({ hideBubbleEndY: e.target.checked })} />
                    X · Bawah
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px]">
                    <input type="checkbox" checked={!!grid.hideBubbleStartX}
                      onChange={(e) => updateGrid({ hideBubbleStartX: e.target.checked })} />
                    Y · Kiri
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px]">
                    <input type="checkbox" checked={!!grid.hideBubbleEndX}
                      onChange={(e) => updateGrid({ hideBubbleEndX: e.target.checked })} />
                    Y · Kanan
                  </label>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Dari Level</Label>
                <Select value={grid.fromLevelId ?? ""} onValueChange={(v) => updateGrid({ fromLevelId: v || undefined })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="auto (≥ MDPL 0)" /></SelectTrigger>
                  <SelectContent>
                    {[...levels].sort((a, b) => a.mdpl - b.mdpl).map((lv) => (
                      <SelectItem key={lv.id} value={lv.id}>{lv.name} · {lv.mdpl}m</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Sampai Level</Label>
                <Select value={grid.toLevelId ?? ""} onValueChange={(v) => updateGrid({ toLevelId: v || undefined })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="paling atas" /></SelectTrigger>
                  <SelectContent>
                    {[...levels].sort((a, b) => a.mdpl - b.mdpl).map((lv) => (
                      <SelectItem key={lv.id} value={lv.id}>{lv.name} · {lv.mdpl}m</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {activeLvlId && (
              <div className="space-y-1 border-t border-border/40 pt-2">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Edit level aktif</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-[10px]"
                    onClick={() => updateGridOverride(activeLvlId, { spansX: [...grid.spansX], spansY: [...grid.spansY] })}>
                    <Copy className="mr-1 h-3 w-3" /> Copy grid
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px]"
                    onClick={() => {
                      const np = { ...(grid.perLevel ?? {}) };
                      delete np[activeLvlId];
                      updateGrid({ perLevel: np });
                    }}>
                    <X className="mr-1 h-3 w-3" /> Reset override
                  </Button>
                </div>
              </div>
            )}
            <div className="rounded bg-muted/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
              {(() => {
                const here = computeStructuralStats(grid, levels);
                const all = computeAllStructuralStats(primaryGrid, gridExtras, levels);
                return `Grid ini: ${here.totalColumns} kolom · ${here.concreteVolumeM3.toFixed(2)} m³  ·  Total: ${all.totalColumns} kolom · ${all.concreteVolumeM3.toFixed(2)} m³`;
              })()}
            </div>
          </div>
        )}
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
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                variant={sectionSub === "add" ? "default" : "outline"}
                size="sm"
                onClick={() => setSectionSub("add")}
                className={cn("h-8 px-1.5 text-[11px]", sectionSub === "add" && "bg-foreground text-background")}
                title="Tarik garis baru di kanvas"
              >
                <Scissors className="mr-1 h-3.5 w-3.5" /> Tambah
              </Button>
              <Button
                variant={sectionSub === "geser" ? "default" : "outline"}
                size="sm"
                onClick={() => setSectionSub("geser")}
                className={cn("h-8 px-1.5 text-[11px]", sectionSub === "geser" && "bg-foreground text-background")}
                title="Geser bubble ujung garis potong"
              >
                <Move className="mr-1 h-3.5 w-3.5" /> Geser
              </Button>
              <Button
                variant={sectionSub === "flip" ? "default" : "outline"}
                size="sm"
                onClick={() => setSectionSub("flip")}
                className={cn("h-8 px-1.5 text-[11px]", sectionSub === "flip" && "bg-foreground text-background")}
                title="Balik arah pandang garis potong"
              >
                <FlipHorizontal className="mr-1 h-3.5 w-3.5" /> Flip
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {sectionSub === "add" && <>Tarik garis lurus untuk menentukan bidang irisan. Setiap potongan baru otomatis diberi label berurutan (<span className="font-medium text-foreground">A-A</span>, <span className="font-medium text-foreground">B-B</span>, …) dan menjadi slide tersendiri pada presentasi.</>}
              {sectionSub === "geser" && <>Ketuk &amp; tarik bubble ujung (A / A') untuk menggeser titik garis potong. Label dan slide otomatis ikut menyesuaikan.</>}
              {sectionSub === "flip" && <>Ketuk garis potong atau salah satu bubble ujungnya untuk membalik arah pandang (tukar A ↔ A').</>}
            </p>

            {(sketch.sectionCuts ?? []).length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Daftar Potongan ({(sketch.sectionCuts ?? []).length})
                </div>
                {(sketch.sectionCuts ?? []).map((c, i) => (
                  <div
                    key={`${c.label}-${i}`}
                    className="flex items-center justify-between gap-1.5 rounded border border-border/60 bg-surface/40 px-2 py-1"
                  >
                    <span className="text-[11px] font-medium">{c.label || sectionLabelFor(i)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px]"
                      onClick={() => {
                        const next = (sketch.sectionCuts ?? []).filter((_, idx) => idx !== i);
                        onChange({ sectionCuts: next, sectionCut: undefined });
                      }}
                      title="Hapus potongan ini"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="default"
              size="sm"
              className="h-7 w-full text-[11px] bg-gradient-primary shadow-primary"
              onClick={() => { cancelPendingCurve(); setTool("section"); }}
              title="Tarik garis berikutnya di kanvas — label otomatis (B-B, C-C, …)"
            >
              <Scissors className="mr-1 h-3.5 w-3.5" />
              Tambah Potongan {nextSectionLabel(sketch.sectionCuts ?? [])}
            </Button>
            {(sketch.sectionCuts ?? []).length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full text-[11px]"
                onClick={() => onChange({ sectionCuts: [], sectionCut: undefined })}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Hapus semua potongan
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
                  type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
                  step="0.1"
                  min="0.05"
                  value={filletRadiusM}
                  onChange={(e) => setFilletRadiusM(Math.max(0.05, parseFloat(e.target.value) || 0.05))}
                  className="h-7 w-20 text-xs"
                />
                <span className="text-[11px] text-muted-foreground">m</span>
              </div>
            )}
            {editMode === "move" && (
              <div className="space-y-1.5 rounded-md border border-border/60 bg-background/40 p-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Geser Numerik (mm)
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {selectedEditVertices.length === 0
                      ? "Pilih titik dulu"
                      : selectedEditVertices.length === 1
                      ? `Titik (${(selectedEditVertices[0].coord.x / pxPerMeter * 1000).toFixed(0)}, ${(selectedEditVertices[0].coord.y / pxPerMeter * 1000).toFixed(0)})`
                      : `${selectedEditVertices.length} titik dipilih`}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">ΔX</Label>
                    <Input
                      type="text" inputMode="text" pattern="-?[0-9]*\.?[0-9]*"
                      value={editVxDxMm}
                      onChange={(e) => setEditVxDxMm(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">ΔY</Label>
                    <Input
                      type="text" inputMode="text" pattern="-?[0-9]*\.?[0-9]*"
                      value={editVxDyMm}
                      onChange={(e) => setEditVxDyMm(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="flex-1 bg-gradient-primary shadow-primary"
                    disabled={selectedEditVertices.length === 0}
                    onClick={() => {
                      if (selectedEditVertices.length === 0) return;
                      const dxMm = Number(editVxDxMm) || 0;
                      const dyMm = Number(editVxDyMm) || 0;
                      if (dxMm === 0 && dyMm === 0) {
                        toast.error("Isi ΔX atau ΔY terlebih dahulu");
                        return;
                      }
                      const dxPx = (dxMm / 1000) * pxPerMeter;
                      const dyPx = (dyMm / 1000) * pxPerMeter;
                      const movable = selectedEditVertices.filter((v) => !lockedVertexKeys.has(keyOf(v.coord)));
                      if (movable.length === 0) { toast.error("Semua titik terkunci"); return; }
                      pushHistory();
                      // Batched translation: shift every line endpoint / layer point
                      // whose coord matches any selected vertex by (dxPx, dyPx) in one
                      // onChange. Loop-by-loop moveVertexTarget calls would stomp each
                      // other because the closure's `lines`/`layers` don't refresh until
                      // the next render.
                      const selKeys = new Set(movable.map((v) => keyOf(v.coord)));
                      const nextLines = lines.map((ln) => {
                        if (activeLvlId && ln.levelId !== activeLvlId) return ln;
                        const moveA = selKeys.has(keyOf(ln.a));
                        const moveB = selKeys.has(keyOf(ln.b));
                        if (!moveA && !moveB) return ln;
                        let next: Line = { ...ln };
                        if (moveA) {
                          next.a = { x: ln.a.x + dxPx, y: ln.a.y + dyPx };
                          if (ln.kind === "bezier" && ln.c1) next.c1 = { x: ln.c1.x + dxPx, y: ln.c1.y + dyPx };
                        }
                        if (moveB) {
                          next.b = { x: ln.b.x + dxPx, y: ln.b.y + dyPx };
                          if (ln.kind === "bezier" && ln.c2) next.c2 = { x: ln.c2.x + dxPx, y: ln.c2.y + dyPx };
                        }
                        return next;
                      });
                      const nextLayers = layers.map((l) => {
                        if (activeLvlId && l.levelId !== activeLvlId) return l;
                        let touched = false;
                        const pts = l.points.map((p) => {
                          if (selKeys.has(keyOf(p))) { touched = true; return { x: p.x + dxPx, y: p.y + dyPx }; }
                          return p;
                        });
                        if (!touched) return l;
                        return { ...l, points: pts, areaM2: polygonAreaPx(pts) / (pxPerMeter * pxPerMeter) };
                      });
                      onChange({ lines: nextLines, layers: nextLayers });
                      setSelectedEditVertices((prev) =>
                        prev.map((v) =>
                          lockedVertexKeys.has(keyOf(v.coord))
                            ? v
                            : { target: v.target, coord: { x: v.coord.x + dxPx, y: v.coord.y + dyPx } },
                        ),
                      );
                      setEditVxDxMm("0");
                      setEditVxDyMm("0");
                      toast.success(`${movable.length} titik digeser ΔX ${dxMm}mm, ΔY ${dyMm}mm`);
                    }}
                  >
                    Apply Geser
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedEditVertices.length === 0}
                    onClick={() => setSelectedEditVertices([])}
                  >
                    Reset Pilih
                  </Button>
                </div>
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Klik titik untuk pilih. Shift/Ctrl+klik untuk tambah/buang dari pilihan. Titik terpilih berwarna cyan. Positif ΔX = kanan, positif ΔY = bawah.
                </p>
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
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant={lineSub === "draw" ? "default" : "outline"}
                size="sm"
                onClick={() => { cancelPendingCurve(); setLineSub("draw"); }}
                className={cn("h-8 px-2 text-[11px]", lineSub === "draw" && "bg-foreground text-background")}
                title="Gambar garis baru"
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Gambar
              </Button>
              <Button
                variant={lineSub === "room" ? "default" : "outline"}
                size="sm"
                onClick={() => { cancelPendingCurve(); setDrawing(null); setLineSub("room"); }}
                className={cn("h-8 px-2 text-[11px]", lineSub === "room" && "bg-foreground text-background")}
                title="Klik di dalam area yang dikelilingi garis-garis tertutup untuk mengubahnya menjadi ruang. Garis potong & grid struktur diabaikan."
              >
                <Square className="mr-1 h-3.5 w-3.5" /> Jadikan Ruang
              </Button>
            </div>
            {lineSub === "room" && (
              <p className="rounded-md border border-border/60 bg-background/40 p-2 text-[10px] leading-relaxed text-muted-foreground">
                Ketuk di dalam area yang sudah dikelilingi garis-garis (bertemu atau bersilangan). Sistem akan mencari batas terkecil yang menutup titik klik dan membuatnya menjadi <span className="font-medium text-foreground">Ruang</span>. Garis potong dan grid struktur diabaikan.
              </p>
            )}
          </div>
        )}
        {tool === "line" && lineSub === "draw" && (
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
            <Button size="sm" onClick={commitPendingCurve} className="bg-gradient-primary shadow-primary">
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
          <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Magnet className="h-4 w-4 text-ember" />
                <div>
                  <div className="text-sm font-medium">Snap</div>
                  <div className="text-[11px] text-muted-foreground">Kunci titik ke target terdekat</div>
                </div>
              </div>
              <Switch checked={snap} onCheckedChange={(v) => onChange({ snap: v })} />
            </div>
            {snap && (
              <div className="ml-6 space-y-1.5 border-l border-border/40 pl-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs">Grid (kotak milimeter)</div>
                  <Switch checked={true} disabled />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs">Vertex (titik)</div>
                  <Switch checked={snapVertex} onCheckedChange={(v) => onChange({ snapVertex: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs">Midpoint (tengah segmen)</div>
                  <Switch checked={snapMidpoint} onCheckedChange={(v) => onChange({ snapMidpoint: v })} />
                </div>
              </div>
            )}
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
              tool === "line" || tool === "rect" || tool === "polyline" || tool === "section" || tool === "separasi" || tool === "circle" || tool === "parking" ? "cursor-crosshair" : tool === "edit" ? "cursor-move" : "cursor-pointer",
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
            className={cn(tool === "line" && "bg-gradient-primary shadow-primary")}
            title="Garis"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "rect" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("rect"); }}
            className={cn(tool === "rect" && "bg-gradient-primary shadow-primary")}
            title="Persegi (tarik diagonal)"
          >
            <Square className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "polyline" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setPolyDraft(null); setTool("polyline"); }}
            className={cn(tool === "polyline" && "bg-gradient-primary shadow-primary")}
            title="Polyline (tarik tanpa jeda, berbelok = titik baru)"
          >
            <Waypoints className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "edit" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("edit"); }}
            className={cn(tool === "edit" && "bg-gradient-primary shadow-primary")}
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
            className={cn(tool === "section" && "bg-gradient-primary shadow-primary")}
            title="Garis Potong (tarik garis → slide potongan dibuat; label berurutan A-A, B-B, …)"
          >
            <Scissors className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "separasi" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("separasi"); }}
            className={cn(tool === "separasi" && "bg-gradient-primary shadow-primary")}
            title="Separasi Ruang (tarik garis tepi-ke-tepi → ruang terbelah dua)"
          >
            <SplitSquareHorizontal className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "circle" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("circle"); }}
            className={cn(tool === "circle" && "bg-gradient-primary shadow-primary")}
            title="Lingkaran (tap pusat, geser radius)"
          >
            <CircleIcon className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "trim" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("trim"); }}
            className={cn(tool === "trim" && "bg-gradient-primary shadow-primary")}
            title="Trim / Extend (tap garis dekat ujung)"
          >
            <Crop className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "offset" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("offset"); }}
            className={cn(tool === "offset" && "bg-gradient-primary shadow-primary")}
            title="Offset (tap garis pada sisi tujuan)"
          >
            <MoveHorizontal className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "parking" && parkingKind === "mobil" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("parking"); setParkingKind("mobil"); setParkingSubTool("draw"); setParkingSelectedId(null); }}
            className={cn(tool === "parking" && parkingKind === "mobil" && "bg-gradient-primary shadow-primary")}
            title="Lot Parkir Mobil (2.4×5 m)"
          >
            <Car className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "parking" && parkingKind === "motor" ? "default" : "ghost"}
            size="sm"
            onClick={() => { cancelPendingCurve(); setTool("parking"); setParkingKind("motor"); setParkingSubTool("draw"); setParkingSelectedId(null); }}
            className={cn(tool === "parking" && parkingKind === "motor" && "bg-gradient-primary shadow-primary")}
            title="Lot Parkir Motor (0.75×2 m)"
          >
            <span className="text-[10px] font-semibold">MTR</span>
          </Button>
          {tool === "parking" && (
            <ParkingSubToolbarMobile
              parkingKind={parkingKind}
              sub={parkingSubTool}
              setSub={setParkingSubTool}
              selectedId={parkingSelectedId}
              clipboardSize={parkingClipboard?.length ?? 0}
              orientation={
                ((sketch.parkingAreas ?? []).find((a) => a.id === parkingSelectedId)?.orientation ?? "auto")
              }
              onOrientation={(o) => {
                if (!parkingSelectedId) { toast.error("Pilih area parkir dulu"); return; }
                pushHistory();
                onChange({
                  parkingAreas: (sketch.parkingAreas ?? []).map((a) =>
                    a.id === parkingSelectedId ? { ...a, orientation: o } : a,
                  ),
                });
              }}
              onCopy={() => {
                if (!parkingSelectedId) { toast.error("Pilih area parkir dulu"); return; }
                const sel = (sketch.parkingAreas ?? []).find((a) => a.id === parkingSelectedId);
                if (!sel) return;
                setParkingClipboard([{ ...sel, levelId: undefined }]);
                toast.success("Disalin");
              }}
              onPaste={() => {
                if (!parkingClipboard || parkingClipboard.length === 0) { toast.error("Clipboard kosong"); return; }
                pushHistory();
                const pasted: ParkingArea[] = parkingClipboard.map((a) => ({
                  ...a,
                  id: genParkingId(),
                  levelId: activeLvlId ?? undefined,
                  pointsLocal: a.pointsLocal.map((q) => ({ x: q.x + 32, y: q.y + 32 })),
                  paths: (a.paths ?? []).map((p) => ({
                    id: genParkingPathId(),
                    pointsLocal: p.pointsLocal.map((q) => ({ x: q.x + 32, y: q.y + 32 })),
                  })),
                }));
                onChange({ parkingAreas: [...(sketch.parkingAreas ?? []), ...pasted] });
                setParkingSelectedId(pasted[0]?.id ?? null);
                toast.success("Ditempel");
              }}
              onDelete={() => {
                if (!parkingSelectedId) { toast.error("Pilih area parkir dulu"); return; }
                pushHistory();
                onChange({
                  parkingAreas: (sketch.parkingAreas ?? []).filter((a) => a.id !== parkingSelectedId),
                });
                setParkingSelectedId(null);
                toast.success("Dihapus");
              }}
              hasDraft={!!parkingDraft}
              onSaveDraft={() => {
                if (!parkingDraft) return;
                pushHistory();
                const newArea = { ...parkingDraft, levelId: activeLvlId ?? parkingDraft.levelId };
                onChange({ parkingAreas: [...(sketch.parkingAreas ?? []), newArea] });
                setParkingSelectedId(newArea.id);
                setParkingDraft(null);
                setParkingSubTool("move");
                toast.success("Tersimpan");
              }}
              onCancelDraft={() => { setParkingDraft(null); }}
              hasPathDraft={!!parkingPathDraft}
              pathDraftCount={parkingPathDraft?.points.length ?? 0}
              onSavePathDraft={() => {
                if (!parkingPathDraft || parkingPathDraft.points.length < 2) {
                  toast.error("Butuh ≥ 2 titik");
                  return;
                }
                pushHistory();
                const newPath: ParkingPath = {
                  id: genParkingPathId(),
                  pointsLocal: parkingPathDraft.points.map((p) => ({ x: p.x, y: p.y })),
                };
                onChange({
                  parkingAreas: (sketch.parkingAreas ?? []).map((a) =>
                    a.id === parkingPathDraft.areaId
                      ? { ...a, paths: [...(a.paths ?? []), newPath] }
                      : a,
                  ),
                });
                setParkingPathDraft(null);
                toast.success("Jalur tersimpan");
              }}
              onCancelPathDraft={() => { setParkingPathDraft(null); }}
            />

          )}
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
              <Button size="sm" onClick={commitPendingCurve} className="bg-gradient-primary shadow-primary">
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
          className="absolute right-4 top-4 z-10 w-[400px] max-w-[90vw]"
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        <div className="flex min-w-0 flex-col gap-4">
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
                tool === "line" || tool === "rect" || tool === "polyline" || tool === "section" || tool === "separasi" || tool === "circle" || tool === "parking" ? "cursor-crosshair" : tool === "edit" ? "cursor-move" : "cursor-pointer",
              )}
            />
            <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/80 px-2.5 py-1 shadow-soft backdrop-blur">
              <div className="font-display text-xs font-semibold">
                {activeLvlId && (() => {
                  const lvl = levels.find((l) => l.id === activeLvlId);
                  return lvl ? (
                    <span className="text-ember">{lvl.name}</span>
                  ) : null;
                })()}
                {activeLvlId && <span className="mx-1.5 text-border">·</span>}
                <span className="text-foreground">Skala {scale} • 1 kotak besar = {METERS_PER_MAJOR[scale]} m</span>
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-background/85 p-1.5 shadow-soft backdrop-blur">
              <CompassMarker rotation={northRotation} size={64} />
            </div>
          </div>
          {mode === "masterplan" && <MasterplanSketch3DPreview sketch={sketch as any} />}
        </div>
        {SidePanel}
      </div>
      {RekapPanel}
      {mode === "masterplan" ? (
        <MasterplanClusterDialog
          open={clusterOpen}
          onOpenChange={setClusterOpen}
          existingPlan={loadMpPlan()}
          sitePolygon={(() => {
            const lah = layers.find((l) => isLahanLayerName(l.name) && l.points.length >= 3);
            if (!lah) return undefined;
            return lah.points.map((p) => ({ x: p.x / pxPerMeter, y: p.y / pxPerMeter }));
          })()}
          avoidAxes={(() => {
            const axs = sketch.axes ?? [];
            if (axs.length === 0) return undefined;
            return axs.map((ax) => ({
              points: sampleAxisPolyline(ax).map((p) => ({ x: p.x / pxPerMeter, y: p.y / pxPerMeter })),
              bufferM: ax.bufferM,
            }));
          })()}
          roads={(() => {
            const rds = sketch.roads ?? [];
            if (rds.length === 0) return undefined;
            return rds.map((rd) => ({
              center: roadCenterline(rd).map((p) => ({ x: p.x / pxPerMeter, y: p.y / pxPerMeter })),
              widthM: rd.widthM,
            }));
          })()}
          onCommit={(blocks) => {
            // Convert MassingBlock polygons into sketch layers in the active sketch.
            const lvId = activeLvlId ?? levels[0]?.id;
            if (!lvId) {
              toast.error("Tidak ada level aktif untuk menampung hasil cluster.");
              return;
            }
            const ppm = pxPerMeter;
            const newLayers: Layer[] = blocks.map((b, i) => {
              const poly = mpBlockPolygon(b);
              const pts: Point[] = poly.map((p) => ({ x: p.x * ppm, y: p.y * ppm }));
              return {
                id: `L${Date.now().toString(36)}_mp${i}_${Math.random().toString(36).slice(2, 5)}`,
                name: b.name,
                points: pts,
                areaM2: 0,
                color: MP_FN_META[b.fn].color,
                levelId: lvId,
              } as Layer;
            });
            onChange({ layers: [...layers, ...newLayers] });
            try {
              const plan = loadMpPlan();
              saveMpPlan({ ...plan, blocks: [...plan.blocks, ...blocks] });
            } catch {}
            toast.success(`Menambahkan ${newLayers.length} massa dari Cluster Generator.`);
          }}
        />
      ) : (
        <ClusterGeneratorDialog
          open={clusterOpen}
          onOpenChange={setClusterOpen}
          levels={[...levels].sort((a, b) => a.mdpl - b.mdpl).map((l) => ({ id: l.id, name: l.name }))}
          graph={sketch.clusterGraph ?? { nodes: [], links: [] }}
          onSave={(g: ClusterGraph) => onChange({ clusterGraph: g })}
          pxPerMeter={pxPerMeter}
          kdbLimitM2={(kdbPct ?? 0) > 0 && totalLahanM2 > 0 ? (kdbPct! / 100) * totalLahanM2 : undefined}
          klbLimitM2={(klbCoef ?? 0) > 0 && totalLahanM2 > 0 ? klbCoef! * totalLahanM2 : undefined}
          onGenerate={handleClusterGenerate}
        />
      )}
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
  const normalizeMdplDraft = (value: string) => value.replace(/[−–—]/g, "-").replace(/\s+/g, "");
  const isValidMdplDraft = (value: string) => value === "" || /^-?\d*([.,]\d*)?$/.test(value);
  const commitMdplDraft = (lvlId: string, fallback: number, rawValue?: string) => {
    const raw = normalizeMdplDraft(rawValue ?? mdplDrafts[lvlId] ?? String(fallback));
    const v = Number.parseFloat(raw.replace(",", "."));
    if (Number.isFinite(v)) onMdpl(lvlId, v);
    setMdplDrafts((d) => {
      const n = { ...d };
      delete n[lvlId];
      return n;
    });
  };

  const displayNames = computeLevelDisplayNames(levels, layers);
  const sorted = [...levels].sort((a, b) => b.mdpl - a.mdpl); // tertinggi di atas

  // Slider — batasi tinggi area daftar level agar tidak terlalu panjang ke bawah.
  const [listMaxH, setListMaxH] = useState<number>(560);
  const showSlider = levels.length > 4;
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

      {showSlider && (
        <div className="flex items-center gap-2 px-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Tinggi</span>
          <input
            type="range"
            min={200}
            max={1400}
            step={20}
            value={listMaxH}
            onChange={(e) => setListMaxH(Number(e.target.value))}
            className="flex-1 accent-ember"
            aria-label="Atur tinggi area daftar level"
          />
          <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">{listMaxH}px</span>
        </div>
      )}

      <ul
        className="space-y-2 overflow-y-auto pr-1"
        style={{ maxHeight: `${listMaxH}px` }}
      >
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
                  type="text"
                  inputMode="text"
                  pattern="-?[0-9]*[.,]?[0-9]*"
                  value={mdplDraft ?? String(lvl.mdpl)}
                  onChange={(e) => {
                    const raw = normalizeMdplDraft(e.target.value);
                    // Izinkan nilai sementara seperti "-" agar basement (MDPL negatif) bisa diketik.
                    if (isValidMdplDraft(raw)) {
                      setMdplDrafts((d) => ({ ...d, [lvl.id]: raw }));
                    }
                  }}
                  onBlur={(e) => commitMdplDraft(lvl.id, lvl.mdpl, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitMdplDraft(lvl.id, lvl.mdpl, e.currentTarget.value);
                    if (e.key === "Escape") {
                      setMdplDrafts((d) => {
                        const n = { ...d };
                        delete n[lvl.id];
                        return n;
                      });
                    }
                  }}
                  className="h-7 w-20 text-sm"
                />
                <span className="text-[11px] text-muted-foreground">m</span>
                {(lvl.typicalCount ?? 1) > 1 && (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-ember/80">×</span>
                    <Input
                      type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
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
                      type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
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
                              style={{ background: (colorForRoomName(sl.name) ?? sl.color).replace("ALPHA", "0.9") }}
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
                                              type="text" inputMode="decimal" pattern="-?[0-9]*\.?[0-9]*"
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

// ============================================================
// Floor Tool — panel sidebar untuk pembuat lantai (slab 150mm)
// ============================================================
function FloorToolPanel({
  mode,
  onMode,
  draft,
  level,
  onCommit,
  onCancel,
  editSub,
  onEditSub,
  floorsInLevel,
  clipboardCount,
  onCopyFloors,
  onPasteFloors,
  onDeleteFloors,
  selectedFloorVertex,
  selectedFloorVertexCount,
  onClearFloorSelection,
  floorVxDxMm,
  floorVxDyMm,
  onFloorVxDxMm,
  onFloorVxDyMm,
  pxPerMeter,
  onApplyFloorVertexMove,
}: {
  mode: FloorMode;
  onMode: (m: FloorMode) => void;
  draft: { outer: Point[] | null; holes: Point[][]; replaceFloorId?: string } | null;
  level: Level | null;
  onCommit: () => void;
  onCancel: () => void;
  editSub: "move" | "add" | "delete" | "addVoid";
  onEditSub: (s: "move" | "add" | "delete" | "addVoid") => void;
  floorsInLevel: Floor[];
  clipboardCount: number;
  onCopyFloors: () => void;
  onPasteFloors: () => void;
  onDeleteFloors: () => void;
  selectedFloorVertex: { fid: string; ring: "outer" | number; idx: number; coord: Point } | null;
  selectedFloorVertexCount: number;
  onClearFloorSelection: () => void;
  floorVxDxMm: string;
  floorVxDyMm: string;
  onFloorVxDxMm: (v: string) => void;
  onFloorVxDyMm: (v: string) => void;
  pxPerMeter: number;
  onApplyFloorVertexMove: () => void;
}) {
  const hasOuter = !!(draft && draft.outer && draft.outer.length >= 3);
  const holeCount = draft?.holes?.length ?? 0;
  const isReplace = !!draft?.replaceFloorId;
  const canCopy = floorsInLevel.length > 0;
  const canDelete = floorsInLevel.length > 0;
  const canPaste = clipboardCount > 0;
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Alat Lantai — slab {FLOOR_THICKNESS_MM} mm ↓
        </Label>
        <span className="text-[10px] text-muted-foreground">
          {level ? `${level.name} · MDPL ${level.mdpl.toFixed(2)} m` : "Tanpa level"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {(
          [
            { id: "rect", label: "Persegi", hint: "Drag dua sudut diagonal" },
            { id: "line", label: "Garis", hint: "Klik dua titik tiap segmen, dobel-klik tutup" },
            { id: "polyline", label: "Polyline", hint: "Klik banyak titik, dobel-klik tutup" },
            { id: "arc", label: "Lengkung", hint: "Klik titik-titik; tiap segmen jadi busur. Tutup di titik awal" },
            { id: "bezier", label: "Tangent", hint: "Klik titik-titik; tiap segmen jadi kurva bezier. Tutup di titik awal" },
            { id: "attach", label: "Attach Garis", hint: "Klik segmen perimeter (outer), lalu segmen lubang (void)" },
            { id: "edit", label: "Edit Titik", hint: "Geser / tambah / hapus titik pada lantai existing" },
          ] as { id: FloorMode; label: string; hint: string }[]
        ).map((m) => (
          <Button
            key={m.id}
            variant={mode === m.id ? "default" : "outline"}
            size="sm"
            className={cn("h-8 text-xs", mode === m.id && "bg-gradient-primary shadow-primary")}
            onClick={() => onMode(m.id)}
            title={m.hint}
          >
            {m.label}
          </Button>
        ))}
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        {mode === "attach"
          ? "Klik segmen pada perimeter terluar untuk men-set outer; klik segmen poligon di dalamnya untuk menambah void."
          : mode === "edit"
          ? "Pilih sub-mode. Geser: tarik titik. Tambah Titik: klik tepi. Hapus Titik: klik titik untuk dihapus. + Void: klik titik-titik di dalam lantai, tutup di titik awal untuk membentuk void."
          : mode === "rect"
          ? "Drag persegi sebagai area. Drag persegi kedua di dalamnya untuk void. Tekan Simpan Area untuk finalisasi."
          : mode === "arc"
          ? "Klik titik-titik — tiap segmen dibentuk sebagai busur otomatis. Tutup di titik awal, lalu tekan Simpan Area."
          : mode === "bezier"
          ? "Klik titik-titik — tiap segmen dibentuk sebagai kurva bezier dengan tangent otomatis. Tutup di titik awal, lalu tekan Simpan Area."
          : "Klik titik-titik membentuk poligon, tutup di titik awal. Tekan Simpan Area untuk finalisasi."}
      </p>

      {mode === "edit" && (
        <div className="grid grid-cols-4 gap-1.5">
          <Button
            size="sm"
            variant={editSub === "move" ? "default" : "outline"}
            className={cn("h-8 text-[11px]", editSub === "move" && "bg-gradient-primary shadow-primary")}
            onClick={() => onEditSub("move")}
          >
            Geser
          </Button>
          <Button
            size="sm"
            variant={editSub === "add" ? "default" : "outline"}
            className={cn("h-8 text-[11px]", editSub === "add" && "bg-gradient-primary shadow-primary")}
            onClick={() => onEditSub("add")}
          >
            Tambah
          </Button>
          <Button
            size="sm"
            variant={editSub === "delete" ? "default" : "outline"}
            className={cn("h-8 text-[11px]", editSub === "delete" && "bg-destructive text-destructive-foreground")}
            onClick={() => onEditSub("delete")}
          >
            Hapus
          </Button>
          <Button
            size="sm"
            variant={editSub === "addVoid" ? "default" : "outline"}
            className={cn("h-8 text-[11px]", editSub === "addVoid" && "bg-amber-500 text-white hover:bg-amber-600")}
            onClick={() => onEditSub("addVoid")}
            title="Klik titik-titik di dalam lantai untuk membentuk void. Tutup di titik awal."
          >
            + Void
          </Button>
        </div>
      )}

      {mode === "edit" && editSub === "move" && (
        <div className="space-y-1.5 rounded-md border border-border/40 bg-surface/30 p-2">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Geser Numerik (mm)
            </Label>
            <span className="text-[10px] text-muted-foreground">
              {selectedFloorVertexCount === 0
                ? "Pilih titik dulu"
                : selectedFloorVertexCount === 1 && selectedFloorVertex
                ? `Titik (${(selectedFloorVertex.coord.x / pxPerMeter * 1000).toFixed(0)}, ${(selectedFloorVertex.coord.y / pxPerMeter * 1000).toFixed(0)})`
                : `${selectedFloorVertexCount} titik dipilih`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label className="text-[10px] text-muted-foreground">ΔX</Label>
              <Input
                type="text" inputMode="text" pattern="-?[0-9]*\.?[0-9]*"
                value={floorVxDxMm}
                onChange={(e) => onFloorVxDxMm(e.target.value)}
                className="h-8 text-xs"
                placeholder="0"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">ΔY</Label>
              <Input
                type="text" inputMode="text" pattern="-?[0-9]*\.?[0-9]*"
                value={floorVxDyMm}
                onChange={(e) => onFloorVxDyMm(e.target.value)}
                className="h-8 text-xs"
                placeholder="0"
              />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="flex-1 bg-gradient-primary shadow-primary"
              disabled={selectedFloorVertexCount === 0}
              onClick={onApplyFloorVertexMove}
            >
              Apply Geser
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedFloorVertexCount === 0}
              onClick={onClearFloorSelection}
            >
              Reset Pilih
            </Button>
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Klik titik untuk pilih. Shift/Ctrl+klik untuk tambah/buang. Titik terpilih berwarna cyan. Positif ΔX = kanan, positif ΔY = bawah.
          </p>
        </div>
      )}

      {mode !== "edit" && (
        <div className="rounded-sm bg-background/60 p-2 text-[10px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              Area: <span className={cn(hasOuter ? "text-ember" : "text-muted-foreground")}>{hasOuter ? "Siap" : "—"}</span>
            </span>
            <span className="text-muted-foreground">
              Void: {holeCount}{isReplace ? " · update lantai" : ""}
            </span>
          </div>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" className="h-7 flex-1 text-[10px]" disabled={!hasOuter} onClick={onCommit}>
              <Check className="mr-1 h-3 w-3" /> Simpan Area
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={!hasOuter} onClick={onCancel}>
              <X className="mr-1 h-3 w-3" /> Batal
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5 border-t border-border/60 pt-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canCopy}
          onClick={onCopyFloors}
          className="h-7 text-[10px]"
          title="Salin semua lantai di level aktif"
        >
          <Copy className="mr-1 h-3 w-3" /> Copy
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canPaste}
          onClick={onPasteFloors}
          className="h-7 text-[10px]"
          title="Tempel lantai pada koordinat X/Y yang sama di level aktif"
        >
          <ClipboardPaste className="mr-1 h-3 w-3" /> Paste
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canDelete}
          onClick={onDeleteFloors}
          className="h-7 text-[10px] text-destructive hover:text-destructive"
          title="Hapus semua lantai di level aktif"
        >
          <X className="mr-1 h-3 w-3" /> Hapus
        </Button>
      </div>
      <p className="text-[9px] text-muted-foreground">
        {floorsInLevel.length} lantai di level ini · clipboard: {clipboardCount}
      </p>
    </div>
  );
}
