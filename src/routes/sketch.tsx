import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Pencil,
  Trash2,
  Magnet,
  Ruler,
  Undo2,
  Layers,
  Pencil as PencilIcon,
  Check,
  MapPin,
  Lock,
  LockOpen,
  ChevronDown,
  ChevronUp,
  Save,
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
      { title: "Sketsa Batas Lahan — Dabidabi's" },
      {
        name: "description",
        content:
          "Sketsa batas lahan presisi di kertas milimeter block digital. Skala 1:100 hingga 1:1000, snap to grid, dan rekapitulasi luas otomatis dalam m².",
      },
    ],
  }),
  component: SketchPage,
});

type Point = { x: number; y: number };
type Line = { a: Point; b: Point };
type Scale = "1:100" | "1:200" | "1:500" | "1:1000";

type Layer = {
  id: string;
  name: string;
  points: Point[];
  areaM2: number;
  color: string;
  locked?: boolean;
};

type SavedState = {
  title: string;
  createdAt: number;
  updatedAt: number;
  scale: Scale;
  snap: boolean;
  lines: Line[];
  layers: Layer[];
};

const STORAGE_KEY = "dabidabis_sketch_v1";

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
function sameSegment(ln: Line, a: Point, b: Point) {
  const k1 = keyOf(ln.a), k2 = keyOf(ln.b);
  const ka = keyOf(a), kb = keyOf(b);
  return (k1 === ka && k2 === kb) || (k1 === kb && k2 === ka);
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
  const prev = new Map<string, string | null>();
  prev.set(startK, null);
  const queue: string[] = [startK];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === goalK) break;
    for (const e of adj.get(cur) || []) {
      if (e.lineIdx === newLineIdx) continue;
      if (prev.has(e.to)) continue;
      prev.set(e.to, cur);
      queue.push(e.to);
    }
  }
  if (!prev.has(goalK)) return null;
  const pathKeys: string[] = [];
  let cur: string | null = goalK;
  while (cur) {
    pathKeys.push(cur);
    cur = prev.get(cur) ?? null;
  }
  pathKeys.reverse();
  if (pathKeys.length < 3) return null;
  return pathKeys.map((k) => nodes.get(k)!);
}

function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function SketchPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Persisted core state
  const [title, setTitle] = useState("Sketsa Baru");
  const [createdAt, setCreatedAt] = useState(() => Date.now());
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [scale, setScale] = useState<Scale>("1:100");
  const [snap, setSnap] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);

  // UI-only
  const [tool, setTool] = useState<"line" | "erase">("line");
  const [drawing, setDrawing] = useState<{ a: Point; b: Point } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [minimized, setMinimized] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savedTick, setSavedTick] = useState(0);

  const pxPerMeter = (MINOR_PX * MAJOR_EVERY) / METERS_PER_MAJOR[scale];

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as SavedState;
        if (s && typeof s === "object") {
          setTitle(s.title ?? "Sketsa Baru");
          setCreatedAt(s.createdAt ?? Date.now());
          setUpdatedAt(s.updatedAt ?? Date.now());
          setScale(s.scale ?? "1:100");
          setSnap(s.snap ?? true);
          setLines(Array.isArray(s.lines) ? s.lines : []);
          setLayers(Array.isArray(s.layers) ? s.layers : []);
        }
      }
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);

  // Auto-save (debounced)
  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(() => {
      const now = Date.now();
      const payload: SavedState = {
        title,
        createdAt,
        updatedAt: now,
        scale,
        snap,
        lines,
        layers,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        setUpdatedAt(now);
        setSavedTick((t) => t + 1);
      } catch {
        // ignore quota
      }
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, scale, snap, lines, layers, loaded]);

  // Recompute layer areas on scale change
  useEffect(() => {
    setLayers((prev) =>
      prev.map((l) => ({
        ...l,
        areaM2: polygonAreaPx(l.points) / (pxPerMeter * pxPerMeter),
      })),
    );
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
  }, [minimized]);

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

  // Lines that belong to any locked layer (cannot be erased)
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
    if (minimized) return;
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

    ctx.fillStyle = "#f6efe3";
    ctx.fillRect(0, 0, size.w, size.h);

    // minor grid
    ctx.strokeStyle = "rgba(180, 90, 60, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= size.w; x += MINOR_PX) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, size.h);
    }
    for (let y = 0; y <= size.h; y += MINOR_PX) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(size.w, y + 0.5);
    }
    ctx.stroke();

    // major grid
    ctx.strokeStyle = "rgba(160, 60, 30, 0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const major = MINOR_PX * MAJOR_EVERY;
    for (let x = 0; x <= size.w; x += major) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, size.h);
    }
    for (let y = 0; y <= size.h; y += major) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(size.w, y + 0.5);
    }
    ctx.stroke();

    // layers
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
      ctx.lineWidth = layer.locked ? 3 : 2.5;
      ctx.stroke();

      // Vertical centroid label: name on top, area below
      let cx = 0, cy = 0;
      layer.points.forEach((p) => { cx += p.x; cy += p.y; });
      cx /= layer.points.length;
      cy /= layer.points.length;

      const nameText = layer.locked ? `🔒 ${layer.name}` : layer.name;
      const areaText = `${layer.areaM2.toFixed(2)} m²`;
      ctx.font = "600 13px Manrope, sans-serif";
      const nameW = ctx.measureText(nameText).width;
      ctx.font = "700 12px Manrope, sans-serif";
      const areaW = ctx.measureText(areaText).width;
      const boxW = Math.max(nameW, areaW) + 16;
      const boxH = 38;
      ctx.fillStyle = "rgba(26,26,26,0.92)";
      ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
      ctx.fillStyle = "#fff";
      ctx.font = "600 13px Manrope, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(nameText, cx, cy - 3);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "700 12px Manrope, sans-serif";
      ctx.fillText(areaText, cx, cy + 14);
      ctx.textAlign = "start";
    });

    // lines
    ctx.lineCap = "round";
    for (const ln of lines) {
      const locked = isLineLocked(ln);
      ctx.strokeStyle = locked ? "#2d2d2d" : "#1a1a1a";
      ctx.lineWidth = locked ? 2.6 : 2;
      ctx.beginPath();
      ctx.moveTo(ln.a.x, ln.a.y);
      ctx.lineTo(ln.b.x, ln.b.y);
      ctx.stroke();
    }

    // endpoints
    ctx.fillStyle = "#1a1a1a";
    for (const ln of lines) {
      for (const p of [ln.a, ln.b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // active drawing
    if (drawing) {
      ctx.strokeStyle = "rgba(232, 93, 58, 0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(drawing.a.x, drawing.a.y);
      ctx.lineTo(drawing.b.x, drawing.b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const meters = dist(drawing.a, drawing.b) / pxPerMeter;
      const mid = { x: (drawing.a.x + drawing.b.x) / 2, y: (drawing.a.y + drawing.b.y) / 2 };
      const label = `${meters.toFixed(2)} m`;
      ctx.font = "600 12px Manrope, sans-serif";
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = "rgba(26,26,26,0.92)";
      ctx.fillRect(mid.x + 8, mid.y - 22, w, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, mid.x + 14, mid.y - 8);
    }

    if (hover && tool === "line" && !drawing) {
      ctx.fillStyle = "rgba(232,93,58,0.9)";
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [size, lines, drawing, hover, layers, tool, pxPerMeter, minimized, isLineLocked]);

  const getPos = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return snapPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = getPos(e);
    if (tool === "line") {
      setDrawing({ a: p, b: p });
    } else if (tool === "erase") {
      const hitLayer = [...layers].reverse().find((l) => pointInPolygon(p, l.points));
      if (hitLayer) {
        if (hitLayer.locked) {
          toast.error(`${hitLayer.name} terkunci`);
          return;
        }
        setLayers((prev) => prev.filter((l) => l.id !== hitLayer.id));
        toast.success(`Layer ${hitLayer.name} dihapus`);
        return;
      }
      const tol = 8;
      let bestIdx = -1;
      let bestD = Infinity;
      lines.forEach((ln, i) => {
        if (isLineLocked(ln)) return;
        const d = pointToSegment(p, ln.a, ln.b);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0 && bestD <= tol) {
        setLines((prev) => prev.filter((_, i) => i !== bestIdx));
      } else if (bestIdx === -1 && lines.some(isLineLocked)) {
        // user might have clicked a locked line
        const hitLocked = lines.find((ln) => isLineLocked(ln) && pointToSegment(p, ln.a, ln.b) <= tol);
        if (hitLocked) toast.error("Garis terkunci");
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = getPos(e);
    setHover(p);
    if (drawing) setDrawing({ a: drawing.a, b: p });
  };

  const onPointerUp = () => {
    if (!drawing) return;
    if (dist(drawing.a, drawing.b) < 4) {
      setDrawing(null);
      return;
    }
    const newLine = { a: drawing.a, b: drawing.b };
    const next = [...lines, newLine];
    setLines(next);
    setDrawing(null);

    const newIdx = next.length - 1;
    const cycle = findCycleWithLine(next, newIdx);
    if (cycle && cycle.length >= 3) {
      const areaPx = polygonAreaPx(cycle);
      if (areaPx > 25) {
        const areaM2 = areaPx / (pxPerMeter * pxPerMeter);
        setLayers((prev) => {
          const idx = prev.length + 1;
          const color = LAYER_COLORS[prev.length % LAYER_COLORS.length];
          const layer: Layer = {
            id: `L${Date.now()}`,
            name: `Ruang ${idx}`,
            points: cycle,
            areaM2,
            color,
            locked: false,
          };
          toast.success(`${layer.name} terbentuk — ${areaM2.toFixed(2)} m²`);
          return [...prev, layer];
        });
      }
    }
  };

  const handleUndo = () => {
    if (!lines.length) return;
    // Don't undo locked lines
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!isLineLocked(lines[i])) {
        setLines(lines.filter((_, j) => j !== i));
        return;
      }
    }
    toast.error("Semua garis terakhir terkunci");
  };

  const doClearAll = () => {
    setLines([]);
    setLayers([]);
    setDrawing(null);
    setTitle("Sketsa Baru");
    const now = Date.now();
    setCreatedAt(now);
    setUpdatedAt(now);
    setConfirmClear(false);
    toast.success("Sketsa dihapus dan disetel ulang");
  };

  const removeLayer = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (layer?.locked) {
      toast.error(`${layer.name} terkunci`);
      return;
    }
    setLayers((prev) => prev.filter((l) => l.id !== id));
  };

  const toggleLock = (id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)),
    );
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
    setLayers((prev) => prev.map((l) => (l.id === editingId ? { ...l, name } : l)));
    const isLahan = name.toLowerCase().startsWith("lahan");
    if (isLahan) toast.success(`${name} ditandai sebagai acuan KDB/KLB`);
    setEditingId(null);
  };

  const commitTitle = () => {
    const t = titleDraft.trim() || "Sketsa Tanpa Judul";
    setTitle(t);
    setEditingTitle(false);
  };

  const isLahanName = (n: string) => n.trim().toLowerCase().startsWith("lahan");
  const totalLengthM = lines.reduce((s, l) => s + dist(l.a, l.b), 0) / pxPerMeter;
  const totalAreaM2 = layers.reduce((s, l) => s + l.areaM2, 0);
  const lahanLayers = layers.filter((l) => isLahanName(l.name));
  const totalLahanM2 = lahanLayers.reduce((s, l) => s + l.areaM2, 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Sketsa Batas Lahan
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Kertas milimeter block digital — tersimpan otomatis di perangkat ini.
        </p>
      </div>

      {/* Title bar above sketch box */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface/60 px-4 py-3 shadow-soft backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            onClick={() => setMinimized((m) => !m)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground transition hover:text-foreground"
            aria-label={minimized ? "Perbesar" : "Minimize"}
            title={minimized ? "Perbesar sketsa" : "Minimize sketsa"}
          >
            {minimized ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>

          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="h-8 font-display text-base font-semibold"
              />
            ) : (
              <button
                onClick={() => {
                  setTitleDraft(title);
                  setEditingTitle(true);
                }}
                className="group flex min-w-0 items-center gap-2 text-left"
                title="Klik untuk ganti judul"
              >
                <span className="truncate font-display text-lg font-semibold">{title}</span>
                <PencilIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
              </button>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>Mulai: {formatDate(createdAt)}</span>
              <span>•</span>
              <span>Diedit: {formatDate(updatedAt)}</span>
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <Save className="h-3 w-3" /> tersimpan otomatis
              </span>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmClear(true)}
          className="border-ember/40 text-ember hover:bg-ember/10 hover:text-ember"
        >
          <Trash2 className="mr-1.5 h-4 w-4" /> Hapus Sketsa
        </Button>
      </div>

      {!minimized && (
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

          <aside className="space-y-5 rounded-2xl border border-border/60 bg-surface/60 p-5 shadow-soft backdrop-blur">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Skala</Label>
              <Select value={scale} onValueChange={(v) => setScale(v as Scale)}>
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
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={handleUndo} disabled={!lines.length}>
                  <Undo2 className="mr-1.5 h-4 w-4" /> Undo
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmClear(true)}
                  disabled={!lines.length && !layers.length}
                >
                  Bersihkan
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Magnet className="h-4 w-4 text-ember" />
                <div>
                  <div className="text-sm font-medium">Snap to Grid</div>
                  <div className="text-[11px] text-muted-foreground">Kunci titik ke garis kotak</div>
                </div>
              </div>
              <Switch checked={snap} onCheckedChange={setSnap} />
            </div>

            {/* Rekapitulasi */}
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
                  Sambungkan garis hingga membentuk poligon tertutup untuk membuat ruang. Ubah nama menjadi "Lahan ..." untuk menjadikannya acuan KDB/KLB.
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
              Tip: kunci layer (ikon gembok) agar tidak terhapus saat memakai alat Hapus. Progres tersimpan otomatis.
            </p>
          </aside>
        </div>
      )}

      {minimized && (
        <div className="rounded-2xl border border-dashed border-border/60 bg-surface/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Sketsa diminimize. Klik panah di samping judul untuk membuka kembali.
          <div className="mt-2 text-[11px]">
            {layers.length} ruang · {lahanLayers.length} lahan · {totalAreaM2.toFixed(2)} m² total
          </div>
        </div>
      )}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus sketsa ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Seluruh garis, layer, dan judul "{title}" akan dihapus permanen dari perangkat ini.
              Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doClearAll} className="bg-ember text-white hover:bg-ember/90">
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* invisible live region for save tick (a11y) */}
      <span className="sr-only" aria-live="polite">
        Tersimpan {savedTick} kali
      </span>
    </main>
  );
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

// keep export reference (avoids tree-shake removal warnings)
export const __sameSegment = sameSegment;
