import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { Pencil, Trash2, Magnet, Ruler, Undo2, Layers, Pencil as PencilIcon, Check, MapPin } from "lucide-react";
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
};

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
  "rgba(232, 93, 58, ALPHA)",   // ember
  "rgba(34, 197, 94, ALPHA)",   // emerald
  "rgba(59, 130, 246, ALPHA)",  // blue
  "rgba(168, 85, 247, ALPHA)",  // purple
  "rgba(234, 179, 8, ALPHA)",   // amber
  "rgba(236, 72, 153, ALPHA)",  // pink
];

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function pointsClose(a: Point, b: Point, tol = SNAP_TOL) {
  return dist(a, b) <= tol;
}
function keyOf(p: Point) {
  // bucket by snap tol so endpoints that "look the same" collapse
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

/**
 * Build graph from lines, then find shortest cycle that uses the newly added line.
 * Returns ordered polygon points or null.
 */
function findCycleWithLine(lines: Line[], newLineIdx: number): Point[] | null {
  if (lines.length < 3) return null;
  // node id -> representative point
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
  // BFS shortest path from start to goal, forbidden to use newLineIdx
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
  // Reconstruct path from goal back to start, then prepend start node points
  const pathKeys: string[] = [];
  let cur: string | null = goalK;
  while (cur) {
    pathKeys.push(cur);
    cur = prev.get(cur) ?? null;
  }
  // pathKeys is goal -> ... -> start; reverse to start -> ... -> goal
  pathKeys.reverse();
  if (pathKeys.length < 3) return null;
  return pathKeys.map((k) => nodes.get(k)!);
}

function SketchPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [scale, setScale] = useState<Scale>("1:100");
  const [snap, setSnap] = useState(true);
  const [tool, setTool] = useState<"line" | "erase">("line");
  const [lines, setLines] = useState<Line[]>([]);
  const [drawing, setDrawing] = useState<{ a: Point; b: Point } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);

  const pxPerMeter = (MINOR_PX * MAJOR_EVERY) / METERS_PER_MAJOR[scale];

  // Recompute layer areas when scale changes
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

    // layers (closed polygons) - filled with each color
    layers.forEach((layer) => {
      if (layer.points.length < 3) return;
      ctx.beginPath();
      ctx.moveTo(layer.points[0].x, layer.points[0].y);
      for (let i = 1; i < layer.points.length; i++) {
        ctx.lineTo(layer.points[i].x, layer.points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = layer.color.replace("ALPHA", "0.28");
      ctx.fill();
      ctx.strokeStyle = layer.color.replace("ALPHA", "0.95");
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // label centroid
      let cx = 0, cy = 0;
      layer.points.forEach((p) => { cx += p.x; cy += p.y; });
      cx /= layer.points.length;
      cy /= layer.points.length;
      const label = `${layer.name} · ${layer.areaM2.toFixed(2)} m²`;
      ctx.font = "600 12px Manrope, sans-serif";
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = "rgba(26,26,26,0.92)";
      ctx.fillRect(cx - w / 2, cy - 11, w, 22);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, cx - w / 2 + 7, cy + 4);
    });

    // lines
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const ln of lines) {
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
  }, [size, lines, drawing, hover, layers, tool, pxPerMeter]);

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
      // Try erasing layer first if click is inside one
      const hitLayer = [...layers].reverse().find((l) => pointInPolygon(p, l.points));
      if (hitLayer) {
        setLayers((prev) => prev.filter((l) => l.id !== hitLayer.id));
        toast.success(`Layer ${hitLayer.name} dihapus`);
        return;
      }
      const tol = 8;
      let bestIdx = -1;
      let bestD = Infinity;
      lines.forEach((ln, i) => {
        const d = pointToSegment(p, ln.a, ln.b);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0 && bestD <= tol) {
        setLines((prev) => prev.filter((_, i) => i !== bestIdx));
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

    // Detect cycle that uses the newly added line
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
          };
          toast.success(`${layer.name} terkunci — ${areaM2.toFixed(2)} m²`);
          return [...prev, layer];
        });
      }
    }
  };

  const handleUndo = () => {
    if (!lines.length) return;
    setLines(lines.slice(0, -1));
  };

  const handleClear = () => {
    setLines([]);
    setLayers([]);
    setDrawing(null);
  };

  const removeLayer = (id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const startRename = (l: Layer) => {
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

  const isLahanName = (n: string) => n.trim().toLowerCase().startsWith("lahan");
  const totalLengthM = lines.reduce((s, l) => s + dist(l.a, l.b), 0) / pxPerMeter;
  const totalAreaM2 = layers.reduce((s, l) => s + l.areaM2, 0);
  const lahanLayers = layers.filter((l) => isLahanName(l.name));
  const totalLahanM2 = lahanLayers.reduce((s, l) => s + l.areaM2, 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Sketsa Batas Lahan
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Kertas milimeter block digital — skala 1:100 hingga 1:1000, snap to grid, dan rekapitulasi luas otomatis.
        </p>
      </div>

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
              <Button variant="outline" size="sm" onClick={handleClear} disabled={!lines.length && !layers.length}>
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

          {/* Rekapitulasi Layer */}
          <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Layers className="h-3.5 w-3.5" /> Rekapitulasi
              </div>
              <span className="text-[11px] text-muted-foreground">{layers.length} ruang · {lahanLayers.length} lahan</span>
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
                        "flex items-center justify-between gap-2 rounded-md border px-2.5 py-2",
                        lahan
                          ? "border-ember/60 bg-ember/5"
                          : "border-border/50 bg-background/60",
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
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
                            className="flex min-w-0 items-center gap-1.5 truncate text-left text-sm font-medium hover:text-ember"
                            title="Klik untuk ganti nama"
                          >
                            {lahan && <MapPin className="h-3 w-3 shrink-0 text-ember" />}
                            <span className="truncate">{l.name}</span>
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-display text-sm font-semibold">
                          {l.areaM2.toFixed(2)} <span className="text-[10px] text-muted-foreground">m²</span>
                        </span>
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
                          <>
                            <button
                              onClick={() => startRename(l)}
                              className="text-muted-foreground transition hover:text-foreground"
                              aria-label="Ganti nama"
                            >
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => removeLayer(l.id)}
                              className="text-muted-foreground transition hover:text-ember"
                              aria-label="Hapus layer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Total seluruh ruang</span>
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
            Tip: gunakan alat Hapus lalu klik pada area dalam lahan untuk menghapus layer.
          </p>
        </aside>
      </div>
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
