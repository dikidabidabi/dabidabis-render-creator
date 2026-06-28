import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Edges, PerspectiveCamera, Grid } from "@react-three/drei";
import { Plus, Trash2, Sparkles, Shuffle, Compass } from "lucide-react";
import {
  FUNCTION_META,
  type MasterFunction,
  type MassingBlock,
  nextBlockId,
  type MasterPlan,
} from "@/lib/masterplan";

// ---- Types ----
export type CGAccess = "near" | "far" | "neutral";
export type CGHierarchy = "focal" | "secondary" | "support";
export type CGSkyline = "centerHigh" | "taperEdge";
export type CGGate = "N" | "S" | "E" | "W";

export type CGBuilding = {
  id: string;
  name: string;
  fn: MasterFunction;
  footprint: number;
  volume: number;
  access: CGAccess;
  hierarchy: CGHierarchy;
  skyline: CGSkyline;
};

export type CGRelation = "direct" | "indirect" | "none";

type CGPos = { id: string; x: number; z: number; w: number; d: number; h: number };
type CGLayout = { seed: number; positions: CGPos[]; gate: CGGate };

const REL_META: Record<CGRelation, { label: string; color: string }> = {
  direct: { label: "Hubungan Langsung", color: "#16a34a" },
  indirect: { label: "Hubungan Tidak Langsung", color: "#f59e0b" },
  none: { label: "Tidak Ada Hubungan", color: "#e5e7eb" },
};

const GATE_LABEL: Record<CGGate, string> = { N: "Utara", S: "Selatan", E: "Timur", W: "Barat" };
// World convention: +Z = Selatan, -Z = Utara, +X = Timur, -X = Barat.
const GATE_VEC: Record<CGGate, { x: number; z: number }> = {
  N: { x: 0, z: -1 },
  S: { x: 0, z: 1 },
  E: { x: 1, z: 0 },
  W: { x: -1, z: 0 },
};

// ---- RNG ----
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
  const w = Math.sqrt((a * 4) / 3);
  const d = a / w;
  return { w, d };
}

// ---- Force-directed solver with site context ----
function solveLayout(
  buildings: CGBuilding[],
  rel: Record<string, CGRelation>,
  seed: number,
  gate: CGGate,
): CGPos[] {
  const rnd = mulberry32(seed);
  // Detect focal-and-tallest: focal hierarchy with the maximum height among focals.
  let maxFocalH = -Infinity;
  for (const b of buildings) {
    const h = b.volume > 0 && b.footprint > 0 ? b.volume / b.footprint : 0;
    if (b.hierarchy === "focal" && h > maxFocalH) maxFocalH = h;
  }

  const items = buildings.map((b) => {
    const { w, d } = dimsFromFootprint(b.footprint);
    const h = b.volume > 0 && b.footprint > 0 ? b.volume / b.footprint : 6;
    const r = Math.hypot(w, d) / 2;
    const isCentral = b.hierarchy === "focal" && h >= maxFocalH - 0.01;
    // initial position biased by hierarchy
    const ang = rnd() * Math.PI * 2;
    const initR =
      b.hierarchy === "focal" ? 5 + rnd() * 10 : b.hierarchy === "secondary" ? 25 + rnd() * 20 : 45 + rnd() * 25;
    return {
      id: b.id,
      x: Math.cos(ang) * initR,
      z: Math.sin(ang) * initR,
      vx: 0,
      vz: 0,
      w,
      d,
      h,
      r,
      access: b.access,
      hierarchy: b.hierarchy,
      skyline: b.skyline,
      isCentral,
    };
  });

  // Rough site radius: scales with number / size of buildings
  const totalR = items.reduce((s, it) => s + it.r, 0);
  const siteR = Math.max(40, totalR * 1.4);
  const gateVec = GATE_VEC[gate];
  const gateAnchor = { x: gateVec.x * siteR, z: gateVec.z * siteR };

  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const relOf = (a: string, b: string): CGRelation => rel[key(a, b)] ?? "none";

  const ITER = 360;
  for (let it = 0; it < ITER; it++) {
    const cooling = 1 - it / ITER;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.max(0.001, Math.hypot(dx, dz));
        const nx = dx / dist;
        const nz = dz / dist;
        const minDist = a.r + b.r + 2;
        const r = relOf(a.id, b.id);

        let force = 0;
        if (r === "direct") {
          const desired = minDist + 1;
          force = (dist - desired) * 0.08;
        } else if (r === "indirect") {
          const desired = minDist + 12;
          force = (dist - desired) * 0.04;
        } else {
          if (dist < minDist + 20) {
            force = -((minDist + 20 - dist) * 0.03);
          }
        }
        if (dist < minDist) {
          force -= (minDist - dist) * 0.5;
        }
        const fx = nx * force;
        const fz = nz * force;
        a.vx += fx;
        a.vz += fz;
        b.vx -= fx;
        b.vz -= fz;
      }

      const it1 = items[i];
      // --- Gate access force ---
      const toGateX = gateAnchor.x - it1.x;
      const toGateZ = gateAnchor.z - it1.z;
      const gDist = Math.max(1, Math.hypot(toGateX, toGateZ));
      const gnx = toGateX / gDist;
      const gnz = toGateZ / gDist;
      if (it1.access === "near") {
        // pull toward gate anchor
        it1.vx += gnx * 0.18;
        it1.vz += gnz * 0.18;
      } else if (it1.access === "far") {
        it1.vx -= gnx * 0.14;
        it1.vz -= gnz * 0.14;
      }

      // --- Central gravity (hierarchy / skyline) ---
      const rad = Math.max(0.001, Math.hypot(it1.x, it1.z));
      const cnx = -it1.x / rad;
      const cnz = -it1.z / rad;
      let centerPull = 0;
      if (it1.isCentral) centerPull = 0.35;
      else if (it1.hierarchy === "focal") centerPull = 0.18;
      else if (it1.hierarchy === "secondary") centerPull = 0.04;
      else centerPull = -0.06; // support is pushed outward
      // skyline shaping
      if (it1.skyline === "centerHigh") {
        // taller -> stronger center pull
        centerPull += (it1.h / 60) * 0.12;
      } else {
        // taperEdge: taller drifts to edge
        centerPull -= (it1.h / 60) * 0.08;
      }
      it1.vx += cnx * centerPull;
      it1.vz += cnz * centerPull;

      // soft site boundary
      if (rad > siteR) {
        it1.vx += cnx * (rad - siteR) * 0.05;
        it1.vz += cnz * (rad - siteR) * 0.05;
      }
    }

    for (const it2 of items) {
      it2.x += it2.vx * cooling;
      it2.z += it2.vz * cooling;
      it2.vx *= 0.6;
      it2.vz *= 0.6;
    }
  }

  // final overlap resolution
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i],
          b = items[j];
        const dx = b.x - a.x,
          dz = b.z - a.z;
        const dist = Math.max(0.001, Math.hypot(dx, dz));
        const minDist = a.r + b.r + 1;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const nx = dx / dist,
            nz = dz / dist;
          // central items resist displacement
          const aLock = a.isCentral ? 0.2 : 1;
          const bLock = b.isCentral ? 0.2 : 1;
          a.x -= nx * push * aLock;
          a.z -= nz * push * aLock;
          b.x += nx * push * bLock;
          b.z += nz * push * bLock;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // Variation: rotate whole formation by seed-driven angle (keeps gate logic intact
  // because it was applied during the simulation, then we rotate the result for
  // visual variety relative to other alternatives). To preserve gate semantics
  // visually, use a small jitter only.
  const jitter = (mulberry32(seed ^ 0x9e3779b9)() - 0.5) * (Math.PI / 6); // ±15°
  const cos = Math.cos(jitter);
  const sin = Math.sin(jitter);
  return items.map((it) => ({
    id: it.id,
    x: it.x * cos - it.z * sin,
    z: it.x * sin + it.z * cos,
    w: it.w,
    d: it.d,
    h: it.h,
  }));
}

// ---- Mini 3D preview ----
function MiniBlocks({
  buildings,
  layout,
}: {
  buildings: CGBuilding[];
  layout: CGLayout;
}) {
  const byId = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);
  const extent = useMemo(() => {
    let r = 30;
    for (const p of layout.positions) {
      r = Math.max(r, Math.abs(p.x) + p.w / 2, Math.abs(p.z) + p.d / 2);
    }
    return r;
  }, [layout]);
  const camDist = extent * 2.4;
  const gateVec = GATE_VEC[layout.gate];
  const gateMarker: [number, number, number] = [gateVec.x * extent * 1.05, 0.2, gateVec.z * extent * 1.05];
  return (
    <Canvas dpr={[1, 2]}>
      <PerspectiveCamera makeDefault position={[camDist, camDist * 0.8, camDist]} fov={40} />
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
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[extent * 3, extent * 3]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      {/* gate marker */}
      <mesh position={gateMarker}>
        <cylinderGeometry args={[extent * 0.06, extent * 0.06, 0.4, 24]} />
        <meshStandardMaterial color="#ea580c" />
      </mesh>
      {layout.positions.map((p) => {
        const b = byId.get(p.id);
        if (!b) return null;
        const meta = FUNCTION_META[b.fn];
        return (
          <mesh key={p.id} position={[p.x, p.h / 2, p.z]}>
            <boxGeometry args={[p.w, p.h, p.d]} />
            <meshStandardMaterial color={meta.color} roughness={0.85} />
            <Edges color="#0f172a" threshold={15} />
          </mesh>
        );
      })}
    </Canvas>
  );
}

// ---- Main dialog ----
export function MasterplanClusterDialog({
  open,
  onOpenChange,
  onCommit,
  existingPlan,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCommit: (blocks: MassingBlock[]) => void;
  existingPlan: MasterPlan;
}) {
  const [buildings, setBuildings] = useState<CGBuilding[]>([]);
  const [rel, setRel] = useState<Record<string, CGRelation>>({});
  const [layouts, setLayouts] = useState<CGLayout[]>([]);
  const [generating, setGenerating] = useState(false);
  const [gate, setGate] = useState<CGGate>("S");

  useEffect(() => {
    if (!open) return;
    if (buildings.length > 0) return;
    setBuildings([
      mkB("Ballroom", "komersial", 600, 4800, { hierarchy: "focal", skyline: "centerHigh", access: "near" }),
      mkB("Galeri", "fasum", 400, 2400, { hierarchy: "secondary", skyline: "centerHigh", access: "neutral" }),
      mkB("Plaza", "rth", 300, 150, { hierarchy: "support", skyline: "taperEdge", access: "near" }),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addBuilding = useCallback(() => {
    setBuildings((bs) => [
      ...bs,
      mkB(`Bangunan ${bs.length + 1}`, "komersial", 300, 1800),
    ]);
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
  }, []);

  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const setRelFor = (a: string, b: string, v: CGRelation) =>
    setRel((r) => ({ ...r, [pairKey(a, b)]: v }));

  const generate = useCallback(() => {
    if (buildings.length < 2) return;
    setGenerating(true);
    setTimeout(() => {
      const seeds = [
        Math.floor(Math.random() * 1e9),
        Math.floor(Math.random() * 1e9),
        Math.floor(Math.random() * 1e9),
      ];
      const next: CGLayout[] = seeds.map((s) => ({
        seed: s,
        gate,
        positions: solveLayout(buildings, rel, s, gate),
      }));
      setLayouts(next);
      setGenerating(false);
    }, 20);
  }, [buildings, rel, gate]);

  const pickLayout = useCallback(
    (layout: CGLayout) => {
      let offsetX = 0;
      const offsetZ = 0;
      if (existingPlan.blocks.length > 0) {
        let maxX = -Infinity;
        for (const b of existingPlan.blocks) maxX = Math.max(maxX, b.x + b.w / 2);
        offsetX = maxX + 30;
      }
      const used = new Set(existingPlan.blocks.map((b) => b.id));
      const blocks: MassingBlock[] = layout.positions.map((p, i) => {
        const src = buildings.find((b) => b.id === p.id)!;
        let n = existingPlan.blocks.length + i + 1;
        let id = `block-${String(n).padStart(2, "0")}`;
        while (used.has(id)) {
          n++;
          id = `block-${String(n).padStart(2, "0")}`;
        }
        used.add(id);
        const floors = Math.max(1, Math.round(p.h / 4));
        return {
          id,
          name: src.name,
          fn: src.fn,
          x: Math.round(p.x + offsetX),
          z: Math.round(p.z + offsetZ),
          w: Math.round(p.w * 10) / 10,
          d: Math.round(p.d * 10) / 10,
          height: Math.round(p.h * 10) / 10,
          floors,
        };
      });
      onCommit(blocks);
      onOpenChange(false);
      setLayouts([]);
    },
    [buildings, existingPlan, onCommit, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[95vw] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Cluster Generator — Tata Massa Kawasan
          </DialogTitle>
        </DialogHeader>

        {/* Site context */}
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary" />
            <span className="font-semibold">Konteks Tapak</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-muted-foreground">Gerbang Utama:</label>
            <select
              value={gate}
              onChange={(e) => setGate(e.target.value as CGGate)}
              className="h-7 rounded border border-border bg-background px-2 text-xs"
            >
              {(Object.keys(GATE_LABEL) as CGGate[]).map((g) => (
                <option key={g} value={g}>
                  {GATE_LABEL[g]}
                </option>
              ))}
            </select>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Anchor magnet diletakkan pada sisi {GATE_LABEL[gate].toLowerCase()} tapak.
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Buildings table */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">1. Data Bangunan</h3>
              <Button size="sm" variant="outline" onClick={addBuilding}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Tambah
              </Button>
            </div>
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2">Nama</th>
                    <th className="p-2">Fungsi</th>
                    <th className="p-2">Luas</th>
                    <th className="p-2">Volume</th>
                    <th className="p-2">Tinggi</th>
                    <th className="p-2">Akses</th>
                    <th className="p-2">Hierarki</th>
                    <th className="p-2">Skyline</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {buildings.map((b) => {
                    const h =
                      b.volume > 0 && b.footprint > 0 ? b.volume / b.footprint : 0;
                    return (
                      <tr key={b.id} className="border-t border-border align-top">
                        <td className="p-1">
                          <Input
                            value={b.name}
                            onChange={(e) => updateBuilding(b.id, { name: e.target.value })}
                            className="h-7 w-28 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <select
                            value={b.fn}
                            onChange={(e) =>
                              updateBuilding(b.id, { fn: e.target.value as MasterFunction })
                            }
                            className="h-7 rounded border border-border bg-background px-1 text-xs"
                          >
                            {(Object.keys(FUNCTION_META) as MasterFunction[]).map((f) => (
                              <option key={f} value={f}>
                                {FUNCTION_META[f].label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-1">
                          <Input
                            type="number"
                            value={b.footprint}
                            onChange={(e) =>
                              updateBuilding(b.id, { footprint: Number(e.target.value) || 0 })
                            }
                            className="h-7 w-16 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            type="number"
                            value={b.volume}
                            onChange={(e) =>
                              updateBuilding(b.id, { volume: Number(e.target.value) || 0 })
                            }
                            className="h-7 w-20 text-xs"
                          />
                        </td>
                        <td className="p-1 font-mono tabular-nums text-muted-foreground">
                          {h ? `${h.toFixed(1)}m` : "—"}
                        </td>
                        <td className="p-1">
                          <select
                            value={b.access}
                            onChange={(e) =>
                              updateBuilding(b.id, { access: e.target.value as CGAccess })
                            }
                            className="h-7 rounded border border-border bg-background px-1 text-xs"
                          >
                            <option value="near">Dekat Akses</option>
                            <option value="far">Jauh / Privat</option>
                            <option value="neutral">Netral</option>
                          </select>
                        </td>
                        <td className="p-1">
                          <select
                            value={b.hierarchy}
                            onChange={(e) =>
                              updateBuilding(b.id, { hierarchy: e.target.value as CGHierarchy })
                            }
                            className="h-7 rounded border border-border bg-background px-1 text-xs"
                          >
                            <option value="focal">Terpenting</option>
                            <option value="secondary">Sekunder</option>
                            <option value="support">Penunjang</option>
                          </select>
                        </td>
                        <td className="p-1">
                          <select
                            value={b.skyline}
                            onChange={(e) =>
                              updateBuilding(b.id, { skyline: e.target.value as CGSkyline })
                            }
                            className="h-7 rounded border border-border bg-background px-1 text-xs"
                          >
                            <option value="centerHigh">Tertinggi di Pusat</option>
                            <option value="taperEdge">Melandai ke Tepi</option>
                          </select>
                        </td>
                        <td className="p-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeBuilding(b.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {buildings.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-4 text-center text-muted-foreground">
                        Belum ada bangunan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Tinggi otomatis = Volume / Luas. Alas box memakai rasio 4:3. Bangunan
              "Terpenting" dengan tinggi terbesar mendapat gaya gravitasi pusat maksimum.
            </p>
          </section>

          {/* Adjacency matrix */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">2. Matriks Hubungan Ruang</h3>
            {buildings.length < 2 ? (
              <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Tambah minimal 2 bangunan untuk menentukan hubungan.
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr>
                      <th className="bg-muted/40 p-2 text-left"></th>
                      {buildings.map((b) => (
                        <th
                          key={b.id}
                          className="bg-muted/40 p-2 text-left font-medium"
                          style={{ minWidth: 90 }}
                        >
                          {b.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {buildings.map((a, i) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="bg-muted/30 p-2 font-medium">{a.name}</td>
                        {buildings.map((b, j) => {
                          if (i === j)
                            return (
                              <td key={b.id} className="bg-muted/10 p-1 text-center text-muted-foreground">
                                —
                              </td>
                            );
                          if (j < i)
                            return (
                              <td key={b.id} className="bg-muted/5 p-1 text-center text-muted-foreground">
                                ·
                              </td>
                            );
                          const v = rel[pairKey(a.id, b.id)] ?? "none";
                          return (
                            <td key={b.id} className="p-1">
                              <select
                                value={v}
                                onChange={(e) =>
                                  setRelFor(a.id, b.id, e.target.value as CGRelation)
                                }
                                className="h-7 w-full rounded border border-border bg-background px-1 text-[10px]"
                                style={{ borderLeft: `4px solid ${REL_META[v].color}` }}
                              >
                                <option value="direct">Langsung</option>
                                <option value="indirect">Tidak Langsung</option>
                                <option value="none">Tidak Ada</option>
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              {(Object.keys(REL_META) as CGRelation[]).map((k) => (
                <span key={k} className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ background: REL_META[k].color }}
                  />
                  {REL_META[k].label}
                </span>
              ))}
              <span className="ml-auto flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#ea580c" }} />
                Anchor Gerbang
              </span>
            </div>
          </section>
        </div>

        {/* Generate */}
        <div className="mt-4 flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Force-Directed</span> menggabungkan
            adjacency + tarik gerbang ({GATE_LABEL[gate]}) + gravitasi pusat untuk bangunan tertinggi.
          </div>
          <Button onClick={generate} disabled={buildings.length < 2 || generating}>
            <Shuffle className="mr-2 h-4 w-4" />
            {generating ? "Menghitung…" : "Generate Alternatif Layout"}
          </Button>
        </div>

        {/* Alternatives */}
        {layouts.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-2 text-sm font-semibold">3. Alternatif Tata Massa</h3>
            <div className="grid gap-4 md:grid-cols-3">
              {layouts.map((L, idx) => (
                <div
                  key={L.seed}
                  className="flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm"
                >
                  <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5 text-xs">
                    <span className="font-medium">Alternatif {idx + 1}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      gerbang {GATE_LABEL[L.gate]} · seed {L.seed.toString(36).slice(0, 5)}
                    </span>
                  </div>
                  <div className="h-56 w-full bg-slate-50">
                    <MiniBlocks buildings={buildings} layout={L} />
                  </div>
                  <div className="p-2">
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => pickLayout(L)}
                    >
                      Pilih Alternatif Ini
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

function mkB(
  name: string,
  fn: MasterFunction,
  footprint: number,
  volume: number,
  opts?: Partial<Pick<CGBuilding, "access" | "hierarchy" | "skyline">>,
): CGBuilding {
  return {
    id: `cg-${Math.random().toString(36).slice(2, 8)}`,
    name,
    fn,
    footprint,
    volume,
    access: opts?.access ?? "neutral",
    hierarchy: opts?.hierarchy ?? "secondary",
    skyline: opts?.skyline ?? "centerHigh",
  };
}

void nextBlockId;
