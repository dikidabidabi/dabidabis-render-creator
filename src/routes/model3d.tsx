import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Edges, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
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
  Download,
  Camera,
  Palette,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  buildMeshes,
  meshesToObj,
  meshesTo3ds,
  triggerDownload,
  type MeshInput,
} from "@/lib/model3d-export";
import {
  type StructuralGrid,
  axisPositions,
  spansForLevel,
  isNodeActive,
  isColumnClipped,
  levelInRange,
  collectGrids,
} from "@/lib/structural-grid";

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
  structuralGrid?: StructuralGrid;
  structuralGridExtras?: StructuralGrid[];
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
function isTaman(n: string) {
  return n.trim().toLowerCase().startsWith("taman");
}
function isBalkon(n: string) {
  return n.trim().toLowerCase() === "balkon";
}
function isAtapHijau(n: string) {
  return n.trim().toLowerCase() === "atap hijau";
}
function isAtap(n: string) {
  return n.trim().toLowerCase() === "atap";
}
const TAMAN_GREEN = "#22c55e";
const ABU_MUDA = "#bebebe";
const ATAP_HIJAU_COLOR = "#22c55e";
// Special extrude rules for named rooms.
function roomExtrudeOverride(name: string): { height: number; baseDelta: number; color: string } | null {
  if (isAtapHijau(name)) return { height: 0.5, baseDelta: 0, color: ATAP_HIJAU_COLOR };
  if (isBalkon(name)) return { height: 0.1, baseDelta: -0.1, color: ABU_MUDA };
  if (isAtap(name)) return { height: 0.2, baseDelta: -0.2, color: ABU_MUDA };
  return null;
}
const MDPL_ZERO_EPS = 0.0001;
function findMdplZeroLevel<T extends { mdpl: number }>(levels: T[]): T | undefined {
  return levels.find((lv) => Math.abs(Number(lv.mdpl) || 0) <= MDPL_ZERO_EPS);
}
function bindLahanToMdplZero(sketch: Sketch): Sketch {
  if (!(sketch.layers ?? []).some((ly) => isLahan(ly.name))) return sketch;
  const zero = findMdplZeroLevel(sketch.levels ?? []);
  const zeroLevel = zero ?? {
    id: `LV_${sketch.id}_MDPL0`,
    name: "Level 1",
    mdpl: 0,
    opacity: 0.5,
  };
  const levels = zero ? sketch.levels : [...(sketch.levels ?? []), zeroLevel];
  return {
    ...sketch,
    levels,
    layers: (sketch.layers ?? []).map((ly) => (isLahan(ly.name) ? { ...ly, levelId: zeroLevel.id } : ly)),
  };
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

// Sort levels by MDPL ascending. Expand typical groups into individual floors
// using each level's own typicalHeight (default 3 m), shifting upper levels.
// Selaras dengan presentasi.tsx & tabulasi.tsx.
const TYPICAL_FLOOR_H = 3;
function tipH(lv: { typicalHeight?: number }): number {
  const h = Number(lv.typicalHeight);
  return Number.isFinite(h) && h > 0 ? h : TYPICAL_FLOOR_H;
}
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
    const h = tipH(lv);
    const base = lv.mdpl + shift;
    shift += (k - 1) * h;
    return { lv, k, base, h };
  });
  const out: ExpandedFloor[] = [];
  for (let i = 0; i < adjusted.length; i++) {
    const { lv, k, base, h } = adjusted[i];
    const next = adjusted[i + 1];
    if (k === 1) {
      const hh = next ? Math.max(0.1, next.base - base) : 4;
      out.push({ ...lv, baseMdpl: base, height: hh, sourceId: lv.id, typicalIndex: 0, typicalTotal: 1 });
    } else {
      for (let j = 0; j < k; j++) {
        out.push({
          ...lv,
          id: `${lv.id}__t${j}`,
          baseMdpl: base + j * h,
          height: h,
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
      // Sketsa: +x kanan, +y bawah. Pakai +y apa adanya pada shape lalu
      // rotateX(+π/2) agar +y(sketsa) menjadi +Z(scene) — tidak ter-mirror.
      const y = (p.y - origin.y) * mPerPx;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
    });
    // rotateX(+π/2): shape (x,y) → world (x, 0, y); ekstrusi +z → world -y.
    // Lalu balik tanda baseY dengan scale.y = -1 supaya bangunan naik ke atas.
    geo.rotateX(Math.PI / 2);
    geo.scale(1, -1, 1);
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

// Floor slab — top permukaan di baseY, extrude 150mm ke bawah, mendukung holes.
function FloorSlab({
  outer,
  holes,
  origin,
  mPerPx,
  topY,
  thickness,
  color,
  highlighted,
}: {
  outer: Point[];
  holes?: Point[][];
  origin: Point;
  mPerPx: number;
  topY: number;
  thickness: number;
  color: string;
  highlighted: boolean;
}) {
  const geometry = useMemo(() => {
    if (outer.length < 3 || thickness <= 0) return null;
    const shape = new THREE.Shape();
    outer.forEach((p, i) => {
      const x = (p.x - origin.x) * mPerPx;
      const y = (p.y - origin.y) * mPerPx;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    for (const hole of holes ?? []) {
      if (hole.length < 3) continue;
      const path = new THREE.Path();
      hole.forEach((p, i) => {
        const x = (p.x - origin.x) * mPerPx;
        const y = (p.y - origin.y) * mPerPx;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
      shape.holes.push(path);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.scale(1, -1, 1);
    return geo;
  }, [outer, holes, origin.x, origin.y, mPerPx, thickness]);

  if (!geometry) return null;

  // baseY = topY - thickness, supaya top face berada di topY.
  return (
    <group position={[0, topY - thickness, 0]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={color}
          roughness={0.6}
          metalness={0.08}
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
  y,
}: {
  points: Point[];
  origin: Point;
  mPerPx: number;
  y: number;
}) {
  const geometry = useMemo(() => {
    if (points.length < 3) return null;
    const shape = new THREE.Shape();
    points.forEach((p, i) => {
      const x = (p.x - origin.x) * mPerPx;
      const y = (p.y - origin.y) * mPerPx;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);
    geo.scale(1, -1, 1);
    return geo;

  }, [points, origin.x, origin.y, mPerPx]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} position={[0, y, 0]} receiveShadow>
      <meshStandardMaterial color="#e7e5e0" side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---------- Structural Columns (Modul Struktur) ----------
function StructuralColumns({
  sketch,
  origin,
  mPerPx,
  baseMdpl,
  colorMode,
}: {
  sketch: Sketch;
  origin: Point;
  mPerPx: number;
  baseMdpl: number;
  colorMode: "sketch" | "bw";
}) {
  const grids = useMemo(
    () => collectGrids(sketch.structuralGrid, sketch.structuralGridExtras),
    [sketch.structuralGrid, sketch.structuralGridExtras],
  );
  const sortedLevels = useMemo(
    () => [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl),
    [sketch.levels],
  );
  const items = useMemo(() => {
    if (!grids.length) return [] as Array<{
      key: string; x: number; z: number; y: number; h: number; size: number; rotY: number;
    }>;
    const out: Array<{ key: string; x: number; z: number; y: number; h: number; size: number; rotY: number }> = [];

    for (let gi = 0; gi < grids.length; gi++) {
      const grid = grids[gi];
      if (grid.lineOnly) continue; // grid garis tunggal: tanpa kolom
      const colM = grid.colSizeCm / 100;
      const ox = (grid.origin.x - origin.x) * mPerPx;
      const oz = (grid.origin.y - origin.y) * mPerPx;
      const rotDeg = Number(grid.rotation) || 0;
      const rotRad = (rotDeg * Math.PI) / 180;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);
      for (let li = 0; li < sortedLevels.length; li++) {
        const lv = sortedLevels[li];
        if (!levelInRange(grid, lv, sortedLevels)) continue;
        const { spansX, spansY } = spansForLevel(grid, lv.id);
        const xs = axisPositions(spansX);
        const zs = axisPositions(spansY);
        const next = sortedLevels[li + 1];
        const floorH = Number.isFinite(Number(lv.typicalHeight)) && Number(lv.typicalHeight) > 0
          ? Number(lv.typicalHeight)
          : (next ? next.mdpl - lv.mdpl : 3);
        const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
        const totalH = Math.max(0.1, floorH * k);
        const yBase = lv.mdpl - baseMdpl;
        for (let i = 0; i < xs.length; i++) {
          for (let j = 0; j < zs.length; j++) {
            if (!isNodeActive(grid, lv.id, i, j)) continue;
            if (isColumnClipped(grid, xs[i], zs[j])) continue;
            // Rotasi sumbu grid (CW positif di 2D = CW di bidang XZ ketika dilihat dari atas).
            const lx = xs[i];
            const lz = zs[j];
            const rx = lx * cosR - lz * sinR;
            const rz = lx * sinR + lz * cosR;
            out.push({
              key: `g${gi}_${lv.id}_${i}_${j}`,
              x: ox + rx,
              z: oz + rz,
              y: yBase + totalH / 2,
              h: totalH,
              size: colM,
              rotY: -rotRad,
            });
          }
        }
      }
    }
    return out;
  }, [grids, sortedLevels, origin.x, origin.y, mPerPx, baseMdpl]);


  if (items.length === 0) return null;
  const col = "#ffffff";
  return (
    <group>
      {items.map((it) => (
        <mesh key={it.key} position={[it.x, it.y, it.z]} rotation={[0, it.rotY, 0]} castShadow receiveShadow>
          <boxGeometry args={[it.size, it.h, it.size]} />
          <meshStandardMaterial color={col} roughness={0.7} metalness={0.05} />
          <Edges threshold={15} color="#444444" />
        </mesh>
      ))}
    </group>
  );
}




function Scene({
  sketch,
  highlightLevelId,
  sunHour,
  colorMode,
}: {
  sketch: Sketch;
  highlightLevelId: string | null;
  sunHour: number;
  colorMode: "sketch" | "bw";
}) {
  const mPerPx = metersPerPx(sketch.scale);
  const origin = useMemo(() => computeOrigin(sketch), [sketch]);
  const floors = useMemo(() => expandLevels(sketch.levels), [sketch.levels]);
  const baseMdpl = floors[0]?.baseMdpl ?? 0;
  const groundY = 0 - baseMdpl;

  const lahanLayers = sketch.layers.filter((l) => isLahan(l.name));
  const tamanLayers = sketch.layers.filter((l) => isTaman(l.name));
  const buildLayers = sketch.layers.filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name));
  const groundLevel = findMdplZeroLevel(sketch.levels) ?? [...sketch.levels].sort((a, b) => a.mdpl - b.mdpl)[0];
  const groundFloor = floors.find((f) => f.sourceId === groundLevel?.id) ?? floors[0];
  const tamanBaseY = (groundFloor?.baseMdpl ?? 0) - baseMdpl;

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
    const azNorthCW = sc.azimuth + Math.PI;
    const north = ((Number(sketch.northRotation) || 0) * Math.PI) / 180;
    const az = azNorthCW - north;
    const alt = Math.max(0.01, sc.altitude);
    const dist = 80;
    const horiz = Math.cos(alt) * dist;
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
        <GroundPlane key={ly.id} points={ly.points} origin={origin} mPerPx={mPerPx} y={groundY - 0.02} />
      ))}

      <Grid
        args={[200, 200]}
        cellSize={1}
        cellThickness={0.5}
        cellColor={colorMode === "bw" ? "#bfbfbf" : "#cfcfcf"}
        sectionSize={10}
        sectionThickness={1}
        sectionColor={colorMode === "bw" ? "#808080" : "#9a9a9a"}
        position={[0, groundY - 0.01, 0]}
        fadeDistance={120}
        fadeStrength={1}
        infiniteGrid
      />

      {floors.map((lv) => {
        const layersOfLevel = buildLayers.filter((l) => l.levelId === lv.sourceId);
        return layersOfLevel.map((ly, idx) => {
          const override = roomExtrudeOverride(ly.name);
          if (override && override.height <= 0) return null;
          const sketchColor =
            ly.color?.replace(/rgba?\(([^)]+)\)/, (_, body) => {
              const parts = body.split(",").map((s: string) => s.trim());
              return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
            }) || "#e85d3a";
          const baseColor = override ? override.color : sketchColor;
          const color = colorMode === "bw" ? "#dcdcdc" : baseColor;
          const h = override ? override.height : lv.height;
          const baseY = lv.baseMdpl - baseMdpl + (override ? override.baseDelta : 0);
          return (
            <ExtrudedFloor
              key={`${lv.id}_${ly.id}_${idx}`}
              points={ly.points}
              origin={origin}
              mPerPx={mPerPx}
              baseY={baseY}
              height={h}
              color={color}
              highlighted={highlightLevelId === lv.sourceId}
            />
          );
        });
      })}

      {tamanLayers.map((ly, idx) => (
        <ExtrudedFloor
          key={`taman_${ly.id}_${idx}`}
          points={ly.points}
          origin={origin}
          mPerPx={mPerPx}
          baseY={tamanBaseY}
          height={0.1}
          color={colorMode === "bw" ? "#cfcfcf" : TAMAN_GREEN}
          highlighted={false}
        />
      ))}

      <StructuralColumns
        sketch={sketch}
        origin={origin}
        mPerPx={mPerPx}
        baseMdpl={baseMdpl}
        colorMode={colorMode}
      />
    </>
  );
}

// ---------- Library grid (shared) ----------
function LibraryGrid({
  shots,
  onDownload,
  onRemove,
}: {
  shots: { id: string; dataUrl: string; ts: number }[];
  onDownload: (s: { dataUrl: string; ts: number }) => void;
  onRemove: (id: string) => void;
}) {
  if (shots.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Belum ada screenshot. Klik tombol <span className="font-medium">Screenshot</span> di atas kanvas.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {shots.map((s) => (
        <div
          key={s.id}
          className="group relative overflow-hidden rounded-md border border-border/60 bg-background"
        >
          <img
            src={s.dataUrl}
            alt="screenshot"
            className="block aspect-[4/3] w-full cursor-pointer object-cover"
            onClick={() => onDownload(s)}
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">
            <span className="font-mono">
              {new Date(s.ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(s.id);
              }}
              className="rounded p-0.5 hover:bg-white/20"
              aria-label="Hapus"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
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
  const [projection, setProjection] = useState<"persp" | "axon">("persp");
  const [colorMode, setColorMode] = useState<"sketch" | "bw">("sketch");
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [shots, setShots] = useState<{ id: string; dataUrl: string; ts: number }[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<any>(null);

  const shotsKey = `dabidabis_model3d_shots_${sketch.id}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(shotsKey);
      if (raw) setShots(JSON.parse(raw));
      else setShots([]);
    } catch {
      setShots([]);
    }
  }, [shotsKey]);
  const saveShots = useCallback(
    (next: { id: string; dataUrl: string; ts: number }[]) => {
      setShots(next);
      try {
        localStorage.setItem(shotsKey, JSON.stringify(next));
      } catch {
        // ignore quota
      }
    },
    [shotsKey],
  );
  const takeScreenshot = useCallback(() => {
    const el = canvasRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!el) return;
    try {
      const dataUrl = el.toDataURL("image/png");
      const item = { id: `s_${Date.now()}`, dataUrl, ts: Date.now() };
      saveShots([item, ...shots].slice(0, 24));
    } catch (e) {
      console.error(e);
    }
  }, [shots, saveShots]);
  const removeShot = (id: string) => saveShots(shots.filter((s) => s.id !== id));
  const downloadShot = (s: { dataUrl: string; ts: number }) => {
    const a = document.createElement("a");
    a.href = s.dataUrl;
    a.download = `${(sketch.title || "model").replace(/[^a-zA-Z0-9_-]+/g, "_")}_${s.ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

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

  const origin = useMemo(() => computeOrigin(sketch), [sketch]);
  const baseMdpl0 = expanded[0]?.baseMdpl ?? 0;

  const buildExportInputs = useCallback((): MeshInput[] => {
    const buildLayers = sketch.layers.filter(
      (l) => !isLahan(l.name) && !isVoid(l.name),
    );
    const inputs: MeshInput[] = [];
    for (const lv of expanded) {
      const layersOfLevel = buildLayers.filter((l) => l.levelId === lv.sourceId);
      for (const ly of layersOfLevel) {
        const override = roomExtrudeOverride(ly.name);
        if (override && override.height <= 0) continue;
        const rgb = override
          ? override.color
          : ly.color?.replace(/rgba?\(([^)]+)\)/, (_, body) => {
              const parts = body.split(",").map((s: string) => s.trim());
              return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
            }) || "#e85d3a";
        inputs.push({
          name: `${lv.name}_${ly.name}`,
          points: ly.points,
          origin,
          mPerPx,
          baseY: lv.baseMdpl - baseMdpl0 + (override ? override.baseDelta : 0),
          height: override ? override.height : lv.height,
          color: rgb,
        });
      }
    }
    return inputs;
  }, [sketch.layers, expanded, origin, mPerPx, baseMdpl0]);

  const safeTitle = (sketch.title || "model").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) || "model";

  const handleExport = useCallback((fmt: "obj" | "3ds") => {
    const meshes = buildMeshes(buildExportInputs());
    if (!meshes.length) {
      alert("Tidak ada geometri yang bisa diekspor.");
      return;
    }
    if (fmt === "obj") {
      const { obj, mtl, mtlName } = meshesToObj(meshes, safeTitle);
      triggerDownload(obj, `${safeTitle}.obj`, "text/plain");
      triggerDownload(mtl, mtlName, "text/plain");
    } else {
      const data = meshesTo3ds(meshes);
      triggerDownload(data, `${safeTitle}.3ds`, "application/octet-stream");
    }
  }, [buildExportInputs, safeTitle]);

  const viewerBody = (
    <div
      className={cn(
        "grid gap-4",
        fullscreen
          ? "h-full min-h-0 grid-cols-1 grid-rows-[1fr]"
          : "grid-cols-1 lg:grid-cols-[320px_1fr]",
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

      {/* Canvas 3D + library */}
      <div className={cn("flex flex-col gap-3", fullscreen && "h-full min-h-0")}>
        <div
          ref={canvasRef}
          className={cn(
            "relative rounded-lg border border-border bg-gradient-to-b from-slate-100 to-slate-300 overflow-hidden",
            fullscreen ? "flex-1 min-h-0" : "h-[520px]",
          )}
        >
          <Canvas
            key={projection}
            shadows
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            dpr={[1, 2]}
          >
            {projection === "persp" ? (
              <PerspectiveCamera
                makeDefault
                position={[25, 22, 25]}
                fov={45}
                near={0.1}
                far={1000}
              />
            ) : (
              <OrthographicCamera
                makeDefault
                position={[40, 40, 40]}
                zoom={18}
                near={-500}
                far={1000}
              />
            )}
            <color attach="background" args={[colorMode === "bw" ? "#f3f3f3" : "#eef1f4"]} />
            <Scene
              sketch={sketch}
              highlightLevelId={highlight}
              sunHour={sunHour}
              colorMode={colorMode}
            />
            <OrbitControls
              ref={orbitRef}
              enableDamping
              dampingFactor={0.08}
              makeDefault
            />
          </Canvas>

          <div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1">
            <div className="flex overflow-hidden rounded-md border border-border/60 bg-secondary/90 text-xs">
              <button
                type="button"
                onClick={() => setProjection("persp")}
                className={cn(
                  "px-2 py-1 transition-colors",
                  projection === "persp" ? "bg-primary text-primary-foreground" : "hover:bg-background/60",
                )}
              >
                Perspektif
              </button>
              <button
                type="button"
                onClick={() => setProjection("axon")}
                className={cn(
                  "px-2 py-1 transition-colors",
                  projection === "axon" ? "bg-primary text-primary-foreground" : "hover:bg-background/60",
                )}
              >
                Aksonometri
              </button>
            </div>
            <div className="flex overflow-hidden rounded-md border border-border/60 bg-secondary/90 text-xs">
              <button
                type="button"
                onClick={() => setColorMode("sketch")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 transition-colors",
                  colorMode === "sketch" ? "bg-primary text-primary-foreground" : "hover:bg-background/60",
                )}
              >
                <Palette className="h-3 w-3" /> Warna
              </button>
              <button
                type="button"
                onClick={() => setColorMode("bw")}
                className={cn(
                  "px-2 py-1 transition-colors",
                  colorMode === "bw" ? "bg-primary text-primary-foreground" : "hover:bg-background/60",
                )}
              >
                Hitam-Putih
              </button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={takeScreenshot}
            >
              <Camera className="h-3 w-3" /> Screenshot
            </Button>
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
                  <Minimize2 className="h-3 w-3" /> Keluar
                </>
              ) : (
                <>
                  <Maximize2 className="h-3 w-3" /> Full Screen
                </>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="h-7 gap-1 px-2 text-xs">
                  <Download className="h-3 w-3" /> Unduh
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuItem onClick={() => handleExport("obj")}>
                  Wavefront (.obj + .mtl)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("3ds")}>
                  Autodesk (.3ds)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/80 px-2 py-1 text-[10px] text-slate-700 shadow-sm">
            Drag = rotasi · Shift+Drag = pan · Scroll = zoom · 1 unit = 1 m ·{" "}
            {fmt(mPerPx, 4)} m/px
          </div>
          {sketch.geo?.locked && (
            <div className="absolute left-2 bottom-10 w-56 rounded-md bg-white/85 p-2 shadow-sm backdrop-blur">
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



          {/* Library screenshot — floating in fullscreen */}
          {fullscreen && (
            <div className="pointer-events-auto absolute inset-x-2 bottom-2 z-10 max-h-[40vh] overflow-hidden rounded-lg border border-border bg-card/90 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => setLibraryOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-card"
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Library Screenshot · {shots.length}
                </span>
                {libraryOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {libraryOpen && (
                <div className="max-h-[34vh] overflow-y-auto px-3 pb-3">
                  <LibraryGrid
                    shots={shots}
                    onDownload={downloadShot}
                    onRemove={removeShot}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Library screenshot — inline (normal mode) */}
        {!fullscreen && (
          <div className="rounded-lg border border-border bg-card/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Library Screenshot
              </h4>
              <span className="text-[10px] text-muted-foreground">
                {shots.length} gambar
              </span>
            </div>
            <LibraryGrid
              shots={shots}
              onDownload={downloadShot}
              onRemove={removeShot}
            />
          </div>
        )}
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background p-2">
        {viewerBody}
      </div>
    );
  }
  return viewerBody;
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
        setSketches((s.sketches as Sketch[]).map(bindLahanToMdplZero));
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
        s.id === id ? bindLahanToMdplZero({ ...s, ...patch, updatedAt: Date.now() }) : s,
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
