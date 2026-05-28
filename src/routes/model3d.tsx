import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Edges } from "@react-three/drei";
import * as THREE from "three";
import SunCalc from "suncalc";
import { Slider } from "@/components/ui/slider";
import {
  ChevronDown,
  ChevronUp,
  Box,
  Inbox,
  Maximize2,
  Minimize2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/model3d")({
  head: () => ({
    meta: [
      { title: "Model 3D — Dabidabi's" },
      {
        name: "description",
        content:
          "Generator model 3D dari sketsa milimeter block. Ekstrusi polygon per-lantai berdasarkan MDPL dengan tampilan interaktif.",
      },
    ],
  }),
  component: Model3DPage,
});

// ---------- Types (synced with sketch.tsx) ----------
type Point = { x: number; y: number };
type Layer = {
  id: string;
  name: string;
  points: Point[];
  areaM2: number;
  color: string;
  levelId?: string;
  coefficient?: number;
};
type Level = { id: string; name: string; mdpl: number; opacity: number; typicalCount?: number; typicalHeight?: number };
type Geo = { lat: number; lon: number; locked: boolean; mapOpacity: number; label?: string };
type Sketch = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  scale: "1:100" | "1:200" | "1:500" | "1:1000" | string;
  layers: Layer[];
  levels: Level[];
  geo?: Geo;
  northRotation?: number;
};
type StoreShape = { sketches: Sketch[]; openId: string | null };

const STORAGE_KEY = "dabidabis_sketch_v2";
const MINOR_PX = 8;
const MAJOR_EVERY = 10;
const METERS_PER_MAJOR: Record<string, number> = {
  "1:100": 1,
  "1:200": 2,
  "1:500": 5,
  "1:1000": 10,
};

function metersPerPx(scale: string) {
  const m = METERS_PER_MAJOR[scale] ?? 1;
  return m / (MINOR_PX * MAJOR_EVERY);
}
function isLahan(n: string) {
  return n.trim().toLowerCase().startsWith("lahan");
}
function isVoid(n: string) {
  return n.trim().toLowerCase() === "void";
}
function fmt(n: number, d = 2) {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Compute origin (centroid of all relevant layer points) for nice centering.
function computeOrigin(sketch: Sketch): Point {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  for (const ly of sketch.layers) {
    for (const p of ly.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      count++;
    }
  }
  if (!count) return { x: 0, y: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// Sort levels by MDPL ascending. Expand typical groups into individual 3m
// floors and shift upper levels accordingly.
const TYPICAL_FLOOR_H = 3;
type ExpandedFloor = Level & {
  height: number;
  baseMdpl: number;
  sourceId: string;
  typicalIndex: number;
  typicalTotal: number;
};
function expandLevels(levels: Level[]): ExpandedFloor[] {
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  let shift = 0;
  const adjusted = sorted.map((lv) => {
    const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
    const base = lv.mdpl + shift;
    shift += (k - 1) * TYPICAL_FLOOR_H;
    return { lv, k, base };
  });
  const out: ExpandedFloor[] = [];
  for (let i = 0; i < adjusted.length; i++) {
    const { lv, k, base } = adjusted[i];
    const next = adjusted[i + 1];
    if (k === 1) {
      const h = next ? Math.max(0.1, next.base - base) : 4;
      out.push({ ...lv, baseMdpl: base, height: h, sourceId: lv.id, typicalIndex: 0, typicalTotal: 1 });
    } else {
      for (let j = 0; j < k; j++) {
        out.push({
          ...lv,
          id: `${lv.id}__t${j}`,
          baseMdpl: base + j * TYPICAL_FLOOR_H,
          height: TYPICAL_FLOOR_H,
          sourceId: lv.id,
          typicalIndex: j,
          typicalTotal: k,
        });
      }
    }
  }
  return out;
}
function levelsWithHeights(levels: Level[]) {
  // Kept for backward-compatibility: returns expanded floors with `height`.
  return expandLevels(levels);
}

// ---------- 3D scene helpers ----------
function ExtrudedFloor({
  points,
  origin,
  mPerPx,
  baseY,
  height,
  color,
  highlighted,
}: {
  points: Point[];
  origin: Point;
  mPerPx: number;
  baseY: number;
  height: number;
  color: string;
  highlighted: boolean;
}) {
  const geometry = useMemo(() => {
    if (points.length < 3 || height <= 0) return null;
    const shape = new THREE.Shape();
    points.forEach((p, i) => {
      const x = (p.x - origin.x) * mPerPx;
      const z = (p.y - origin.y) * mPerPx; // flip handled by rotation below
      if (i === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
    });
    // Shape lies in XY plane, extruded along +Z. Rotate so extrusion becomes +Y (up).
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [points, origin.x, origin.y, mPerPx, height]);

  if (!geometry) return null;

  return (
    <group position={[0, baseY, 0]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={color}
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
          emissive={highlighted ? color : "#000000"}
          emissiveIntensity={highlighted ? 0.18 : 0}
        />
        <Edges threshold={15} color={highlighted ? "#0a0a0a" : "#1a1a1a"} />
      </mesh>
    </group>
  );
}

function GroundPlane({
  points,
  origin,
  mPerPx,
}: {
  points: Point[];
  origin: Point;
  mPerPx: number;
}) {
  const geometry = useMemo(() => {
    if (points.length < 3) return null;
    const shape = new THREE.Shape();
    points.forEach((p, i) => {
      const x = (p.x - origin.x) * mPerPx;
      const z = (p.y - origin.y) * mPerPx;
      if (i === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    });
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [points, origin.x, origin.y, mPerPx]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} position={[0, -0.02, 0]} receiveShadow>
      <meshStandardMaterial color="#e7e5e0" side={THREE.DoubleSide} />
    </mesh>
  );
}

function Scene({
  sketch,
  highlightLevelId,
  sunHour,
}: {
  sketch: Sketch;
  highlightLevelId: string | null;
  sunHour: number;
}) {
  const mPerPx = metersPerPx(sketch.scale);
  const origin = useMemo(() => computeOrigin(sketch), [sketch]);
  const floors = useMemo(() => expandLevels(sketch.levels), [sketch.levels]);
  const baseMdpl = floors[0]?.baseMdpl ?? 0;

  const lahanLayers = sketch.layers.filter((l) => isLahan(l.name));
  const buildLayers = sketch.layers.filter((l) => !isLahan(l.name) && !isVoid(l.name));

  // Sun position from SunCalc using geo + current date + chosen hour.
  // North rotation rotates the world so we counter-rotate sun azimuth.
  const sunPos = useMemo(() => {
    const geo = sketch.geo;
    if (!geo || !geo.locked) {
      // Fallback static sun
      return { x: 30, y: 60, z: 20, intensity: 1.05 };
    }
    const d = new Date();
    d.setHours(Math.floor(sunHour), Math.round((sunHour % 1) * 60), 0, 0);
    const sc = SunCalc.getPosition(d, geo.lat, geo.lon);
    // SunCalc azimuth: south=0, west=+π/2 (clockwise from south). Convert to north-clockwise.
    const azNorthCW = sc.azimuth + Math.PI;
    const north = ((Number(sketch.northRotation) || 0) * Math.PI) / 180;
    const az = azNorthCW - north;
    const alt = Math.max(0.01, sc.altitude);
    const dist = 80;
    const horiz = Math.cos(alt) * dist;
    // In our scene: +Z = south (canvas y grows south), +X = east, +Y = up
    const x = Math.sin(az) * horiz;
    const z = -Math.cos(az) * horiz;
    const y = Math.sin(alt) * dist;
    const intensity = Math.max(0.05, Math.min(1.3, Math.sin(alt) * 1.4));
    return { x, y, z, intensity };
  }, [sketch.geo, sketch.northRotation, sunHour]);

  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[sunPos.x, sunPos.y, sunPos.z]}
        intensity={sunPos.intensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={0.5}
        shadow-camera-far={300}
      />
      <hemisphereLight args={["#ffffff", "#9aa0a6", 0.35]} />

      {lahanLayers.map((ly) => (
        <GroundPlane key={ly.id} points={ly.points} origin={origin} mPerPx={mPerPx} />
      ))}

      <Grid
        args={[200, 200]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#cfcfcf"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#9a9a9a"
        position={[0, -0.01, 0]}
        fadeDistance={120}
        fadeStrength={1}
        infiniteGrid
      />

      {floors.map((lv) => {
        const layersOfLevel = buildLayers.filter((l) => l.levelId === lv.sourceId);
        return layersOfLevel.map((ly, idx) => (
          <ExtrudedFloor
            key={`${lv.id}_${ly.id}_${idx}`}
            points={ly.points}
            origin={origin}
            mPerPx={mPerPx}
            baseY={lv.baseMdpl - baseMdpl}
            height={lv.height}
            color={ly.color?.replace(/rgba?\(([^)]+)\)/, (_, body) => {
              const parts = body.split(",").map((s: string) => s.trim());
              return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
            }) || "#e85d3a"}
            highlighted={highlightLevelId === lv.sourceId}
          />
        ));
      })}
    </>
  );
}

// ---------- Per-sketch viewer card ----------
function SketchViewer({
  sketch,
  onChange,
}: {
  sketch: Sketch;
  onChange: (patch: Partial<Sketch>) => void;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [sunHour, setSunHour] = useState(12);
  const canvasRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<any>(null);

  const expanded = useMemo(() => expandLevels(sketch.levels), [sketch.levels]);
  const baseMdpl = expanded[0]?.baseMdpl ?? 0;
  const topMdpl = expanded.length
    ? expanded[expanded.length - 1].baseMdpl + expanded[expanded.length - 1].height
    : 0;
  const totalHeight = topMdpl - baseMdpl;

  // Source levels (one row per user-defined level), sorted by MDPL
  const sourceLevels = useMemo(
    () => [...sketch.levels].sort((a, b) => a.mdpl - b.mdpl),
    [sketch.levels],
  );

  const mPerPx = metersPerPx(sketch.scale);

  // Volume per source level, accounting for typicalCount.
  const volumeData = useMemo(() => {
    const buildLayers = sketch.layers.filter((l) => !isLahan(l.name) && !isVoid(l.name));
    return sourceLevels.map((lv) => {
      const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
      const layers = buildLayers.filter((l) => l.levelId === lv.id);
      const area = layers.reduce((s, l) => s + (l.areaM2 || 0), 0) * k;
      // total height occupied by this source group in 3D
      const floors = expanded.filter((f) => f.sourceId === lv.id);
      const groupHeight = floors.reduce((s, f) => s + f.height, 0);
      return { id: lv.id, name: lv.name, mdpl: lv.mdpl, height: groupHeight, area, volume: area * (groupHeight / Math.max(1, k)), k };
    });
  }, [sketch.layers, sourceLevels, expanded]);

  const totalArea = volumeData.reduce((s, v) => s + v.area, 0);
  const totalVolume = volumeData.reduce((s, v) => s + v.volume, 0);

  const updateLevel = (id: string, patch: Partial<Level>) => {
    onChange({
      levels: sketch.levels.map((lv) => (lv.id === id ? { ...lv, ...patch } : lv)),
    });
  };

  const resetCamera = () => {
    if (orbitRef.current?.reset) orbitRef.current.reset();
  };

  return (
    <div
      className={cn(
        "grid gap-4",
        fullscreen ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[320px_1fr]",
      )}
    >
      {/* Panel manajemen level */}
      {!fullscreen && (
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">Manajemen Level (MDPL)</h3>
          </div>
          <div className="space-y-3">
            {sourceLevels.length === 0 && (
              <p className="text-xs text-muted-foreground">Belum ada level.</p>
            )}
            {sourceLevels.map((lv, i) => {
              const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
              const vd = volumeData[i];
              return (
                <div
                  key={lv.id}
                  className={cn(
                    "rounded-md border border-border/60 bg-background/40 p-2",
                    highlight === lv.id && "ring-1 ring-primary",
                  )}
                  onMouseEnter={() => setHighlight(lv.id)}
                  onMouseLeave={() => setHighlight(null)}
                >
                  <div className="grid grid-cols-[1fr_90px] gap-2">
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Nama Lantai
                      </Label>
                      <Input
                        value={lv.name}
                        onChange={(e) => updateLevel(lv.id, { name: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        MDPL (m)
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={lv.mdpl}
                        onChange={(e) =>
                          updateLevel(lv.id, { mdpl: parseFloat(e.target.value) || 0 })
                        }
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      Tinggi:{" "}
                      <span className="font-medium text-foreground">{fmt(vd?.height || 0)} m</span>
                      {k > 1 && (
                        <span className="ml-1 text-primary">· tipikal {k}×</span>
                      )}
                    </span>
                    <span>
                      Luas:{" "}
                      <span className="font-medium text-foreground">
                        {fmt(vd?.area || 0)} m²
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>


          <div className="mt-4 space-y-1 rounded-md bg-muted/40 p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tinggi total</span>
              <span className="font-semibold">{fmt(totalHeight)} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total luas lantai</span>
              <span className="font-semibold">{fmt(totalArea)} m²</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total volume</span>
              <span className="font-semibold">{fmt(totalVolume)} m³</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Skala sumber</span>
              <span className="font-mono">{sketch.scale}</span>
            </div>
          </div>
        </div>
      )}

      {/* Canvas 3D */}
      <div
        ref={canvasRef}
        className={cn(
          "relative rounded-lg border border-border bg-gradient-to-b from-slate-100 to-slate-300 overflow-hidden",
          fullscreen ? "h-[80vh]" : "h-[520px]",
        )}
      >
        <Canvas
          shadows
          camera={{ position: [25, 22, 25], fov: 45, near: 0.1, far: 1000 }}
          dpr={[1, 2]}
        >
          <color attach="background" args={["#eef1f4"]} />
          <Scene sketch={sketch} highlightLevelId={highlight} sunHour={sunHour} />
          <OrbitControls
            ref={orbitRef}
            enableDamping
            dampingFactor={0.08}
            makeDefault
          />
        </Canvas>

        <div className="absolute right-2 top-2 flex gap-1">
          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={resetCamera}
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setFullscreen((v) => !v)}
          >
            {fullscreen ? (
              <>
                <Minimize2 className="h-3 w-3" /> Kecil
              </>
            ) : (
              <>
                <Maximize2 className="h-3 w-3" /> Besar
              </>
            )}
          </Button>
        </div>

        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/80 px-2 py-1 text-[10px] text-slate-700 shadow-sm">
          Drag = rotasi · Shift+Drag = pan · Scroll = zoom · 1 unit = 1 m ·{" "}
          {fmt(mPerPx, 4)} m/px
        </div>
        {sketch.geo?.locked && (
          <div className="absolute left-2 top-2 w-56 rounded-md bg-white/85 p-2 shadow-sm backdrop-blur">
            <div className="mb-1 flex items-center justify-between text-[10px] font-medium text-slate-700">
              <span>Jam Matahari</span>
              <span className="font-mono">
                {String(Math.floor(sunHour)).padStart(2, "0")}.
                {String(Math.round((sunHour % 1) * 60)).padStart(2, "0")}
              </span>
            </div>
            <Slider
              min={6}
              max={18}
              step={0.25}
              value={[sunHour]}
              onValueChange={(v) => setSunHour(v[0] ?? 12)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Page ----------
function Model3DPage() {
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setSketches([]);
        return;
      }
      const s = JSON.parse(raw) as StoreShape;
      if (s && Array.isArray(s.sketches)) {
        setSketches(s.sketches as Sketch[]);
        setOpenId((prev) => {
          if (prev && s.sketches.some((x) => x.id === prev)) return prev;
          return s.openId ?? s.sketches[0]?.id ?? null;
        });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
    setLoaded(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) load();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", load);
    const iv = window.setInterval(load, 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", load);
      window.clearInterval(iv);
    };
  }, [load]);

  const updateSketch = useCallback((id: string, patch: Partial<Sketch>) => {
    setSketches((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s,
      );
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ sketches: next, openId } as StoreShape),
        );
      } catch {
        // ignore
      }
      return next;
    });
  }, [openId]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-ember shadow-ember">
          <Box className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Model 3D</h1>
          <p className="text-sm text-muted-foreground">
            Ekstrusi otomatis dari sketsa milimeter block. Tiap lantai diposisikan sesuai MDPL.
          </p>
        </div>
      </div>

      {loaded && sketches.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <Inbox className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Belum ada sketsa. Buat sketsa terlebih dahulu di halaman Sketsa.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {sketches.map((s) => {
          const isOpen = openId === s.id;
          return (
            <div
              key={s.id}
              className="rounded-lg border border-border bg-card/30 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : s.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-card/60"
              >
                <div className="flex items-center gap-3">
                  <Box className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">{s.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.levels.length} level · {s.layers.length} layer · skala {s.scale}
                    </div>
                  </div>
                </div>
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {isOpen && (
                <div className="border-t border-border bg-background/30 p-4">
                  <SketchViewer
                    sketch={s}
                    onChange={(patch) => updateSketch(s.id, patch)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
