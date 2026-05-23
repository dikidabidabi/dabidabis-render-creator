import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { Pencil, Trash2, Magnet, Ruler, Undo2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
          "Sketsa batas lahan presisi di kertas milimeter block digital. Skala 1:100 / 1:200, snap to grid, dan kalkulasi luas otomatis dalam m².",
      },
      { property: "og:title", content: "Sketsa Batas Lahan — Dabidabi's" },
      {
        property: "og:description",
        content:
          "Gambar batas lahan dengan skala arsitektur, snap to grid, dan luas otomatis.",
      },
    ],
  }),
  component: SketchPage,
});

type Point = { x: number; y: number };
type Line = { a: Point; b: Point };
type Scale = "1:100" | "1:200";

// 1 kotak besar (10 mm pada kertas milimeter) = 1 m pada skala 1:100, 2 m pada 1:200.
const METERS_PER_MAJOR: Record<Scale, number> = { "1:100": 1, "1:200": 2 };
const MINOR_PX = 8; // ukuran 1 kotak kecil di layar (px)
const MAJOR_EVERY = 10; // 10 kotak kecil = 1 kotak besar

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointsClose(a: Point, b: Point, tol: number) {
  return dist(a, b) <= tol;
}

// Shoelace area (px²)
function polygonAreaPx(pts: Point[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(s) / 2;
}

/**
 * Build closed polygons from connected line endpoints.
 * Simple approach: try to form a polygon by walking the last N lines if they form a closed loop.
 */
function detectClosedPolygon(lines: Line[], tol: number): Point[] | null {
  if (lines.length < 3) return null;
  // Try chains ending at the latest line and going back.
  for (let start = 0; start <= lines.length - 3; start++) {
    const chain = lines.slice(start);
    const pts: Point[] = [chain[0].a];
    let ok = true;
    for (let i = 0; i < chain.length; i++) {
      const prev = pts[pts.length - 1];
      const seg = chain[i];
      if (pointsClose(prev, seg.a, tol)) {
        pts.push(seg.b);
      } else if (pointsClose(prev, seg.b, tol)) {
        pts.push(seg.a);
      } else {
        ok = false;
        break;
      }
    }
    if (ok && pts.length >= 4 && pointsClose(pts[0], pts[pts.length - 1], tol)) {
      pts.pop();
      return pts;
    }
  }
  return null;
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
  const [polygon, setPolygon] = useState<Point[] | null>(null);

  // px per meter
  const pxPerMeter = (MINOR_PX * MAJOR_EVERY) / METERS_PER_MAJOR[scale];

  // Resize observer
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

    // Background (warm paper)
    ctx.fillStyle = "#f6efe3";
    ctx.fillRect(0, 0, size.w, size.h);

    // Minor grid
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

    // Major grid
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

    // Polygon fill
    if (polygon && polygon.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(polygon[0].x, polygon[0].y);
      for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
      ctx.closePath();
      ctx.fillStyle = "rgba(232, 93, 58, 0.18)";
      ctx.fill();
      ctx.strokeStyle = "rgba(232, 93, 58, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Lines
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const ln of lines) {
      ctx.beginPath();
      ctx.moveTo(ln.a.x, ln.a.y);
      ctx.lineTo(ln.b.x, ln.b.y);
      ctx.stroke();
    }

    // Endpoints
    ctx.fillStyle = "#1a1a1a";
    for (const ln of lines) {
      for (const p of [ln.a, ln.b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Active drawing
    if (drawing) {
      ctx.strokeStyle = "rgba(232, 93, 58, 0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(drawing.a.x, drawing.a.y);
      ctx.lineTo(drawing.b.x, drawing.b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Length label
      const meters = dist(drawing.a, drawing.b) / pxPerMeter;
      const mid = { x: (drawing.a.x + drawing.b.x) / 2, y: (drawing.a.y + drawing.b.y) / 2 };
      const label = `Panjang: ${meters.toFixed(2)} m`;
      ctx.font = "600 12px Manrope, sans-serif";
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = "rgba(26,26,26,0.92)";
      ctx.fillRect(mid.x + 8, mid.y - 22, w, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, mid.x + 14, mid.y - 8);
    }

    // Hover indicator
    if (hover && tool === "line" && !drawing) {
      ctx.fillStyle = "rgba(232,93,58,0.9)";
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [size, lines, drawing, hover, polygon, tool, pxPerMeter]);

  const getPos = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return snapPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const tryCloseAfter = (newLines: Line[]) => {
    const tol = MINOR_PX * 0.75;
    const poly = detectClosedPolygon(newLines, tol);
    if (poly) {
      setPolygon(poly);
      const m2 = polygonAreaPx(poly) / (pxPerMeter * pxPerMeter);
      toast.success(`Bidang terkunci — Luas ${m2.toFixed(2)} m²`);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = getPos(e);
    if (tool === "line") {
      if (polygon) setPolygon(null);
      setDrawing({ a: p, b: p });
    } else if (tool === "erase") {
      // erase nearest line within tolerance
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
        const next = lines.filter((_, i) => i !== bestIdx);
        setLines(next);
        setPolygon(null);
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
    const next = [...lines, { a: drawing.a, b: drawing.b }];
    setLines(next);
    setDrawing(null);
    tryCloseAfter(next);
  };

  const handleUndo = () => {
    if (!lines.length) return;
    setLines(lines.slice(0, -1));
    setPolygon(null);
  };

  const handleClear = () => {
    setLines([]);
    setPolygon(null);
    setDrawing(null);
  };

  const totalLengthM =
    lines.reduce((s, l) => s + dist(l.a, l.b), 0) / pxPerMeter;
  const areaM2 =
    polygon ? polygonAreaPx(polygon) / (pxPerMeter * pxPerMeter) : 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Sketsa Batas Lahan
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Kertas milimeter block digital — gambar batas lahan dengan skala arsitektur, snap to grid, dan luas otomatis.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Canvas */}
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
              tool === "line" ? "cursor-crosshair" : "cursor-not-allowed",
            )}
          />
          {/* Scale ribbon */}
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/80 px-2.5 py-1 font-display text-xs font-semibold text-foreground shadow-soft backdrop-blur">
            Skala {scale} • 1 kotak besar = {METERS_PER_MAJOR[scale]} m
          </div>
        </div>

        {/* Side panel */}
        <aside className="space-y-5 rounded-2xl border border-border/60 bg-surface/60 p-5 shadow-soft backdrop-blur">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Skala</Label>
            <Select value={scale} onValueChange={(v) => { setScale(v as Scale); setPolygon(null); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1:100">1 : 100 (1 kotak besar = 1 m)</SelectItem>
                <SelectItem value="1:200">1 : 200 (1 kotak besar = 2 m)</SelectItem>
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
              <Button variant="outline" size="sm" onClick={handleClear} disabled={!lines.length}>
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

          <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Ruler className="h-3.5 w-3.5" /> Ringkasan
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Jumlah garis</span>
              <span className="font-display text-base font-semibold">{lines.length}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total panjang</span>
              <span className="font-display text-base font-semibold">
                {totalLengthM.toFixed(2)} m
              </span>
            </div>
            <div className="border-t border-border/60 pt-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Luas lahan
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-3xl font-semibold text-ember">
                  {areaM2 > 0 ? areaM2.toFixed(2) : "—"}
                </span>
                <span className="text-sm text-muted-foreground">m²</span>
              </div>
              {polygon ? (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> Bidang tertutup terdeteksi
                </div>
              ) : (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Sambungkan garis hingga membentuk poligon tertutup.
                </div>
              )}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Tips: aktifkan Snap to Grid untuk presisi milimeter. Sentuhan stylus/jari didukung penuh di tablet.
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
