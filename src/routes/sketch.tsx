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
};
type Scale = "1:100" | "1:200" | "1:500" | "1:1000";

type Layer = {
  id: string;
  name: string;
  points: Point[];
  areaM2: number;
  color: string;
  locked?: boolean;
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
  return {
    id: `S${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: `Sketsa ${idx}`,
    createdAt: now,
    updatedAt: now,
    scale: "1:100",
    snap: true,
    lines: [],
    layers: [],
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
          setSketches(s.sketches);
          setOpenId(s.openId ?? s.sketches[0]?.id ?? null);
          setLoaded(true);
          return;
        }
      }
      // Migrate legacy single-sketch
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const ls = JSON.parse(legacy);
        const migrated: Sketch = {
          id: `S${Date.now()}`,
          title: ls.title ?? "Sketsa 1",
          createdAt: ls.createdAt ?? Date.now(),
          updatedAt: ls.updatedAt ?? Date.now(),
          scale: ls.scale ?? "1:100",
          snap: ls.snap ?? true,
          lines: Array.isArray(ls.lines) ? ls.lines : [],
          layers: Array.isArray(ls.layers) ? ls.layers : [],
        };
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
  const { id, scale, snap, lines, layers } = sketch;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const [tool, setTool] = useState<"line" | "erase">("line");
  const [lineKind, setLineKind] = useState<LineKind>("straight");
  const [drawing, setDrawing] = useState<{ a: Point; b: Point } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  // Pending bezier curve (after endpoints set, awaiting tangent adjustment + commit)
  const [pendingCurve, setPendingCurve] = useState<
    | { a: Point; b: Point; c1: Point; c2: Point }
    | null
  >(null);
  const [draggingHandle, setDraggingHandle] = useState<null | "c1" | "c2">(null);

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

    // Layers
    layers.forEach((layer) => {
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
    for (const ln of lines) {
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
    for (const ln of lines) {
      for (const p of [ln.a, ln.b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 / s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Active drawing preview (during drag)
    if (drawing) {
      ctx.strokeStyle = "rgba(232, 93, 58, 0.9)";
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.beginPath();
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
      ctx.setLineDash([]);
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
  }, [size, lines, drawing, hover, layers, tool, lineKind, pendingCurve, pxPerMeter, isLineLocked, view]);

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
      const nextLines = [...lines, newLine];
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
          };
          nextLayers = [...layers, layer];
          toast.success(`${layer.name} terbentuk — ${areaM2.toFixed(2)} m²`);
        }
      }
      pushHistory();
      onChange({ lines: nextLines, layers: nextLayers });
    },
    [lines, layers, pxPerMeter, pushHistory, onChange],
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
    if (tool === "line") {
      setDrawing({ a: p, b: p });
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

    const p = getWorldPos(e);
    setHover(p);
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
    if (!drawing) return;
    if (dist(drawing.a, drawing.b) < 4) {
      setDrawing(null);
      return;
    }
    const a = drawing.a;
    const b = drawing.b;
    setDrawing(null);

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const startRename = (l: Layer) => {
    if (l.locked) {
      toast.error("Buka kunci dulu untuk mengganti nama");
      return;
    }
    setEditingId(l.id);
    setEditingName(l.name);
  };
  const commitRename = () => {
    if (!editingId) return;
    const name = editingName.trim() || "Ruang";
    pushHistory();
    onChange({
      layers: layers.map((l) => (l.id === editingId ? { ...l, name } : l)),
    });
    const isLahan = name.toLowerCase().startsWith("lahan");
    if (isLahan) toast.success(`${name} ditandai sebagai acuan KDB/KLB`);
    setEditingId(null);
  };

  const isLahanName = (n: string) => n.trim().toLowerCase().startsWith("lahan");
  const totalLengthM = lines.reduce((s, l) => s + lineLengthPx(l), 0) / pxPerMeter;
  const totalAreaM2 = layers.reduce((s, l) => s + l.areaM2, 0);
  const lahanLayers = layers.filter((l) => isLahanName(l.name));
  const totalLahanM2 = lahanLayers.reduce((s, l) => s + l.areaM2, 0);

  // Side panel content (reused for normal and fullscreen)
  const SidePanel = (
    <aside
      className={cn(
        "space-y-5 rounded-2xl border border-border/60 bg-surface/80 p-5 shadow-soft backdrop-blur",
        fullscreen && "max-h-[calc(100vh-40px)] overflow-y-auto",
      )}
    >
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
            onClick={() => setTool("line")}
            className={cn(tool === "line" && "bg-gradient-ember shadow-ember")}
          >
            <Pencil className="mr-1.5 h-4 w-4" /> Garis
          </Button>
          <Button
            variant={tool === "erase" ? "default" : "outline"}
            size="sm"
            onClick={() => setTool("erase")}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Hapus
          </Button>
        </div>
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

      <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Layers className="h-3.5 w-3.5" /> Rekapitulasi
          </div>
          <span className="text-[11px] text-muted-foreground">
            {layers.length} ruang · {lahanLayers.length} lahan
          </span>
        </div>

        {layers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-[11px] text-muted-foreground">
            Sambungkan garis hingga membentuk poligon tertutup untuk membuat ruang. Ubah nama menjadi
            "Lahan ..." untuk menjadikannya acuan KDB/KLB.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {layers.map((l) => {
              const lahan = isLahanName(l.name);
              const editing = editingId === l.id;
              return (
                <li
                  key={l.id}
                  className={cn(
                    "rounded-md border px-2.5 py-2",
                    lahan ? "border-ember/60 bg-ember/5" : "border-border/50 bg-background/60",
                    l.locked && "ring-1 ring-foreground/15",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm border border-foreground/20"
                      style={{ background: l.color.replace("ALPHA", "0.9") }}
                    />
                    {editing ? (
                      <Input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-7 text-sm"
                      />
                    ) : (
                      <button
                        onClick={() => startRename(l)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-sm font-medium hover:text-ember"
                        title={l.locked ? "Layer terkunci" : "Klik untuk ganti nama"}
                      >
                        {lahan && <MapPin className="h-3 w-3 shrink-0 text-ember" />}
                        <span className="truncate">{l.name}</span>
                      </button>
                    )}

                    <button
                      onClick={() => toggleLock(l.id)}
                      className={cn(
                        "shrink-0 rounded p-1 transition",
                        l.locked
                          ? "text-ember hover:bg-ember/10"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      aria-label={l.locked ? "Buka kunci" : "Kunci layer"}
                      title={l.locked ? "Buka kunci" : "Kunci layer agar aman dari hapus"}
                    >
                      {l.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                    </button>

                    {editing ? (
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={commitRename}
                        className="text-ember"
                        aria-label="Simpan nama"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => removeLayer(l.id)}
                        className={cn(
                          "shrink-0 transition",
                          l.locked
                            ? "cursor-not-allowed text-muted-foreground/40"
                            : "text-muted-foreground hover:text-ember",
                        )}
                        aria-label="Hapus layer"
                        disabled={l.locked}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-1 pl-5 font-display text-sm font-semibold">
                    {l.areaM2.toFixed(2)}{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">m²</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2 border-t border-border/60 pt-3">
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
              <MapPin className="h-3 w-3" /> Luas Lahan (acuan KDB/KLB)
            </span>
            <span className="font-display text-2xl font-semibold text-ember">
              {totalLahanM2 > 0 ? totalLahanM2.toFixed(2) : "—"}
              <span className="ml-1 text-xs text-muted-foreground">m²</span>
            </span>
          </div>
        </div>
      </div>

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
              tool === "line" ? "cursor-crosshair" : "cursor-pointer",
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
            onClick={() => setTool("line")}
            className={cn(tool === "line" && "bg-gradient-ember shadow-ember")}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "erase" ? "default" : "ghost"}
            size="sm"
            onClick={() => setTool("erase")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
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

        {/* Floating side panel on the right */}
        <div className="absolute right-4 top-4 z-10 w-[340px] max-w-[90vw]">{SidePanel}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-[1fr_340px] lg:p-5">
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
            tool === "line" ? "cursor-crosshair" : "cursor-pointer",
          )}
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/80 px-2.5 py-1 font-display text-xs font-semibold text-foreground shadow-soft backdrop-blur">
          Skala {scale} • 1 kotak besar = {METERS_PER_MAJOR[scale]} m
        </div>
      </div>
      {SidePanel}
    </div>
  );
}
