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
};

type Level = {
  id: string;
  name: string;
  mdpl: number;
  opacity: number; // 0..1 — opacity ketika level ini tidak aktif
};

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

type EditorProps = {
  sketch: Sketch;
  onChange: (patch: Partial<Sketch>) => void;
  fullscreen: boolean;
  onExitFullscreen?: () => void;
};

function SketchEditor({ sketch, onChange, fullscreen, onExitFullscreen }: EditorProps) {
  const { id, scale, snap, lines, layers, levels, activeLevelId, kdbPct, klbCoef } = sketch;
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const [tool, setTool] = useState<"line" | "rect" | "erase" | "edit">("line");
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
  const [editDrag, setEditDrag] = useState<{ key: string } | null>(null);
  const [editHover, setEditHover] = useState<Point | null>(null);
  const [editMode, setEditMode] = useState<"move" | "addPoint">("move");
  const [addPointPreview, setAddPointPreview] = useState<Point | null>(null);

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
        ctx.fillStyle = layer.color.replace("ALPHA", layer.locked ? "0.4" : "0.28");
        ctx.fill();
        ctx.strokeStyle = layer.color.replace("ALPHA", "0.95");
        ctx.lineWidth = (layer.locked ? 3 : 2.5) / s;
        ctx.stroke();
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

    // Edit-mode vertex markers (all unique vertices, highlighted)
    if (tool === "edit") {
      const seen = new Set<string>();
      const verts: { p: Point; locked: boolean }[] = [];
      const lockedKeys = new Set<string>();
      layers.forEach((l) => {
        if (!l.locked) return;
        l.points.forEach((p) => lockedKeys.add(keyOf(p)));
      });
      const pushVert = (p: Point) => {
        const k = keyOf(p);
        if (seen.has(k)) return;
        seen.add(k);
        verts.push({ p, locked: lockedKeys.has(k) });
      };
      lines.forEach((ln) => { pushVert(ln.a); pushVert(ln.b); });
      layers.forEach((l) => l.points.forEach(pushVert));
      verts.forEach((v) => {
        ctx.beginPath();
        ctx.arc(v.p.x, v.p.y, 6 / s, 0, Math.PI * 2);
        ctx.fillStyle = v.locked ? "rgba(120,120,120,0.85)" : "#fff";
        ctx.fill();
        ctx.lineWidth = 2 / s;
        ctx.strokeStyle = v.locked ? "#666" : "rgba(232,93,58,1)";
        ctx.stroke();
      });
      if (editHover) {
        ctx.beginPath();
        ctx.arc(editHover.x, editHover.y, 10 / s, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(232,93,58,0.9)";
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
      const nameText = layer.locked ? `🔒 ${layer.name}` : layer.name;
      const areaText = `${layer.areaM2.toFixed(2)} m²`;
      ctx.font = "600 13px Manrope, sans-serif";
      const nameW = ctx.measureText(nameText).width;
      ctx.font = "700 12px Manrope, sans-serif";
      const areaW = ctx.measureText(areaText).width;
      const boxW = Math.max(nameW, areaW) + 16;
      const boxH = 38;
      ctx.fillStyle = "rgba(26,26,26,0.92)";
      ctx.fillRect(sp.x - boxW / 2, sp.y - boxH / 2, boxW, boxH);
      ctx.fillStyle = "#fff";
      ctx.font = "600 13px Manrope, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(nameText, sp.x, sp.y - 3);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "700 12px Manrope, sans-serif";
      ctx.fillText(areaText, sp.x, sp.y + 14);
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
  }, [size, lines, drawing, hover, layers, tool, lineKind, pendingCurve, pxPerMeter, isLineLocked, view, editHover, addPointPreview, levels, activeLvlId]);

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
          nextLayers = [...layers, layer];
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
    [lines, layers, levels, activeLvlId, pxPerMeter, pushHistory, onChange, ensureLevels],
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
      const patch: Partial<Sketch> = {
        lines: [...lines, ...newLines],
        layers: [...layers, layer],
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
    [lines, layers, levels, activeLvlId, pxPerMeter, pushHistory, onChange, ensureLevels],
  );

  // Find nearest vertex (line endpoint or layer point) within tolerance
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
        consider(ln.a);
        consider(ln.b);
      });
      layers.forEach((l) => l.points.forEach(consider));
      return best;
    },
    [lines, layers],
  );

  const lockedVertexKeys = useMemo(() => {
    const s = new Set<string>();
    layers.forEach((l) => {
      if (!l.locked) return;
      l.points.forEach((p) => s.add(keyOf(p)));
    });
    return s;
  }, [layers]);

  // Move every vertex matching origKey to newPos. Returns next state.
  const moveVertexBy = useCallback(
    (origKey: string, newPos: Point) => {
      const nextLines = lines.map((ln) => {
        let next = ln;
        if (keyOf(ln.a) === origKey) next = { ...next, a: newPos };
        if (keyOf(ln.b) === origKey) next = { ...next, b: newPos };
        // Bezier handles: shift relative to their endpoint move
        if (next !== ln && next.kind === "bezier") {
          if (keyOf(ln.a) === origKey && ln.c1) {
            next = { ...next, c1: { x: ln.c1.x + (newPos.x - ln.a.x), y: ln.c1.y + (newPos.y - ln.a.y) } };
          }
          if (keyOf(ln.b) === origKey && ln.c2) {
            next = { ...next, c2: { x: ln.c2.x + (newPos.x - ln.b.x), y: ln.c2.y + (newPos.y - ln.b.y) } };
          }
        }
        return next;
      });
      const nextLayers = layers.map((l) => {
        let changed = false;
        const pts = l.points.map((pt) => {
          if (keyOf(pt) === origKey) {
            changed = true;
            return newPos;
          }
          return pt;
        });
        if (!changed) return l;
        return { ...l, points: pts, areaM2: polygonAreaPx(pts) / (pxPerMeter * pxPerMeter) };
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
    if (tool === "line" || tool === "rect") {
      setDrawing({ a: p, b: p });
    } else if (tool === "edit") {
      const raw = getWorldPosRaw(e);
      const tol = 14 / view.s;
      if (editMode === "addPoint") {
        // Find nearest straight line within tolerance and split there
        const tolPx = 12 / view.s;
        let bestIdx = -1;
        let bestD = Infinity;
        let bestProj: Point | null = null;
        lines.forEach((ln, i) => {
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
      const v = findVertexAt(raw, tol);
      if (!v) return;
      const k = keyOf(v);
      if (lockedVertexKeys.has(k)) {
        toast.error("Titik terkunci");
        return;
      }
      pushHistory();
      setEditDrag({ key: k });
    } else if (tool === "erase") {
      const hitLayer = [...layers].reverse().find((l) => pointInPolygon(p, l.points));
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
        const hitLocked = lines.find((ln) => isLineLocked(ln) && pointToLine(p, ln) <= tol);
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
      moveVertexBy(editDrag.key, newPos);
      setEditDrag({ key: keyOf(newPos) });
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
          if ((ln.kind ?? "straight") !== "straight") return;
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
    onChange({
      layers: layers.map((l) => (l.id === lid ? { ...l, name: final } : l)),
    });
    if (final.toLowerCase().startsWith("lahan"))
      toast.success(`${final} ditandai sebagai acuan KDB/KLB`);
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

  const isLahanName = (n: string) => n.trim().toLowerCase().startsWith("lahan");
  const totalLengthM = lines.reduce((s, l) => s + lineLengthPx(l), 0) / pxPerMeter;
  const totalAreaM2 = layers.reduce((s, l) => s + l.areaM2, 0);
  const lahanLayers = layers.filter((l) => isLahanName(l.name));
  const totalLahanM2 = lahanLayers.reduce((s, l) => s + l.areaM2, 0);

  // Rekapitulasi panel (rendered below canvas in normal mode, inside SidePanel in fullscreen)
  const RekapPanel = (() => {
    const groundLevel = [...levels].sort((a, b) => a.mdpl - b.mdpl)[0];
    const ruangLayers = layers.filter((l) => !isLahanName(l.name));
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
        </div>
        {tool === "rect" && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Tarik diagonal untuk membentuk persegi/persegi panjang. Ruang otomatis terbentuk.
          </p>
        )}
        {tool === "edit" && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant={editMode === "move" ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode("move")}
                className={cn("h-8 px-2 text-[11px]", editMode === "move" && "bg-foreground text-background")}
                title="Geser titik yang sudah ada"
              >
                <Move className="mr-1 h-3.5 w-3.5" /> Geser
              </Button>
              <Button
                variant={editMode === "addPoint" ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode("addPoint")}
                className={cn("h-8 px-2 text-[11px]", editMode === "addPoint" && "bg-foreground text-background")}
                title="Tambah titik baru di sepanjang garis"
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Tambah Titik
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {editMode === "move"
                ? "Tarik titik (vertex) ke posisi baru. Titik milik layer terkunci tidak dapat digeser."
                : "Ketuk di sepanjang garis lurus untuk menambah titik baru yang dapat digeser."}
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
            onRenameLayer={renameLayer}
            onToggleLockLayer={toggleLock}
            onRemoveLayer={removeLayer}
            onSetLayerCoefficient={setLayerCoefficient}
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
              tool === "line" || tool === "rect" ? "cursor-crosshair" : tool === "edit" ? "cursor-move" : "cursor-pointer",
            )}
          />
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
              tool === "line" || tool === "rect" ? "cursor-crosshair" : tool === "edit" ? "cursor-move" : "cursor-pointer",
            )}
          />
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/80 px-2.5 py-1 font-display text-xs font-semibold text-foreground shadow-soft backdrop-blur">
            Skala {scale} • 1 kotak besar = {METERS_PER_MAJOR[scale]} m
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
  onRenameLayer,
  onToggleLockLayer,
  onRemoveLayer,
  onSetLayerCoefficient,
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
  onRenameLayer: (id: string, name: string) => void;
  onToggleLockLayer: (id: string) => void;
  onRemoveLayer: (id: string) => void;
  onSetLayerCoefficient: (id: string, coef: number) => void;
  lines: Line[];
  layers: Layer[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [mdplDrafts, setMdplDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [layerEditId, setLayerEditId] = useState<string | null>(null);
  const [layerDraft, setLayerDraft] = useState("");
  const isLahanName = (n: string) => n.trim().toLowerCase().startsWith("lahan");

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
                      setDraftName(lvl.name);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-ember"
                    title="Klik untuk ganti nama"
                  >
                    {lvl.name}
                  </button>
                )}
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
                  className="h-7 w-24 text-sm"
                />
                <span className="text-[11px] text-muted-foreground">m</span>
                <span
                  className="ml-auto font-display text-[11px] font-semibold text-foreground"
                  title="Total luas ruang di level ini (tanpa lahan, sudah dikalikan koefisien)"
                >
                  {subLayers
                    .filter((ly) => !isLahanName(ly.name))
                    .reduce((s, ly) => s + ly.areaM2 * (ly.coefficient ?? 1), 0)
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
                              "flex items-center gap-1.5 rounded px-1.5 py-1 text-[12px] hover:bg-background/60",
                              lahan && "bg-ember/5",
                              sl.locked && "ring-1 ring-foreground/15",
                            )}
                            title={sl.name}
                          >
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
