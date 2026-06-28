import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Square, Minus, MousePointer2, Move as MoveIcon, RotateCw,
  PenLine, FlipHorizontal2, Scissors, Magnet, Compass as CompassIcon,
  Undo2, Redo2, Trash2, ArrowRight, Sparkles, Building2, Landmark, Trees,
  MapPin, Layers, Hash, Plus,
} from "lucide-react";
import { MasterplanClusterDialog } from "@/components/masterplan-cluster-dialog";
import {
  FUNCTION_META, type MassingBlock, type MasterFunction, type MasterPlan, type Vec2,
  blockPolygon, blockFootprintArea, blockGFA, emptyPlan, loadPlan, nextBlockId, savePlan,
  totalsByFunction, sitePolygonOf, siteAreaM2, MP_PENDING_DETAIL_KEY, polyBounds, polyCentroid,
} from "@/lib/masterplan";

export const Route = createFileRoute("/masterplan")({
  head: () => ({
    meta: [
      { title: "Master Plan — Dabidabi's" },
      { name: "description", content: "Sketsa kawasan 2D berbasis grid milimeter. Gambar massa bangunan, kelola KDB/KLB/KDH, dan jalankan Cluster Generator." },
    ],
  }),
  component: MasterPlanPage,
});

// ─────────────────────────── Konstanta & util ───────────────────────────

const SCALE_OPTIONS = [200, 250, 300, 400, 500, 750, 1000, 1200, 1500, 2000];
const PX_PER_MM = 4;          // px layar per mm kertas
const MM_MINOR = 1;           // 1 mm grid halus
const MM_MAJOR = 10;          // 10 mm grid tebal

type Tool =
  | "select" | "line" | "rect" | "edit" | "move" | "rotate" | "mirror"
  | "trim" | "extend" | "north" | "coord";

type AnnLine = { id: string; a: Vec2; b: Vec2 };

type Snapshot = {
  plan: MasterPlan;
  lines: AnnLine[];
};

function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function distSq(a: Vec2, b: Vec2) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / d;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

function pointSegDistSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return distSq(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return distSq(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function reflectPoint(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const fx = a.x + t * dx, fy = a.y + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

function rotatePoint(p: Vec2, c: Vec2, ang: number): Vec2 {
  const co = Math.cos(ang), si = Math.sin(ang);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
}

function defaultHeightFor(fn: MasterFunction): number {
  return fn === "komersial" ? 18 : fn === "fasum" ? 10 : 0.5;
}
function defaultFloorsFor(fn: MasterFunction): number {
  return fn === "komersial" ? 5 : fn === "fasum" ? 3 : 1;
}

// ─────────────────────────── Halaman ───────────────────────────

function MasterPlanPage() {
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [plan, setPlan] = useState<MasterPlan>(() => emptyPlan());
  const [lines, setLines] = useState<AnnLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [tool, setTool] = useState<Tool>("select");
  const [activeFn, setActiveFn] = useState<MasterFunction>("komersial");
  const [snap, setSnap] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [clusterOpen, setClusterOpen] = useState(false);

  // Pan / size
  const [view, setView] = useState({ pan: { x: 0, y: 0 }, w: 800, h: 600 });
  // Drawing state per tool
  const [drawStart, setDrawStart] = useState<Vec2 | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Vec2 | null>(null);
  const [mirrorA, setMirrorA] = useState<Vec2 | null>(null);
  const [trimFirst, setTrimFirst] = useState<string | null>(null);
  const [extendFirst, setExtendFirst] = useState<string | null>(null);
  const [rotateBase, setRotateBase] = useState<number | null>(null);

  const [history, setHistory] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);

  // Hydrate
  useEffect(() => {
    setPlan(loadPlan());
    try {
      const raw = window.localStorage.getItem("dabidabis-masterplan-lines-v1");
      if (raw) {
        const j = JSON.parse(raw);
        if (Array.isArray(j)) setLines(j.filter((l) => l && l.a && l.b));
      }
    } catch {}
    setHydrated(true);
  }, []);

  // Persist
  useEffect(() => {
    if (!hydrated) return;
    savePlan(plan);
  }, [plan, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem("dabidabis-masterplan-lines-v1", JSON.stringify(lines));
  }, [lines, hydrated]);

  // Resize observer for SVG container
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        setView((v) => ({ ...v, w: r.width, h: r.height }));
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Skala → px/m
  const scaleDenom = plan.scaleDenom ?? 500;
  const pxPerMeter = (PX_PER_MM * 1000) / scaleDenom;
  const pxPerMinor = PX_PER_MM * MM_MINOR;
  const pxPerMajor = PX_PER_MM * MM_MAJOR;

  // World ↔ Screen
  const cx = view.w / 2 + view.pan.x;
  const cy = view.h / 2 + view.pan.y;
  const worldToScreen = useCallback(
    (p: Vec2) => ({ x: cx + p.x * pxPerMeter, y: cy + p.y * pxPerMeter }),
    [cx, cy, pxPerMeter],
  );
  const screenToWorld = useCallback(
    (p: Vec2): Vec2 => ({ x: (p.x - cx) / pxPerMeter, y: (p.y - cy) / pxPerMeter }),
    [cx, cy, pxPerMeter],
  );

  const snapWorld = useCallback(
    (p: Vec2): Vec2 => {
      if (!snap) return p;
      // snap ke 1 minor mm-grid (= scaleDenom/1000 meter)
      const step = scaleDenom / 1000;
      return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
    },
    [snap, scaleDenom],
  );

  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-49), { plan: clone(plan), lines: clone(lines) }]);
    setRedoStack([]);
  }, [plan, lines]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setRedoStack((r) => [...r, { plan: clone(plan), lines: clone(lines) }]);
      setPlan(last.plan);
      setLines(last.lines);
      return h.slice(0, -1);
    });
  }, [plan, lines]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const last = r[r.length - 1];
      setHistory((h) => [...h, { plan: clone(plan), lines: clone(lines) }]);
      setPlan(last.plan);
      setLines(last.lines);
      return r.slice(0, -1);
    });
  }, [plan, lines]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redo();
      } else if (e.key === "Escape") {
        setDrawStart(null); setMirrorA(null); setTrimFirst(null); setExtendFirst(null); setRotateBase(null);
        setTool("select");
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          pushHistory();
          setPlan((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== selectedId) }));
          setSelectedId(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedId, pushHistory]);

  // ──── Operasi pada blok ────
  const selected = useMemo(() => plan.blocks.find((b) => b.id === selectedId) ?? null, [plan, selectedId]);
  const setPlanPatch = (patch: Partial<MasterPlan>) => setPlan((p) => ({ ...p, ...patch }));
  const updateBlock = (id: string, patch: Partial<MassingBlock>) =>
    setPlan((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? syncBlockBounds({ ...b, ...patch }) : b)) }));

  // Saat polygon berubah → sinkron bounding box (x,z,w,d) untuk back-compat
  function syncBlockBounds(b: MassingBlock): MassingBlock {
    const poly = b.polygon && b.polygon.length >= 3 ? b.polygon : null;
    if (!poly) return b;
    const bb = polyBounds(poly);
    return {
      ...b,
      x: (bb.minX + bb.maxX) / 2,
      z: (bb.minY + bb.maxY) / 2,
      w: Math.max(0.5, bb.maxX - bb.minX),
      d: Math.max(0.5, bb.maxY - bb.minY),
    };
  }

  const addBlockFromPolygon = (poly: Vec2[]) => {
    const id = nextBlockId(plan);
    const fn = activeFn;
    const block: MassingBlock = syncBlockBounds({
      id,
      name: `${FUNCTION_META[fn].label} ${plan.blocks.length + 1}`,
      fn,
      x: 0, z: 0, w: 0, d: 0,
      height: defaultHeightFor(fn),
      floors: defaultFloorsFor(fn),
      rotation: 0,
      polygon: poly,
    });
    pushHistory();
    setPlan((p) => ({ ...p, blocks: [...p.blocks, block] }));
    setSelectedId(id);
  };

  // ──── Pointer event handler kanvas ────
  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const w0 = screenToWorld(sp);
    const w = snapWorld(w0);

    // Middle button or space → pan (sederhana)
    if (e.button === 1) {
      e.preventDefault();
      const startPan = { ...view.pan };
      const start = { x: e.clientX, y: e.clientY };
      const onMove = (ev: PointerEvent) => {
        setView((v) => ({ ...v, pan: { x: startPan.x + (ev.clientX - start.x), y: startPan.y + (ev.clientY - start.y) } }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }

    if (tool === "line") {
      if (!drawStart) setDrawStart(w);
      else {
        pushHistory();
        setLines((ls) => [...ls, { id: uid("ln"), a: drawStart, b: w }]);
        setDrawStart(null);
      }
      return;
    }
    if (tool === "rect") {
      if (!drawStart) setDrawStart(w);
      else {
        const a = drawStart, b = w;
        if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
          const poly: Vec2[] = [
            { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
            { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) },
            { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
            { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) },
          ];
          addBlockFromPolygon(poly);
        }
        setDrawStart(null);
      }
      return;
    }
    if (tool === "mirror") {
      if (!selected) return;
      if (!mirrorA) { setMirrorA(w); return; }
      const poly = blockPolygon(selected).map((p) => reflectPoint(p, mirrorA, w)).reverse();
      pushHistory();
      updateBlock(selected.id, { polygon: poly });
      setMirrorA(null);
      return;
    }
    if (tool === "rotate") {
      if (!selected) return;
      const c = polyCentroid(blockPolygon(selected));
      if (rotateBase == null) {
        setRotateBase(Math.atan2(w.y - c.y, w.x - c.x));
      } else {
        const ang = Math.atan2(w.y - c.y, w.x - c.x) - rotateBase;
        const poly = blockPolygon(selected).map((p) => rotatePoint(p, c, ang));
        pushHistory();
        updateBlock(selected.id, { polygon: poly, rotation: (selected.rotation ?? 0) + ang });
        setRotateBase(null);
      }
      return;
    }

    // hit test: vertex of selected → edit; block → select+move
    if (tool === "edit" && selected) {
      const poly = blockPolygon(selected);
      const screenPx = (m: number) => m * pxPerMeter;
      for (let i = 0; i < poly.length; i++) {
        if (Math.sqrt(distSq(poly[i], w0)) * pxPerMeter < 10) {
          setSelectedVertex(i);
          // start vertex drag
          const startPoly = clone(poly);
          let moved = false;
          const onMove = (ev: PointerEvent) => {
            const sp2 = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
            const w2 = snapWorld(screenToWorld(sp2));
            const next = clone(startPoly);
            next[i] = w2;
            updateBlock(selected.id, { polygon: next });
            moved = true;
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            if (moved) pushHistory();
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          void screenPx;
          return;
        }
      }
    }

    // line hit (for trim/extend)
    if (tool === "trim" || tool === "extend") {
      let hit: string | null = null;
      let bestD = Infinity;
      for (const ln of lines) {
        const d = pointSegDistSq(w0, ln.a, ln.b);
        if (d < bestD) { bestD = d; hit = ln.id; }
      }
      if (hit && Math.sqrt(bestD) * pxPerMeter < 12) {
        if (tool === "trim") {
          if (!trimFirst) { setTrimFirst(hit); return; }
          // Find intersection of trimFirst with hit, then shorten trimFirst at intersection (nearest endpoint to click)
          const A = lines.find((l) => l.id === trimFirst);
          const B = lines.find((l) => l.id === hit);
          if (A && B) {
            const x = lineIntersection(A.a, A.b, B.a, B.b);
            if (x) {
              const da = distSq(A.a, w0);
              const db = distSq(A.b, w0);
              pushHistory();
              setLines((ls) => ls.map((l) => l.id === A.id ? (da < db ? { ...l, a: x } : { ...l, b: x }) : l));
            }
          }
          setTrimFirst(null);
        } else {
          if (!extendFirst) { setExtendFirst(hit); return; }
          const A = lines.find((l) => l.id === extendFirst);
          const B = lines.find((l) => l.id === hit);
          if (A && B) {
            const x = lineIntersection(A.a, A.b, B.a, B.b);
            if (x) {
              const da = distSq(A.a, x);
              const db = distSq(A.b, x);
              pushHistory();
              setLines((ls) => ls.map((l) => l.id === A.id ? (da < db ? { ...l, a: x } : { ...l, b: x }) : l));
            }
          }
          setExtendFirst(null);
        }
        return;
      }
    }

    // Default: select block at point
    let hitBlock: MassingBlock | null = null;
    for (const b of plan.blocks) {
      if (pointInPolygon(w0, blockPolygon(b))) hitBlock = b;
    }
    if (hitBlock) {
      setSelectedId(hitBlock.id);
      setSelectedVertex(null);
      if (tool === "move" || tool === "select") {
        // Drag block
        const startPoly = clone(blockPolygon(hitBlock));
        const startW = w0;
        let moved = false;
        const onMove = (ev: PointerEvent) => {
          const sp2 = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
          const w2 = screenToWorld(sp2);
          const dx0 = w2.x - startW.x, dy0 = w2.y - startW.y;
          // snap delta
          const step = scaleDenom / 1000;
          const dx = snap ? Math.round(dx0 / step) * step : dx0;
          const dy = snap ? Math.round(dy0 / step) * step : dy0;
          updateBlock(hitBlock!.id, { polygon: startPoly.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
          moved = true;
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          if (moved) pushHistory();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }
    } else {
      setSelectedId(null);
    }
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setCursorWorld(snapWorld(screenToWorld(sp)));
  };

  const onSvgWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    // pan vertikal/horizontal saja (zoom dilewatkan via skala)
    if (e.ctrlKey) {
      // change scale
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const idx = SCALE_OPTIONS.indexOf(scaleDenom);
      const next = SCALE_OPTIONS[Math.max(0, Math.min(SCALE_OPTIONS.length - 1, idx + dir))];
      if (next !== scaleDenom) setPlanPatch({ scaleDenom: next });
    } else {
      setView((v) => ({ ...v, pan: { x: v.pan.x - e.deltaX, y: v.pan.y - e.deltaY } }));
    }
  };

  // ──── Render: grid mm ────
  const gridLines = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    // Hitung jangkauan minor lines yang muat di viewport
    const padding = 100;
    const minorPx = pxPerMinor;
    if (minorPx < 1.5) {
      // jika terlalu rapat, hanya gambar major
    }
    const majorPx = pxPerMajor;
    // start x in screen coords aligned to grid
    const startMinorX = cx - Math.ceil((cx + padding) / minorPx) * minorPx;
    const startMinorY = cy - Math.ceil((cy + padding) / minorPx) * minorPx;
    if (minorPx >= 1.5) {
      for (let x = startMinorX; x <= view.w + padding; x += minorPx) {
        const idx = Math.round((x - cx) / minorPx);
        if (idx % MM_MAJOR === 0) continue;
        out.push({ x1: x, y1: 0, x2: x, y2: view.h, major: false });
      }
      for (let y = startMinorY; y <= view.h + padding; y += minorPx) {
        const idx = Math.round((y - cy) / minorPx);
        if (idx % MM_MAJOR === 0) continue;
        out.push({ x1: 0, y1: y, x2: view.w, y2: y, major: false });
      }
    }
    const startMajorX = cx - Math.ceil((cx + padding) / majorPx) * majorPx;
    const startMajorY = cy - Math.ceil((cy + padding) / majorPx) * majorPx;
    for (let x = startMajorX; x <= view.w + padding; x += majorPx) {
      out.push({ x1: x, y1: 0, x2: x, y2: view.h, major: true });
    }
    for (let y = startMajorY; y <= view.h + padding; y += majorPx) {
      out.push({ x1: 0, y1: y, x2: view.w, y2: y, major: true });
    }
    return out;
  }, [view.w, view.h, cx, cy, pxPerMinor, pxPerMajor]);

  const sitePoly = sitePolygonOf(plan);
  const sitePolyPx = sitePoly.map(worldToScreen);
  const siteArea = siteAreaM2(plan);

  const totals = useMemo(() => totalsByFunction(plan), [plan]);
  const totalGFA = totals.komersial.gfa + totals.fasum.gfa + totals.rth.gfa;
  const totalFootprint = totals.komersial.footprint + totals.fasum.footprint;
  const kdbLimit = (plan.kdbPct ?? 0) > 0 && siteArea > 0 ? ((plan.kdbPct ?? 0) / 100) * siteArea : 0;
  const klbLimit = (plan.klbCoef ?? 0) > 0 && siteArea > 0 ? (plan.klbCoef ?? 0) * siteArea : 0;
  const kdhLimit = (plan.kdhPct ?? 0) > 0 && siteArea > 0 ? ((plan.kdhPct ?? 0) / 100) * siteArea : 0;
  const kdhRencana = totals.rth.footprint;

  const goDetail = (b: MassingBlock) => {
    try {
      window.localStorage.setItem(MP_PENDING_DETAIL_KEY, JSON.stringify({ blockId: b.id, name: b.name, fn: b.fn, at: Date.now() }));
    } catch {}
    navigate({ to: "/sketch", search: { blockId: b.id, blockName: b.name } as any });
  };

  // North arrow handle drag
  const onNorthClick = (worldP: Vec2) => {
    const ang = Math.atan2(worldP.x, -worldP.y); // arah +Y ke selatan, jadi -Y = utara baseline
    pushHistory();
    setPlanPatch({ northRot: ang });
  };

  // ──── UI ────
  return (
    <main className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-background">
      {/* Panel kiri: KDB/KLB/KDH/Luas Lahan */}
      <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-card/40 p-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Regulasi Tapak</h2>
          <p className="text-xs text-muted-foreground">KDB / KLB / KDH dihitung dari polygon massa.</p>
        </div>

        <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
          <div className="flex items-baseline justify-between rounded-md bg-ember/10 px-2.5 py-2">
            <span className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-ember">
              <MapPin className="h-3 w-3" /> Luas Lahan
            </span>
            <span className="font-display text-2xl font-semibold text-ember">
              {siteArea > 0 ? siteArea.toFixed(2) : "—"}
              <span className="ml-1 text-xs text-muted-foreground">m²</span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Sisi tapak (m)</Label>
              <Input
                type="number"
                value={plan.siteSize}
                min={20}
                onChange={(e) => { pushHistory(); setPlanPatch({ siteSize: Math.max(20, Number(e.target.value) || plan.siteSize), sitePolygon: undefined }); }}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Skala (1:n)</Label>
              <Select value={String(scaleDenom)} onValueChange={(v) => setPlanPatch({ scaleDenom: Number(v) })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCALE_OPTIONS.map((s) => <SelectItem key={s} value={String(s)}>1 : {s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* KDB */}
        <RegBox
          label="KDB"
          unit="%"
          value={plan.kdbPct}
          onChange={(v) => { pushHistory(); setPlanPatch({ kdbPct: v }); }}
          limitLabel="Maksimum (KDB × Lahan)"
          limit={kdbLimit}
          rencanaLabel="KDB Rencana"
          rencana={totalFootprint}
          deviasiInvert={false}
        />
        {/* KLB */}
        <RegBox
          label="KLB"
          unit="×"
          value={plan.klbCoef}
          onChange={(v) => { pushHistory(); setPlanPatch({ klbCoef: v }); }}
          limitLabel="Maksimum (KLB × Lahan)"
          limit={klbLimit}
          rencanaLabel="KLB Rencana (GFA)"
          rencana={totalGFA}
          deviasiInvert={false}
          step={0.1}
        />
        {/* KDH */}
        <RegBox
          label="KDH"
          unit="%"
          value={plan.kdhPct}
          onChange={(v) => { pushHistory(); setPlanPatch({ kdhPct: v }); }}
          limitLabel="Minimum (KDH × Lahan)"
          limit={kdhLimit}
          rencanaLabel="KDH Rencana (RTH)"
          rencana={kdhRencana}
          deviasiInvert={true}
        />

        <div className="mt-1 rounded-md border border-border bg-background/60 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total GFA Kawasan</div>
          <div className="font-display text-2xl font-bold">{Math.round(totalGFA).toLocaleString("id-ID")} m²</div>
          <div className="mt-2 space-y-1 text-xs">
            {(Object.keys(FUNCTION_META) as MasterFunction[]).map((fn) => (
              <div key={fn} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FUNCTION_META[fn].color }} />
                  {FUNCTION_META[fn].label}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {Math.round(totals[fn].gfa).toLocaleString("id-ID")} m²
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs">Layer Aktif (fungsi gambar baru)</Label>
          <div className="mt-1 flex flex-col gap-1.5">
            {(Object.keys(FUNCTION_META) as MasterFunction[]).map((fn) => {
              const m = FUNCTION_META[fn];
              const Icon = fn === "komersial" ? Building2 : fn === "fasum" ? Landmark : Trees;
              return (
                <button
                  key={fn}
                  onClick={() => setActiveFn(fn)}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-1.5 text-left text-sm transition",
                    activeFn === fn ? "border-foreground bg-foreground/5 font-medium" : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded text-white" style={{ background: m.color }}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <Button variant="default" size="sm" className="mt-1 w-full justify-start" onClick={() => setClusterOpen(true)}>
          <Sparkles className="mr-2 h-4 w-4" />
          Cluster Generator
        </Button>
      </aside>

      {/* Kanvas tengah */}
      <section className="relative flex-1 bg-slate-50">
        <div ref={wrapRef} className="absolute inset-0">
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            style={{ display: "block", cursor: tool === "select" ? "default" : "crosshair", background: "#fafafa" }}
            onPointerDown={onSvgPointerDown}
            onPointerMove={onSvgPointerMove}
            onWheel={onSvgWheel}
          >
            {/* mm grid */}
            <g>
              {gridLines.map((l, i) => (
                <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke={l.major ? "#cbd5e1" : "#e5e7eb"}
                  strokeWidth={l.major ? 0.6 : 0.3} />
              ))}
              {/* sumbu pusat */}
              <line x1={0} y1={cy} x2={view.w} y2={cy} stroke="#94a3b8" strokeWidth={0.5} strokeDasharray="4 4" opacity={0.5} />
              <line x1={cx} y1={0} x2={cx} y2={view.h} stroke="#94a3b8" strokeWidth={0.5} strokeDasharray="4 4" opacity={0.5} />
            </g>

            {/* Site polygon */}
            <polygon
              points={sitePolyPx.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="#fff7ed"
              fillOpacity={0.5}
              stroke="#ea580c"
              strokeWidth={1.4}
              strokeDasharray="6 4"
              pointerEvents="none"
            />

            {/* Blocks */}
            {plan.blocks.map((b) => {
              const poly = blockPolygon(b);
              const polyPx = poly.map(worldToScreen);
              const meta = FUNCTION_META[b.fn];
              const isSel = b.id === selectedId;
              const c = polyCentroid(poly);
              const cpx = worldToScreen(c);
              return (
                <g key={b.id}>
                  <polygon
                    points={polyPx.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={meta.color}
                    fillOpacity={b.fn === "rth" ? 0.32 : 0.55}
                    stroke={isSel ? "#facc15" : "#0f172a"}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  <text x={cpx.x} y={cpx.y - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0f172a"
                    style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 2 }}>
                    {b.name}
                  </text>
                  <text x={cpx.x} y={cpx.y + 10} textAnchor="middle" fontSize={9} fill="#475569"
                    style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 2 }}>
                    {blockFootprintArea(b).toFixed(1)} m² · h={b.height}m · {b.floors} lt
                  </text>
                  {isSel && tool === "edit" && polyPx.map((p, i) => (
                    <rect key={i} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="#fff" stroke="#facc15" strokeWidth={1.5}
                      style={{ cursor: "grab" }} />
                  ))}
                </g>
              );
            })}

            {/* Annotation lines */}
            {lines.map((ln) => {
              const a = worldToScreen(ln.a), b = worldToScreen(ln.b);
              const isTrim = trimFirst === ln.id || extendFirst === ln.id;
              return (
                <line key={ln.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={isTrim ? "#dc2626" : "#1e293b"} strokeWidth={isTrim ? 2 : 1.2} />
              );
            })}

            {/* Preview drawing */}
            {drawStart && cursorWorld && tool === "line" && (
              <line
                x1={worldToScreen(drawStart).x} y1={worldToScreen(drawStart).y}
                x2={worldToScreen(cursorWorld).x} y2={worldToScreen(cursorWorld).y}
                stroke="#0ea5e9" strokeWidth={1.2} strokeDasharray="4 3"
              />
            )}
            {drawStart && cursorWorld && tool === "rect" && (() => {
              const a = worldToScreen(drawStart), b = worldToScreen(cursorWorld);
              const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
              const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
              return <rect x={x} y={y} width={w} height={h} fill={FUNCTION_META[activeFn].color} fillOpacity={0.18} stroke="#0ea5e9" strokeDasharray="4 3" />;
            })()}
            {mirrorA && cursorWorld && tool === "mirror" && (
              <line x1={worldToScreen(mirrorA).x} y1={worldToScreen(mirrorA).y}
                    x2={worldToScreen(cursorWorld).x} y2={worldToScreen(cursorWorld).y}
                    stroke="#a855f7" strokeWidth={1.4} strokeDasharray="6 3" />
            )}

            {/* North arrow */}
            <g transform={`translate(${view.w - 60}, 60)`}>
              <circle r={26} fill="#fff" stroke="#0f172a" strokeWidth={1.2} />
              <g transform={`rotate(${((plan.northRot ?? 0) * 180) / Math.PI})`}>
                <polygon points="0,-22 6,8 0,4 -6,8" fill="#dc2626" stroke="#0f172a" strokeWidth={0.8} />
                <text x={0} y={-10} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">U</text>
              </g>
              {tool === "north" && (
                <text x={0} y={42} textAnchor="middle" fontSize={9} fill="#0f172a">klik kanvas untuk arah</text>
              )}
            </g>
          </svg>
        </div>

        {/* Status / cursor coord */}
        <div className="pointer-events-none absolute bottom-3 left-4 z-10 rounded-md border border-border bg-background/85 px-3 py-1.5 text-xs shadow backdrop-blur">
          <span className="text-muted-foreground">Skala </span>
          <span className="font-semibold">1:{scaleDenom}</span>
          <span className="mx-2 text-border">·</span>
          <span className="text-muted-foreground">Kursor </span>
          <span className="font-mono">
            {cursorWorld ? `${cursorWorld.x.toFixed(2)}, ${cursorWorld.y.toFixed(2)} m` : "—"}
          </span>
          <span className="mx-2 text-border">·</span>
          <span className="text-muted-foreground">Tool </span>
          <span className="font-medium">{tool}</span>
        </div>

        {/* Tool hint */}
        {(drawStart || mirrorA || trimFirst || extendFirst || rotateBase != null || tool === "north") && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-border bg-background/90 px-4 py-1.5 text-xs shadow backdrop-blur">
            {tool === "line" && drawStart && "Klik titik kedua untuk menutup garis (Esc batal)"}
            {tool === "rect" && drawStart && "Klik sudut kedua persegi (Esc batal)"}
            {tool === "mirror" && mirrorA && "Klik titik kedua sumbu cermin"}
            {tool === "trim" && trimFirst && "Klik garis pemotong"}
            {tool === "extend" && extendFirst && "Klik garis batas perpanjangan"}
            {tool === "rotate" && rotateBase != null && "Klik posisi rotasi target"}
            {tool === "north" && "Klik posisi target arah utara (Esc batal)"}
          </div>
        )}
      </section>

      {/* Panel kanan: Tools + Block info */}
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card/40 p-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Alat Gambar</h2>
          <p className="text-xs text-muted-foreground">Gambar massa lantai dasar; tinggi diisi per blok.</p>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <ToolBtn icon={<MousePointer2 className="h-4 w-4" />} label="Pilih" active={tool === "select"} onClick={() => setTool("select")} />
          <ToolBtn icon={<Minus className="h-4 w-4" />} label="Garis" active={tool === "line"} onClick={() => { setTool("line"); setDrawStart(null); }} />
          <ToolBtn icon={<Square className="h-4 w-4" />} label="Persegi" active={tool === "rect"} onClick={() => { setTool("rect"); setDrawStart(null); }} />
          <ToolBtn icon={<PenLine className="h-4 w-4" />} label="Edit Titik" active={tool === "edit"} onClick={() => setTool("edit")} />
          <ToolBtn icon={<MoveIcon className="h-4 w-4" />} label="Move" active={tool === "move"} onClick={() => setTool("move")} />
          <ToolBtn icon={<RotateCw className="h-4 w-4" />} label="Rotasi" active={tool === "rotate"} onClick={() => { setTool("rotate"); setRotateBase(null); }} />
          <ToolBtn icon={<FlipHorizontal2 className="h-4 w-4" />} label="Mirror" active={tool === "mirror"} onClick={() => { setTool("mirror"); setMirrorA(null); }} />
          <ToolBtn icon={<Scissors className="h-4 w-4" />} label="Trim" active={tool === "trim"} onClick={() => { setTool("trim"); setTrimFirst(null); }} />
          <ToolBtn icon={<ArrowRight className="h-4 w-4" />} label="Extend" active={tool === "extend"} onClick={() => { setTool("extend"); setExtendFirst(null); }} />
          <ToolBtn icon={<Hash className="h-4 w-4" />} label="Koordinat" active={tool === "coord"} onClick={() => setTool("coord")} />
          <ToolBtn icon={<CompassIcon className="h-4 w-4" />} label="Utara" active={tool === "north"} onClick={() => setTool("north")} />
          <ToolBtn icon={<Magnet className="h-4 w-4" />} label={`Snap ${snap ? "On" : "Off"}`} active={snap} onClick={() => setSnap((s) => !s)} />
        </div>

        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="flex-1" onClick={undo} disabled={history.length === 0}>
            <Undo2 className="mr-1 h-4 w-4" /> Undo
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={redo} disabled={redoStack.length === 0}>
            <Redo2 className="mr-1 h-4 w-4" /> Redo
          </Button>
        </div>

        {tool === "north" && (
          <div className="rounded-md border border-border bg-background/60 p-3 text-xs">
            Arah utara saat ini: <span className="font-mono">{(((plan.northRot ?? 0) * 180) / Math.PI).toFixed(1)}°</span>
            <div className="mt-1 flex items-center gap-2">
              <Input type="number" step={1} value={Math.round(((plan.northRot ?? 0) * 180) / Math.PI)}
                onChange={(e) => { const d = Number(e.target.value); if (Number.isFinite(d)) { pushHistory(); setPlanPatch({ northRot: (d * Math.PI) / 180 }); } }}
                className="h-7" />
              <span>°</span>
            </div>
            <div className="mt-2">Atau klik di kanvas — arah utara menunjuk dari pusat ke titik klik.</div>
            <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => { pushHistory(); setPlanPatch({ northRot: 0 }); }}>Reset Utara</Button>
            <div className="mt-2 hidden">{cursorWorld && onNorthClick}</div>
          </div>
        )}

        {/* Daftar blok */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs">Daftar Massa ({plan.blocks.length})</Label>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-md border border-border">
            {plan.blocks.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">Belum ada massa. Pilih alat Persegi lalu klik dua sudut.</div>
            ) : (
              <ul className="divide-y divide-border">
                {plan.blocks.map((b) => (
                  <li key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={cn("flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition",
                      selectedId === b.id ? "bg-foreground/5" : "hover:bg-muted/50")}>
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: FUNCTION_META[b.fn].color }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{b.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{b.id} · h={b.height}m</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Detail blok */}
        {selected ? (
          <div className="space-y-2 rounded-md border border-border bg-background/60 p-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Nama</Label>
              <Input value={selected.name} onChange={(e) => updateBlock(selected.id, { name: e.target.value })} className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Fungsi</Label>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {(Object.keys(FUNCTION_META) as MasterFunction[]).map((fn) => (
                  <button key={fn} onClick={() => updateBlock(selected.id, { fn })}
                    className={cn("rounded border px-2 py-1 text-[11px] transition",
                      selected.fn === fn ? "border-foreground font-semibold" : "border-border hover:bg-muted/50")}
                    style={selected.fn === fn ? { borderColor: FUNCTION_META[fn].color } : {}}>
                    {FUNCTION_META[fn].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Tinggi (m)</Label>
                <Input type="number" step={0.5} value={selected.height}
                  onChange={(e) => updateBlock(selected.id, { height: Math.max(0.1, Number(e.target.value) || 0.1) })}
                  className="h-8" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Lantai</Label>
                <Input type="number" step={1} value={selected.floors}
                  onChange={(e) => updateBlock(selected.id, { floors: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                  className="h-8" />
              </div>
            </div>
            <div className="rounded bg-muted/50 p-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Footprint</span>
                <span className="font-mono">{blockFootprintArea(selected).toFixed(2)} m²</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">GFA</span>
                <span className="font-mono font-semibold">{Math.round(blockGFA(selected)).toLocaleString("id-ID")} m²</span></div>
            </div>

            {/* Koordinat per-titik (tool=coord atau edit) */}
            {(tool === "coord" || tool === "edit") && selected.polygon && (
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Koordinat Titik (m)</Label>
                <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                  {selected.polygon.map((p, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="w-5 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                      <Input type="number" step={0.1} value={Number(p.x.toFixed(3))}
                        onChange={(e) => {
                          const v = Number(e.target.value); if (!Number.isFinite(v)) return;
                          const next = clone(selected.polygon!); next[i] = { x: v, y: next[i].y };
                          pushHistory(); updateBlock(selected.id, { polygon: next });
                        }}
                        className="h-7 text-xs" />
                      <Input type="number" step={0.1} value={Number(p.y.toFixed(3))}
                        onChange={(e) => {
                          const v = Number(e.target.value); if (!Number.isFinite(v)) return;
                          const next = clone(selected.polygon!); next[i] = { x: next[i].x, y: v };
                          pushHistory(); updateBlock(selected.id, { polygon: next });
                        }}
                        className="h-7 text-xs" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button className="w-full" onClick={() => goDetail(selected)}>
              Detailkan Bangunan <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="w-full text-destructive hover:text-destructive"
              onClick={() => { pushHistory(); setPlan((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== selected.id) })); setSelectedId(null); }}>
              <Trash2 className="mr-2 h-4 w-4" /> Hapus Massa
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Pilih sebuah massa untuk melihat dan mengubah detailnya.
          </div>
        )}

        <Link to="/presentasi" className="mt-1 inline-flex items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs transition hover:bg-muted/50">
          Lihat di Slide Presentasi <ArrowRight className="h-3 w-3" />
        </Link>
      </aside>

      <MasterplanClusterDialog
        open={clusterOpen}
        onOpenChange={setClusterOpen}
        existingPlan={plan}
        onCommit={(blocks) => {
          pushHistory();
          setPlan((p) => ({ ...p, blocks: [...p.blocks, ...blocks] }));
          if (blocks.length > 0) setSelectedId(blocks[0].id);
        }}
      />

      {/* Hidden helper for north tool — click on canvas while tool=north sets angle via cursorWorld */}
      <NorthClickListener
        enabled={tool === "north"}
        svgRef={svgRef}
        screenToWorld={screenToWorld}
        onPick={(p) => { pushHistory(); setPlanPatch({ northRot: Math.atan2(p.x, -p.y) }); setTool("select"); }}
      />
    </main>
  );
}

// ─────────────────────────── Komponen kecil ───────────────────────────

function ToolBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-md border px-2 py-2 text-[10px] transition",
        active ? "border-foreground bg-foreground/5 font-semibold" : "border-border hover:bg-muted/50",
      )}
      title={label}
    >
      {icon}
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}

function RegBox({
  label, unit, value, onChange, limitLabel, limit, rencanaLabel, rencana, deviasiInvert, step = 1,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  limitLabel: string;
  limit: number;
  rencanaLabel: string;
  rencana: number;
  deviasiInvert: boolean;
  step?: number;
}) {
  const dev = rencana - limit;
  const hasLimit = limit > 0;
  const over = dev > 0.005, under = dev < -0.005;
  const badIsOver = !deviasiInvert;
  const color = over
    ? badIsOver ? "text-red-500" : "text-green-500"
    : under
      ? badIsOver ? "text-green-500" : "text-red-500"
      : "text-muted-foreground";
  return (
    <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-1.5">
          <Input
            type="number" min={0} step={step}
            value={value ?? ""}
            placeholder="0"
            onChange={(e) => { const v = e.target.value; onChange(v === "" ? undefined : Math.max(0, Number(v))); }}
            className="h-7 w-16 text-right text-xs"
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted-foreground">{limitLabel}</span>
        <span className="font-display text-sm font-semibold">
          {limit > 0 ? limit.toFixed(2) : "—"}<span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted-foreground">{rencanaLabel}</span>
        <span className="font-display text-sm font-semibold">
          {rencana > 0 ? rencana.toFixed(2) : "—"}<span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
        </span>
      </div>
      <div className="flex items-baseline justify-between border-t border-border/40 pt-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Deviasi</span>
        {hasLimit ? (
          <span className={cn("font-display font-semibold", color)}>
            {over ? "+" : under ? "−" : ""}{Math.abs(dev).toFixed(2)}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">m²</span>
          </span>
        ) : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function NorthClickListener({
  enabled, svgRef, screenToWorld, onPick,
}: {
  enabled: boolean;
  svgRef: React.RefObject<SVGSVGElement | null>;
  screenToWorld: (p: Vec2) => Vec2;
  onPick: (p: Vec2) => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const svg = svgRef.current;
    if (!svg) return;
    const onClick = (e: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const w = screenToWorld(sp);
      // Don't trigger when clicking inside the north badge area (top-right 60x60)
      if (sp.x > rect.width - 90 && sp.y < 90) return;
      onPick(w);
    };
    svg.addEventListener("pointerdown", onClick, true);
    return () => svg.removeEventListener("pointerdown", onClick, true);
  }, [enabled, svgRef, screenToWorld, onPick]);
  return null;
}
