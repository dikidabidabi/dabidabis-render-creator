import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Edges, PerspectiveCamera, Grid, Line } from "@react-three/drei";
import { Plus, Trash2, Sparkles, Shuffle, Cable, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FUNCTION_META,
  type MasterFunction,
  type MassingBlock,
  type MasterPlan,
  type Vec2,
  polyBounds,
  polyCentroid,
  polyArea,
} from "@/lib/masterplan";
import { nearestRoadEdge, pointInRoadCorridor, roadNetworkRegions } from "@/lib/roads";

// ============================================================
// Master Plan — Cluster Generator (Grasshopper-style cables)
// ============================================================
// • Tiap node = bangunan (luas alas, jumlah lapis → tinggi & luas total
//   otomatis).
// • Klik 2 node dalam Mode Tautan → siklus hubungan:
//   none → langsung → tidak langsung → none.
// • Solver: force-directed dengan jarak ditentukan oleh hubungan; hasil
//   dijepit dalam bounding box layer "Lahan" (bila diberikan).
// ============================================================

export type CGRelation = "direct" | "indirect" | "none";
const FLOOR_HEIGHT_M = 4;

export type CGBuilding = {
  id: string;
  name: string;
  fn: MasterFunction;
  footprint: number; // m² alas
  floors: number;    // jumlah lapis
};

type CGPos = { id: string; x: number; z: number; w: number; d: number; h: number; rot: number };
type CGLayout = { seed: number; positions: CGPos[]; siteCenter: Vec2; siteExtent: number };
type RoadRef = { center: Vec2[]; widthM: number };

const REL_META: Record<CGRelation, { label: string; color: string; dash: string }> = {
  direct:   { label: "Langsung",        color: "#16a34a", dash: "0" },
  indirect: { label: "Tidak Langsung",  color: "#f59e0b", dash: "6 4" },
  none:     { label: "Tidak Ada",       color: "#cbd5e1", dash: "0" },
};

// ---------- RNG ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dimsFromFootprint(A: number): { w: number; d: number } {
  const a = Math.max(4, A);
  // ratio 4:3
  const w = Math.sqrt((a * 4) / 3);
  const d = a / w;
  return { w, d };
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit = yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// ---------- Solver ----------
function solveLayout(
  buildings: CGBuilding[],
  rel: Record<string, CGRelation>,
  seed: number,
  sitePoly?: Vec2[],
  avoidAxes?: { points: Vec2[]; bufferM: number }[],
): CGLayout {
  const rnd = mulberry32(seed);
  const items = buildings.map((b) => {
    const { w, d } = dimsFromFootprint(b.footprint);
    const h = Math.max(0.5, b.floors * FLOOR_HEIGHT_M);
    const r = Math.hypot(w, d) / 2;
    const ang = rnd() * Math.PI * 2;
    const init = 6 + rnd() * 18;
    return {
      id: b.id,
      x: Math.cos(ang) * init,
      z: Math.sin(ang) * init,
      vx: 0,
      vz: 0,
      w, d, h, r,
    };
  });

  // Site geometry (meters). If absent, infer from total footprint.
  const totalR = items.reduce((s, it) => s + it.r, 0);
  let center: Vec2 = { x: 0, y: 0 };
  let halfX = Math.max(40, totalR * 1.6);
  let halfZ = halfX;
  if (sitePoly && sitePoly.length >= 3) {
    const bb = polyBounds(sitePoly);
    center = polyCentroid(sitePoly);
    halfX = Math.max(20, (bb.maxX - bb.minX) / 2 - 2);
    halfZ = Math.max(20, (bb.maxY - bb.minY) / 2 - 2);
  }

  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const relOf = (a: string, b: string): CGRelation => rel[key(a, b)] ?? "none";

  const ITER = 360;
  for (let it = 0; it < ITER; it++) {
    const cooling = 1 - it / ITER;
    for (let i = 0; i < items.length; i++) {
      const A = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const B = items[j];
        const dx = B.x - A.x;
        const dz = B.z - A.z;
        const dist = Math.max(0.001, Math.hypot(dx, dz));
        const nx = dx / dist;
        const nz = dz / dist;
        const minDist = A.r + B.r + 2;
        const r = relOf(A.id, B.id);
        let force = 0;
        if (r === "direct") {
          const desired = minDist + 1;
          force = (dist - desired) * 0.09;
        } else if (r === "indirect") {
          const desired = minDist + 14;
          force = (dist - desired) * 0.045;
        } else {
          if (dist < minDist + 22) force = -((minDist + 22 - dist) * 0.035);
        }
        if (dist < minDist) force -= (minDist - dist) * 0.5;
        A.vx += nx * force; A.vz += nz * force;
        B.vx -= nx * force; B.vz -= nz * force;
      }
      // gentle centering
      A.vx += -A.x * 0.005;
      A.vz += -A.z * 0.005;
      // Aksis: repulsion dari polyline aksis (dlm koordinat dunia → konversi
      // ke koordinat lokal yg ber-pusat di centroid lahan).
      if (avoidAxes && avoidAxes.length) {
        const pw = { x: A.x + center.x, y: A.z + center.y };
        for (const ax of avoidAxes) {
          const buf = Math.max(0, ax.bufferM) + Math.max(A.w, A.d) / 2;
          // jarak ke polyline
          let best = Infinity; let bnx = 0; let bnz = 0;
          for (let k = 0; k < ax.points.length - 1; k++) {
            const p1 = ax.points[k], p2 = ax.points[k + 1];
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const l2 = dx * dx + dy * dy;
            let t = l2 > 1e-9 ? ((pw.x - p1.x) * dx + (pw.y - p1.y) * dy) / l2 : 0;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const cx = p1.x + t * dx, cy = p1.y + t * dy;
            const ex = pw.x - cx, ey = pw.y - cy;
            const d = Math.hypot(ex, ey);
            if (d < best) { best = d; bnx = d > 1e-6 ? ex / d : 0; bnz = d > 1e-6 ? ey / d : 0; }
          }
          if (best < buf) {
            const k = (buf - best) * 0.35;
            A.vx += bnx * k; A.vz += bnz * k;
          }
        }
      }
    }
    for (const it2 of items) {
      it2.x += it2.vx * cooling;
      it2.z += it2.vz * cooling;
      it2.vx *= 0.6;
      it2.vz *= 0.6;
      // clamp inside local box (centered at 0,0)
      const lx = halfX - it2.w / 2;
      const lz = halfZ - it2.d / 2;
      if (it2.x > lx) it2.x = lx;
      if (it2.x < -lx) it2.x = -lx;
      if (it2.z > lz) it2.z = lz;
      if (it2.z < -lz) it2.z = -lz;
    }
  }

  // Final overlap resolution
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        const dx = B.x - A.x, dz = B.z - A.z;
        const dist = Math.max(0.001, Math.hypot(dx, dz));
        const minDist = A.r + B.r + 1;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const nx = dx / dist, nz = dz / dist;
          A.x -= nx * push; A.z -= nz * push;
          B.x += nx * push; B.z += nz * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // Shift items to site center; if polygon defined, also nudge centroids inside.
  const positions: CGPos[] = items.map((it) => ({
    id: it.id,
    x: it.x + center.x,
    z: it.z + center.y,
    w: it.w, d: it.d, h: it.h,
  }));
  if (sitePoly && sitePoly.length >= 3) {
    for (const p of positions) {
      // crude pull-back if centroid outside polygon
      if (!pointInPolygon({ x: p.x, y: p.z }, sitePoly)) {
        const dx = center.x - p.x;
        const dz = center.y - p.z;
        const dl = Math.hypot(dx, dz) || 1;
        const step = Math.min(dl, 8);
        p.x += (dx / dl) * step;
        p.z += (dz / dl) * step;
      }
    }
  }
  return {
    seed,
    positions,
    siteCenter: center,
    siteExtent: Math.max(halfX, halfZ) * 2,
  };
}

// ---------- Mini 3D preview ----------
function MiniBlocks({
  buildings,
  layout,
  sitePoly,
}: {
  buildings: CGBuilding[];
  layout: CGLayout;
  sitePoly?: Vec2[];
}) {
  const byId = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);
  const c = layout.siteCenter;
  // shape for site outline (relative to center)
  const sitePts = useMemo(() => {
    if (sitePoly && sitePoly.length >= 3) {
      return sitePoly.map((p) => [p.x - c.x, p.y - c.y] as [number, number]);
    }
    const e = layout.siteExtent / 2;
    return [
      [-e, -e], [e, -e], [e, e], [-e, e],
    ] as [number, number][];
  }, [sitePoly, c.x, c.y, layout.siteExtent]);

  const extent = useMemo(() => {
    let r = 30;
    for (const [x, z] of sitePts) r = Math.max(r, Math.abs(x), Math.abs(z));
    return r;
  }, [sitePts]);
  const camDist = extent * 2.6;

  return (
    <Canvas dpr={[1, 2]}>
      <PerspectiveCamera makeDefault position={[camDist, camDist * 0.9, camDist]} fov={40} />
      <OrbitControls enableDamping target={[0, 0, 0]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[camDist, camDist, camDist * 0.5]} intensity={1.0} />
      <Grid
        args={[extent * 3, extent * 3]}
        cellSize={5}
        cellThickness={0.4}
        cellColor="#cbd5e1"
        sectionSize={25}
        sectionThickness={1}
        sectionColor="#94a3b8"
        position={[0, 0.01, 0]}
        fadeDistance={extent * 5}
      />
      {/* site outline (Lahan) */}
      <Line
        points={[...sitePts.map(([x, z]) => [x, 0.04, z] as [number, number, number]),
                 [sitePts[0][0], 0.04, sitePts[0][1]] as [number, number, number]]}
        color="#16a34a"
        lineWidth={1.6}
      />
      {/* blocks (translated relative to site center) */}
      {layout.positions.map((p) => {
        const b = byId.get(p.id);
        if (!b) return null;
        const meta = FUNCTION_META[b.fn];
        return (
          <mesh key={p.id} position={[p.x - c.x, p.h / 2, p.z - c.y]}>
            <boxGeometry args={[p.w, p.h, p.d]} />
            <meshStandardMaterial color={meta.color} roughness={0.85} />
            <Edges color="#0f172a" threshold={15} />
          </mesh>
        );
      })}
    </Canvas>
  );
}


// ---------- Main dialog ----------
export function MasterplanClusterDialog({
  open,
  onOpenChange,
  onCommit,
  existingPlan,
  sitePolygon,
  avoidAxes,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCommit: (blocks: MassingBlock[]) => void;
  existingPlan: MasterPlan;
  /** Polygon layer "Lahan" dalam koordinat meter (world). */
  sitePolygon?: Vec2[];
  /** Polyline aksis dalam koordinat meter (world) yang harus dihindari massa. */
  avoidAxes?: { points: Vec2[]; bufferM: number }[];
}) {
  const [buildings, setBuildings] = useState<CGBuilding[]>([]);
  const [rel, setRel] = useState<Record<string, CGRelation>>({});
  const [layouts, setLayouts] = useState<CGLayout[]>([]);
  const [generating, setGenerating] = useState(false);

  // Node-editor (Grasshopper style)
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [, forceRender] = useState(0);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (buildings.length === 0) {
      setBuildings([
        mkB("Tower A", "komersial", 600, 8),
        mkB("Galeri",  "fasum",     400, 2),
        mkB("Plaza",   "rth",       300, 1),
      ]);
    }
    // initialize positions for any node missing one
    buildings.forEach((b, i) => {
      if (!posRef.current.has(b.id)) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        posRef.current.set(b.id, { x: 90 + col * 150, y: 80 + row * 120 });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ensure positions exist for any added building
  useEffect(() => {
    buildings.forEach((b, i) => {
      if (!posRef.current.has(b.id)) {
        posRef.current.set(b.id, {
          x: 120 + (i % 4) * 150,
          y: 100 + Math.floor(i / 4) * 120,
        });
      }
    });
  }, [buildings]);

  const addBuilding = useCallback(() => {
    setBuildings((bs) => [...bs, mkB(`Bangunan ${bs.length + 1}`, "komersial", 300, 3)]);
  }, []);
  const updateBuilding = useCallback((id: string, patch: Partial<CGBuilding>) => {
    setBuildings((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);
  const removeBuilding = useCallback((id: string) => {
    setBuildings((bs) => bs.filter((b) => b.id !== id));
    setRel((r) => {
      const n: Record<string, CGRelation> = {};
      for (const k of Object.keys(r)) if (!k.includes(id)) n[k] = r[k];
      return n;
    });
    posRef.current.delete(id);
  }, []);

  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const cycleRel = (a: string, b: string) => {
    if (a === b) return;
    const k = pairKey(a, b);
    setRel((r) => {
      const cur = r[k] ?? "none";
      const next: CGRelation = cur === "none" ? "direct" : cur === "direct" ? "indirect" : "none";
      const out = { ...r };
      if (next === "none") delete out[k]; else out[k] = next;
      return out;
    });
  };

  const onNodeClick = (id: string) => {
    if (!linkMode) return;
    if (linkFrom === null) { setLinkFrom(id); return; }
    cycleRel(linkFrom, id);
    setLinkFrom(null);
  };

  // Drag handlers
  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - dragRef.current.dx;
    const y = e.clientY - rect.top - dragRef.current.dy;
    posRef.current.set(dragRef.current.id, { x, y });
    forceRender((n) => n + 1);
  };
  const onSvgPointerUp = () => { dragRef.current = null; };

  const generate = useCallback(() => {
    if (buildings.length < 1) return;
    setGenerating(true);
    setTimeout(() => {
      const seeds = [
        Math.floor(Math.random() * 1e9),
        Math.floor(Math.random() * 1e9),
        Math.floor(Math.random() * 1e9),
      ];
      const next = seeds.map((s) => solveLayout(buildings, rel, s, sitePolygon, avoidAxes));
      setLayouts(next);
      setGenerating(false);
    }, 20);
  }, [buildings, rel, sitePolygon, avoidAxes]);

  const pickLayout = useCallback(
    (layout: CGLayout) => {
      const used = new Set(existingPlan.blocks.map((b) => b.id));
      const blocks: MassingBlock[] = layout.positions.map((p, i) => {
        const src = buildings.find((b) => b.id === p.id)!;
        let n = existingPlan.blocks.length + i + 1;
        let id = `block-${String(n).padStart(2, "0")}`;
        while (used.has(id)) { n++; id = `block-${String(n).padStart(2, "0")}`; }
        used.add(id);
        const w = Math.round(p.w * 10) / 10;
        const d = Math.round(p.d * 10) / 10;
        const cx = Math.round(p.x * 10) / 10;
        const cz = Math.round(p.z * 10) / 10;
        const hx = w / 2, hz = d / 2;
        return {
          id, name: src.name, fn: src.fn,
          x: cx, z: cz, w, d,
          height: Math.round(p.h * 10) / 10,
          floors: src.floors,
          rotation: 0,
          polygon: [
            { x: cx - hx, y: cz - hz },
            { x: cx + hx, y: cz - hz },
            { x: cx + hx, y: cz + hz },
            { x: cx - hx, y: cz + hz },
          ],
        };
      });
      onCommit(blocks);
      onOpenChange(false);
      setLayouts([]);
    },
    [buildings, existingPlan, onCommit, onOpenChange],
  );

  const siteAreaM2 = useMemo(
    () => (sitePolygon && sitePolygon.length >= 3 ? polyArea(sitePolygon) : 0),
    [sitePolygon],
  );

  const totalFootprint = buildings.reduce((s, b) => s + (b.footprint || 0), 0);
  const totalGFA = buildings.reduce((s, b) => s + (b.footprint || 0) * Math.max(1, b.floors || 1), 0);

  // Cable list (rendered SVG paths)
  const cables = useMemo(() => {
    const arr: { a: string; b: string; r: CGRelation }[] = [];
    for (const k of Object.keys(rel)) {
      const [a, b] = k.split("|");
      arr.push({ a, b, r: rel[k] });
    }
    return arr;
  }, [rel]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-7xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 font-display">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Cluster Generator — Tata Massa Kawasan
            {sitePolygon && sitePolygon.length >= 3 ? (
              <span className="ml-3 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                Lahan terdeteksi · {siteAreaM2.toFixed(0)} m²
              </span>
            ) : (
              <span className="ml-3 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                Belum ada layer “Lahan” — hasil dibatasi bounding box otomatis.
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* LEFT — Grasshopper canvas */}
          <div className="flex min-w-0 flex-1 flex-col border-r">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
              <Button size="sm" variant="outline" onClick={addBuilding}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Tambah Bangunan
              </Button>
              <Button
                size="sm"
                variant={linkMode ? "default" : "outline"}
                onClick={() => { setLinkMode((v) => !v); setLinkFrom(null); }}
                title="Aktifkan Mode Tautan lalu klik 2 node. Klik ulang pasangan sama untuk berpindah jenis hubungan."
              >
                <Cable className="mr-1 h-3.5 w-3.5" />
                {linkMode ? "Mode Tautan ON" : "Tautan"}
              </Button>
              <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>{buildings.length} node · {cables.length} kabel</span>
                <span className="flex items-center gap-1.5">
                  {(["direct", "indirect", "none"] as CGRelation[]).map((k) => (
                    <span key={k} className="flex items-center gap-1">
                      <span
                        className="inline-block h-1.5 w-5 rounded"
                        style={{
                          background: REL_META[k].color,
                          backgroundImage: k === "indirect"
                            ? "repeating-linear-gradient(90deg,#f59e0b 0 4px,transparent 4px 8px)"
                            : undefined,
                        }}
                      />
                      {REL_META[k].label}
                    </span>
                  ))}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-[radial-gradient(circle,#e5e5e5_1px,transparent_1px)] [background-size:16px_16px]">
              <svg
                ref={svgRef}
                width="100%"
                height="100%"
                className="min-h-[420px]"
                onPointerMove={onSvgPointerMove}
                onPointerUp={onSvgPointerUp}
                onPointerLeave={onSvgPointerUp}
              >
                {/* cables */}
                {cables.map((c, i) => {
                  if (c.r === "none") return null;
                  const A = posRef.current.get(c.a);
                  const B = posRef.current.get(c.b);
                  if (!A || !B) return null;
                  const meta = REL_META[c.r];
                  const mx = (A.x + B.x) / 2;
                  const my = (A.y + B.y) / 2 + Math.hypot(B.x - A.x, B.y - A.y) * 0.18;
                  return (
                    <g key={i}>
                      <path
                        d={`M${A.x},${A.y} Q${mx},${my} ${B.x},${B.y}`}
                        fill="none"
                        stroke={meta.color}
                        strokeWidth={2.4}
                        strokeDasharray={meta.dash}
                        opacity={0.9}
                      />
                    </g>
                  );
                })}
                {/* nodes */}
                {buildings.map((b) => {
                  const p = posRef.current.get(b.id) ?? { x: 120, y: 100 };
                  const meta = FUNCTION_META[b.fn];
                  const selected = linkFrom === b.id;
                  const h = b.floors * FLOOR_HEIGHT_M;
                  const gfa = b.footprint * Math.max(1, b.floors);
                  return (
                    <g
                      key={b.id}
                      transform={`translate(${p.x},${p.y})`}
                      style={{ cursor: linkMode ? "pointer" : "grab" }}
                      onPointerDown={(e) => {
                        if (linkMode) return;
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                        const rect = svgRef.current!.getBoundingClientRect();
                        dragRef.current = {
                          id: b.id,
                          dx: e.clientX - rect.left - p.x,
                          dy: e.clientY - rect.top - p.y,
                        };
                      }}
                      onClick={() => onNodeClick(b.id)}
                    >
                      <rect
                        x={-72} y={-30}
                        width={144} height={60}
                        rx={8}
                        fill="#ffffff"
                        stroke={selected ? "#ea580c" : meta.color}
                        strokeWidth={selected ? 3 : 2}
                      />
                      <rect x={-72} y={-30} width={6} height={60} fill={meta.color} />
                      <text x={-60} y={-12} fontSize={11} fontWeight={700} fill="#0f172a">
                        {b.name.length > 16 ? b.name.slice(0, 15) + "…" : b.name}
                      </text>
                      <text x={-60} y={4} fontSize={10} fill="#475569">
                        {b.footprint} m² · {b.floors} lt
                      </text>
                      <text x={-60} y={20} fontSize={10} fill="#0f172a" fontWeight={600}>
                        GFA {gfa.toLocaleString("id-ID")} m² · ±{h} m
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              {linkMode
                ? linkFrom
                  ? "Pilih node kedua untuk siklus hubungan: none → langsung → tidak langsung → none."
                  : "Pilih node pertama, lalu node kedua."
                : "Seret node untuk mengatur posisi. Aktifkan Mode Tautan untuk menggambar kabel."}
            </div>
          </div>

          {/* RIGHT — properties table */}
          <div className="flex w-[420px] flex-col">
            <div className="border-b bg-muted/30 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              Properti Bangunan
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-2">
              {buildings.map((b) => {
                const h = b.floors * FLOOR_HEIGHT_M;
                const gfa = b.footprint * Math.max(1, b.floors);
                const meta = FUNCTION_META[b.fn];
                return (
                  <div key={b.id} className="space-y-1.5 rounded border border-border/60 bg-background p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-sm" style={{ background: meta.color }} />
                      <Input
                        value={b.name}
                        onChange={(e) => updateBuilding(b.id, { name: e.target.value })}
                        className="h-7 flex-1 text-xs"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => removeBuilding(b.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <select
                        value={b.fn}
                        onChange={(e) => updateBuilding(b.id, { fn: e.target.value as MasterFunction })}
                        className="h-7 rounded border border-input bg-background px-1.5 text-xs"
                      >
                        {(Object.keys(FUNCTION_META) as MasterFunction[]).map((f) => (
                          <option key={f} value={f}>{FUNCTION_META[f].label}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={b.footprint}
                          onChange={(e) =>
                            updateBuilding(b.id, { footprint: Math.max(0, Number(e.target.value) || 0) })
                          }
                          className="h-7 text-xs"
                        />
                        <span className="text-[10px] text-muted-foreground">m²</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={b.floors}
                          onChange={(e) =>
                            updateBuilding(b.id, { floors: Math.max(1, Math.round(Number(e.target.value) || 1)) })
                          }
                          className="h-7 text-xs"
                        />
                        <span className="text-[10px] text-muted-foreground">lt</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Tinggi otomatis: <b className="text-foreground">{h} m</b></span>
                      <span>Luas total: <b className="text-foreground">{gfa.toLocaleString("id-ID")} m²</b></span>
                    </div>
                  </div>
                );
              })}
              {buildings.length === 0 && (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  Belum ada bangunan. Klik “Tambah Bangunan”.
                </div>
              )}
            </div>
            <div className="space-y-1 border-t bg-muted/20 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total alas (footprint)</span>
                <span className={cn("tabular-nums font-semibold", siteAreaM2 > 0 && totalFootprint > siteAreaM2 && "text-red-500")}>
                  {totalFootprint.toLocaleString("id-ID")} m²
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total luas bangunan (GFA)</span>
                <span className="tabular-nums font-semibold">{totalGFA.toLocaleString("id-ID")} m²</span>
              </div>
              {siteAreaM2 > 0 && (
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Luas Lahan</span>
                  <span>{siteAreaM2.toLocaleString("id-ID")} m²</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Generate */}
        <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-3">
          <div className="text-[11px] text-muted-foreground">
            Solver force-directed: <b>langsung</b> menarik dekat,
            <b> tidak langsung</b> jaga jarak menengah, <b>tidak terhubung</b> saling tolak.
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              <X className="mr-1 h-4 w-4" /> Tutup
            </Button>
            <Button onClick={generate} disabled={buildings.length < 1 || generating}>
              <Shuffle className="mr-2 h-4 w-4" />
              {generating ? "Menghitung…" : "Generate 3 Alternatif"}
            </Button>
          </div>
        </div>

        {/* Alternatives */}
        {layouts.length > 0 && (
          <div className="border-t bg-background px-4 py-3">
            <h3 className="mb-2 text-sm font-semibold">Alternatif Tata Massa (di area Lahan)</h3>
            <div className="grid gap-3 md:grid-cols-3">
              {layouts.map((L, idx) => (
                <div
                  key={L.seed}
                  className="flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
                >
                  <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5 text-xs">
                    <span className="font-medium">Alternatif {idx + 1}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      seed {L.seed.toString(36).slice(0, 5)}
                    </span>
                  </div>
                  <div className="h-56 w-full bg-slate-50">
                    <MiniBlocks buildings={buildings} layout={L} sitePoly={sitePolygon} />
                  </div>
                  <div className="p-2">
                    <Button size="sm" className="w-full" onClick={() => pickLayout(L)}>
                      Pilih Alternatif Ini
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function mkB(name: string, fn: MasterFunction, footprint: number, floors: number): CGBuilding {
  return {
    id: `cg-${Math.random().toString(36).slice(2, 8)}`,
    name, fn, footprint, floors,
  };
}
