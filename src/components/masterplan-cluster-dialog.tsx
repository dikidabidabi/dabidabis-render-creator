import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Edges, PerspectiveCamera, Grid } from "@react-three/drei";
import { Plus, Trash2, Sparkles, Shuffle } from "lucide-react";
import {
  FUNCTION_META,
  type MasterFunction,
  type MassingBlock,
  nextBlockId,
  type MasterPlan,
} from "@/lib/masterplan";
import { cn } from "@/lib/utils";

// ---- Types ----
export type CGBuilding = {
  id: string;
  name: string;
  fn: MasterFunction;
  footprint: number; // m²
  volume: number; // m³
};

export type CGRelation = "direct" | "indirect" | "none";

type CGPos = { id: string; x: number; z: number; w: number; d: number; h: number };
type CGLayout = { seed: number; positions: CGPos[] };

const REL_META: Record<CGRelation, { label: string; color: string }> = {
  direct: { label: "Hubungan Langsung", color: "#16a34a" },
  indirect: { label: "Hubungan Tidak Langsung", color: "#f59e0b" },
  none: { label: "Tidak Ada Hubungan", color: "#e5e7eb" },
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

// ---- Geometry helper ----
function dimsFromFootprint(A: number): { w: number; d: number } {
  const a = Math.max(4, A);
  // 4:3 rectangle with w*d = A
  const w = Math.sqrt((a * 4) / 3);
  const d = a / w;
  return { w, d };
}

// ---- Force-directed solver ----
function solveLayout(
  buildings: CGBuilding[],
  rel: Record<string, CGRelation>,
  seed: number,
): CGPos[] {
  const rnd = mulberry32(seed);
  const items = buildings.map((b) => {
    const { w, d } = dimsFromFootprint(b.footprint);
    const h = b.volume > 0 && b.footprint > 0 ? b.volume / b.footprint : 6;
    const r = Math.hypot(w, d) / 2;
    // initial random ring spread
    const ang = rnd() * Math.PI * 2;
    const rad = 30 + rnd() * 50;
    return {
      id: b.id,
      x: Math.cos(ang) * rad,
      z: Math.sin(ang) * rad,
      vx: 0,
      vz: 0,
      w,
      d,
      h,
      r,
    };
  });

  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const relOf = (a: string, b: string): CGRelation => rel[key(a, b)] ?? "none";

  const ITER = 320;
  for (let it = 0; it < ITER; it++) {
    const cooling = 1 - it / ITER;
    // pairwise forces
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.max(0.001, Math.hypot(dx, dz));
        const nx = dx / dist;
        const nz = dz / dist;
        const minDist = a.r + b.r + 2; // 2m gap
        const r = relOf(a.id, b.id);

        let force = 0;
        if (r === "direct") {
          const desired = minDist + 1;
          force = (dist - desired) * 0.08; // strong attract/spring
        } else if (r === "indirect") {
          const desired = minDist + 12;
          force = (dist - desired) * 0.04;
        } else {
          // repel softly when far, harder when close
          if (dist < minDist + 20) {
            force = -((minDist + 20 - dist) * 0.03);
          }
        }
        // overlap hard repel
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
      // gentle centering
      items[i].vx += -items[i].x * 0.002;
      items[i].vz += -items[i].z * 0.002;
    }
    // integrate
    for (const it2 of items) {
      it2.x += it2.vx * cooling;
      it2.z += it2.vz * cooling;
      it2.vx *= 0.6;
      it2.vz *= 0.6;
    }
  }
  // final overlap resolution pass
  for (let pass = 0; pass < 30; pass++) {
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
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return items.map((it) => ({ id: it.id, x: it.x, z: it.z, w: it.w, d: it.d, h: it.h }));
}

// ---- Mini 3D preview ----
function MiniBlocks({
  buildings,
  layout,
}: {
  buildings: CGBuilding[];
  layout: CGLayout;
}) {
  const byId = useMemo(() => {
    const m = new Map(buildings.map((b) => [b.id, b]));
    return m;
  }, [buildings]);
  const extent = useMemo(() => {
    let r = 30;
    for (const p of layout.positions) {
      r = Math.max(r, Math.abs(p.x) + p.w / 2, Math.abs(p.z) + p.d / 2);
    }
    return r;
  }, [layout]);
  const camDist = extent * 2.4;
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

  // seed defaults the first time open
  useEffect(() => {
    if (!open) return;
    if (buildings.length > 0) return;
    setBuildings([
      mkB("Ballroom", "komersial", 600, 4800),
      mkB("Galeri", "fasum", 400, 2400),
      mkB("Plaza", "rth", 300, 150),
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
    // run synchronously then yield
    setTimeout(() => {
      const seeds = [
        Math.floor(Math.random() * 1e9),
        Math.floor(Math.random() * 1e9),
        Math.floor(Math.random() * 1e9),
      ];
      const next: CGLayout[] = seeds.map((s) => ({
        seed: s,
        positions: solveLayout(buildings, rel, s),
      }));
      setLayouts(next);
      setGenerating(false);
    }, 20);
  }, [buildings, rel]);

  const pickLayout = useCallback(
    (layout: CGLayout) => {
      // center near (0,0); offset based on existing blocks bbox to avoid overlap.
      let offsetX = 0,
        offsetZ = 0;
      if (existingPlan.blocks.length > 0) {
        let maxX = -Infinity;
        for (const b of existingPlan.blocks) maxX = Math.max(maxX, b.x + b.w / 2);
        offsetX = maxX + 30;
      }
      const used = new Set(existingPlan.blocks.map((b) => b.id));
      const blocks: MassingBlock[] = layout.positions.map((p, i) => {
        const src = buildings.find((b) => b.id === p.id)!;
        // unique id
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
                    <th className="p-2">Luas (m²)</th>
                    <th className="p-2">Volume (m³)</th>
                    <th className="p-2">Tinggi</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {buildings.map((b) => {
                    const h =
                      b.volume > 0 && b.footprint > 0 ? b.volume / b.footprint : 0;
                    return (
                      <tr key={b.id} className="border-t border-border">
                        <td className="p-1">
                          <Input
                            value={b.name}
                            onChange={(e) => updateBuilding(b.id, { name: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <select
                            value={b.fn}
                            onChange={(e) =>
                              updateBuilding(b.id, { fn: e.target.value as MasterFunction })
                            }
                            className="h-7 w-full rounded border border-border bg-background px-1 text-xs"
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
                            className="h-7 w-20 text-xs"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            type="number"
                            value={b.volume}
                            onChange={(e) =>
                              updateBuilding(b.id, { volume: Number(e.target.value) || 0 })
                            }
                            className="h-7 w-24 text-xs"
                          />
                        </td>
                        <td className="p-1 font-mono tabular-nums text-muted-foreground">
                          {h ? `${h.toFixed(1)} m` : "—"}
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
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
                        Belum ada bangunan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Tinggi otomatis = Volume / Luas. Alas box memakai rasio 4:3 dari luas.
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
            </div>
          </section>
        </div>

        {/* Generate */}
        <div className="mt-4 flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">
            Algoritma <span className="font-medium text-foreground">Force-Directed Relaxation</span> akan
            menyusun massa berdasarkan matriks (gaya tarik / tolak) dengan 3 seed acak.
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
                      seed {L.seed.toString(36).slice(0, 5)}
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

function mkB(name: string, fn: MasterFunction, footprint: number, volume: number): CGBuilding {
  return {
    id: `cg-${Math.random().toString(36).slice(2, 8)}`,
    name,
    fn,
    footprint,
    volume,
  };
}

// keep imports used
void nextBlockId;
