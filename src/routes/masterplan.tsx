import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Edges, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Plus,
  Trash2,
  Camera,
  Eye,
  ArrowRight,
  Building2,
  Trees,
  Landmark,
} from "lucide-react";
import {
  FUNCTION_META,
  type MassingBlock,
  type MasterFunction,
  type MasterPlan,
  blockGFA,
  emptyPlan,
  loadPlan,
  nextBlockId,
  savePlan,
  totalsByFunction,
  MP_PENDING_DETAIL_KEY,
} from "@/lib/masterplan";

export const Route = createFileRoute("/masterplan")({
  head: () => ({
    meta: [
      { title: "Master Plan — Dabidabi's" },
      { name: "description", content: "Susun tata ruang kawasan secara makro dengan massing block 3D berbasis fungsi." },
    ],
  }),
  component: MasterPlanPage,
});

// ---------- Scene ----------

function Block({
  block,
  selected,
  onSelect,
}: {
  block: MassingBlock;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const meta = FUNCTION_META[block.fn];
  return (
    <group position={[block.x, block.height / 2, block.z]}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(block.id);
        }}
      >
        <boxGeometry args={[block.w, block.height, block.d]} />
        <meshStandardMaterial
          color={meta.color}
          transparent
          opacity={block.fn === "rth" ? 0.55 : 0.92}
          roughness={0.85}
        />
        <Edges color={selected ? "#facc15" : "#0f172a"} threshold={15} />
      </mesh>
      {selected && (
        <mesh position={[0, block.height / 2 + 0.05, 0]}>
          <boxGeometry args={[block.w + 0.6, 0.05, block.d + 0.6]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>
      )}
    </group>
  );
}

function Ground({
  size,
  onClickEmpty,
}: {
  size: number;
  onClickEmpty: (x: number, z: number) => void;
}) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClickEmpty(e.point.x, e.point.z);
      }}
    >
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color="#f1f5f9" />
    </mesh>
  );
}

type CameraPreset = "iso" | "skyline-n" | "skyline-e" | "skyline-s" | "skyline-w" | "top";

function CameraRig({ preset, size }: { preset: CameraPreset; size: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const s = size;
    let pos: [number, number, number] = [s * 0.8, s * 0.7, s * 0.8];
    let look: [number, number, number] = [0, 0, 0];
    switch (preset) {
      case "iso": pos = [s * 0.8, s * 0.7, s * 0.8]; break;
      case "top": pos = [0, s * 1.4, 0.001]; break;
      case "skyline-n": pos = [0, s * 0.25, -s * 1.1]; break;
      case "skyline-s": pos = [0, s * 0.25, s * 1.1]; break;
      case "skyline-e": pos = [s * 1.1, s * 0.25, 0]; break;
      case "skyline-w": pos = [-s * 1.1, s * 0.25, 0]; break;
    }
    camera.position.set(...pos);
    camera.lookAt(...look);
  }, [preset, size, camera]);
  return null;
}

// ---------- Page ----------

function MasterPlanPage() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<MasterPlan>(() => emptyPlan());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFn, setActiveFn] = useState<MasterFunction>("komersial");
  const [preset, setPreset] = useState<CameraPreset>("iso");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount + listen for cross-tab updates.
  useEffect(() => {
    setPlan(loadPlan());
    setHydrated(true);
    const onUpd = () => setPlan(loadPlan());
    window.addEventListener("masterplan:update", onUpd);
    window.addEventListener("storage", onUpd);
    return () => {
      window.removeEventListener("masterplan:update", onUpd);
      window.removeEventListener("storage", onUpd);
    };
  }, []);

  // Persist on change.
  useEffect(() => {
    if (!hydrated) return;
    savePlan(plan);
  }, [plan, hydrated]);

  const selected = useMemo(
    () => plan.blocks.find((b) => b.id === selectedId) ?? null,
    [plan, selectedId],
  );

  const updateBlock = useCallback((id: string, patch: Partial<MassingBlock>) => {
    setPlan((p) => ({
      ...p,
      blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  }, []);

  const addBlock = useCallback(
    (x: number, z: number) => {
      setPlan((p) => {
        const id = nextBlockId(p);
        const defaults: Record<MasterFunction, Partial<MassingBlock>> = {
          komersial: { w: 24, d: 18, height: 18, floors: 5 },
          fasum:     { w: 20, d: 20, height: 10, floors: 3 },
          rth:       { w: 30, d: 30, height: 0.5, floors: 1 },
        };
        const def = defaults[activeFn];
        const block: MassingBlock = {
          id,
          name: `${FUNCTION_META[activeFn].label} ${p.blocks.length + 1}`,
          fn: activeFn,
          x: Math.round(x),
          z: Math.round(z),
          w: def.w!,
          d: def.d!,
          height: def.height!,
          floors: def.floors!,
        };
        setSelectedId(id);
        return { ...p, blocks: [...p.blocks, block] };
      });
    },
    [activeFn],
  );

  const deleteBlock = useCallback((id: string) => {
    setPlan((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== id) }));
    setSelectedId(null);
  }, []);

  const totals = useMemo(() => totalsByFunction(plan), [plan]);
  const totalGFA = totals.komersial.gfa + totals.fasum.gfa + totals.rth.gfa;

  const goDetail = useCallback(
    (b: MassingBlock) => {
      try {
        window.localStorage.setItem(
          MP_PENDING_DETAIL_KEY,
          JSON.stringify({ blockId: b.id, name: b.name, fn: b.fn, at: Date.now() }),
        );
      } catch {}
      navigate({ to: "/sketch", search: { blockId: b.id, blockName: b.name } as any });
    },
    [navigate],
  );

  return (
    <main className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-background">
      {/* Left palette */}
      <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-border bg-card/40 p-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Palet Fungsi</h2>
          <p className="text-xs text-muted-foreground">
            Pilih fungsi lalu klik di kanvas untuk menambahkan blok.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {(Object.keys(FUNCTION_META) as MasterFunction[]).map((fn) => {
            const m = FUNCTION_META[fn];
            const Icon = fn === "komersial" ? Building2 : fn === "fasum" ? Landmark : Trees;
            return (
              <button
                key={fn}
                onClick={() => setActiveFn(fn)}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition",
                  activeFn === fn
                    ? "border-foreground bg-foreground/5 font-medium"
                    : "border-border hover:bg-muted/50",
                )}
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded text-white"
                  style={{ background: m.color }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="mt-2">
          <Label className="text-xs">Tindakan Cepat</Label>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 w-full justify-start"
            onClick={() => addBlock(0, 0)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Tambah Blok di Tengah
          </Button>
        </div>

        <div className="mt-2">
          <Label className="text-xs">Kamera Skyline</Label>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            {([
              ["iso", "Isometri"],
              ["top", "Atas"],
              ["skyline-n", "Skyline U"],
              ["skyline-s", "Skyline S"],
              ["skyline-e", "Skyline T"],
              ["skyline-w", "Skyline B"],
            ] as [CameraPreset, string][]).map(([k, l]) => (
              <Button
                key={k}
                variant={preset === k ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setPreset(k)}
              >
                {l}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-auto rounded-md border border-border bg-background/60 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total GFA Kawasan
          </div>
          <div className="font-display text-2xl font-bold">{Math.round(totalGFA).toLocaleString("id-ID")} m²</div>
          <div className="mt-2 space-y-1 text-xs">
            {(Object.keys(FUNCTION_META) as MasterFunction[]).map((fn) => (
              <div key={fn} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: FUNCTION_META[fn].color }}
                  />
                  {FUNCTION_META[fn].label}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {Math.round(totals[fn].gfa).toLocaleString("id-ID")} m²
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Center canvas */}
      <section className="relative flex-1 bg-slate-50">
        <Canvas shadows dpr={[1, 2]}>
          <PerspectiveCamera makeDefault fov={45} near={1} far={4000} />
          <CameraRig preset={preset} size={plan.siteSize} />
          <OrbitControls makeDefault enableDamping target={[0, 0, 0]} maxPolarAngle={Math.PI / 2 - 0.05} />
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[plan.siteSize * 0.6, plan.siteSize * 0.9, plan.siteSize * 0.3]}
            intensity={1.1}
            castShadow
          />
          <Grid
            args={[plan.siteSize, plan.siteSize]}
            cellSize={5}
            cellThickness={0.6}
            cellColor="#cbd5e1"
            sectionSize={25}
            sectionThickness={1.2}
            sectionColor="#64748b"
            fadeDistance={plan.siteSize * 1.5}
            fadeStrength={1}
            infiniteGrid={false}
            position={[0, 0.01, 0]}
          />
          <Ground size={plan.siteSize} onClickEmpty={(x, z) => addBlock(x, z)} />
          {plan.blocks.map((b) => (
            <Block
              key={b.id}
              block={b}
              selected={b.id === selectedId}
              onSelect={(id) => setSelectedId(id)}
            />
          ))}
        </Canvas>

        {/* Floating toolbar */}
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/85 px-4 py-2 text-sm shadow-md backdrop-blur">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Mode: <span className="font-medium text-foreground">{FUNCTION_META[activeFn].label}</span>
            </span>
            <span className="mx-2 h-4 w-px bg-border" />
            <Camera className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Klik tapak untuk menambah blok · Klik blok untuk pilih
            </span>
          </div>
        </div>
      </section>

      {/* Right info panel */}
      <aside className="flex w-80 shrink-0 flex-col gap-3 border-l border-border bg-card/40 p-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Daftar Blok</h2>
          <p className="text-xs text-muted-foreground">{plan.blocks.length} blok dalam tapak.</p>
        </div>

        <div className="max-h-48 overflow-y-auto rounded-md border border-border">
          {plan.blocks.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              Belum ada blok. Klik tapak untuk memulai.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {plan.blocks.map((b) => (
                <li
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition",
                    selectedId === b.id ? "bg-foreground/5" : "hover:bg-muted/50",
                  )}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ background: FUNCTION_META[b.fn].color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{b.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{b.id}</div>
                  </div>
                  {b.detailedSketchTitle && (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      Detail
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected ? (
          <div className="flex-1 space-y-3 overflow-y-auto rounded-md border border-border bg-background/60 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] text-muted-foreground">{selected.id}</div>
                <Input
                  value={selected.name}
                  onChange={(e) => updateBlock(selected.id, { name: e.target.value })}
                  className="mt-1 h-8 font-medium"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Fungsi</Label>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {(Object.keys(FUNCTION_META) as MasterFunction[]).map((fn) => (
                  <button
                    key={fn}
                    onClick={() => updateBlock(selected.id, { fn })}
                    className={cn(
                      "rounded border px-2 py-1 text-[11px] transition",
                      selected.fn === fn
                        ? "border-foreground font-semibold"
                        : "border-border hover:bg-muted/50",
                    )}
                    style={selected.fn === fn ? { borderColor: FUNCTION_META[fn].color } : {}}
                  >
                    {FUNCTION_META[fn].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumField label="Lebar (m)" value={selected.w} onChange={(v) => updateBlock(selected.id, { w: Math.max(2, v) })} />
              <NumField label="Dalam (m)" value={selected.d} onChange={(v) => updateBlock(selected.id, { d: Math.max(2, v) })} />
              <NumField label="Tinggi (m)" value={selected.height} onChange={(v) => updateBlock(selected.id, { height: Math.max(0.5, v) })} step={0.5} />
              <NumField label="Lantai" value={selected.floors} onChange={(v) => updateBlock(selected.id, { floors: Math.max(1, Math.round(v)) })} step={1} />
              <NumField label="Posisi X (m)" value={selected.x} onChange={(v) => updateBlock(selected.id, { x: v })} />
              <NumField label="Posisi Z (m)" value={selected.z} onChange={(v) => updateBlock(selected.id, { z: v })} />
            </div>

            <div className="rounded bg-muted/50 p-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Footprint</span>
                <span className="font-mono">{Math.round(selected.w * selected.d).toLocaleString("id-ID")} m²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">GFA</span>
                <span className="font-mono font-semibold">{Math.round(blockGFA(selected)).toLocaleString("id-ID")} m²</span>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => goDetail(selected)}
            >
              Detailkan Bangunan
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            {selected.detailedSketchTitle && (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                Tertaut ke sketsa: <span className="font-medium">{selected.detailedSketchTitle}</span>
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => deleteBlock(selected.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Hapus Blok
            </Button>
          </div>
        ) : (
          <div className="flex-1 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Pilih sebuah blok untuk melihat dan mengubah detailnya.
          </div>
        )}

        <Link
          to="/presentasi"
          className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs transition hover:bg-muted/50"
        >
          Lihat di Slide Presentasi <ArrowRight className="h-3 w-3" />
        </Link>
      </aside>
    </main>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="h-8"
      />
    </div>
  );
}
