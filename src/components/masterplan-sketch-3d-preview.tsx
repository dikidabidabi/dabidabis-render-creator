// MasterplanSketch3DPreview
// Lightweight 3D preview of a sketch — designed to sit just below the 2D
// SketchCard on the Master Plan page. Reads layers + levels from the sketch
// prop, extrudes each layer at its level's elevation. Real-time by default;
// includes an "Update" button at the top-right that forces a remount + camera
// refit (useful after large structural edits).

import { useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Edges, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { RefreshCw, Box as BoxIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { solidColorForRoomName } from "@/lib/room-color";
import {
  roadCorridorPolygon as buildRoadCorridor,
  unionFilletedCorridors,
  type RoadSegment,
} from "@/lib/roads";


type Point = { x: number; y: number };
type Layer = {
  id: string;
  name: string;
  points: Point[];
  areaM2: number;
  color: string;
  levelId?: string;
};
type Level = {
  id: string;
  name: string;
  mdpl: number;
  typicalCount?: number;
  typicalHeight?: number;
};
type Sketch = {
  id: string;
  title: string;
  scale: string;
  layers: Layer[];
  levels: Level[];
  roads?: RoadSegment[];
};


const MINOR_PX = 8;
const MAJOR_EVERY = 10;
const METERS_PER_MAJOR: Record<string, number> = {
  "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10,
  "1:1200": 12, "1:1500": 15, "1:2000": 20,
};
const TYPICAL_FLOOR_H = 3;

function metersPerPx(scale: string) {
  const m = METERS_PER_MAJOR[scale] ?? 1;
  return m / (MINOR_PX * MAJOR_EVERY);
}
function isLahan(n: string) { return n.trim().toLowerCase().startsWith("lahan"); }
function isVoid(n: string) { return n.trim().toLowerCase() === "void"; }
function isTaman(n: string) { return n.trim().toLowerCase().startsWith("taman"); }
function tipH(lv: Level): number {
  const h = Number(lv.typicalHeight);
  return Number.isFinite(h) && h > 0 ? h : TYPICAL_FLOOR_H;
}

type Expanded = { id: string; sourceId: string; baseMdpl: number; height: number };
function expandLevels(levels: Level[]): Expanded[] {
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  let shift = 0;
  const adj = sorted.map((lv) => {
    const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
    const h = tipH(lv);
    const base = lv.mdpl + shift;
    shift += (k - 1) * h;
    return { lv, k, base, h };
  });
  const out: Expanded[] = [];
  for (let i = 0; i < adj.length; i++) {
    const { lv, k, base, h } = adj[i];
    const next = adj[i + 1];
    if (k === 1) {
      const hh = next ? Math.max(0.1, next.base - base) : 4;
      out.push({ id: lv.id, sourceId: lv.id, baseMdpl: base, height: hh });
    } else {
      for (let j = 0; j < k; j++) {
        out.push({ id: `${lv.id}__t${j}`, sourceId: lv.id, baseMdpl: base + j * h, height: h });
      }
    }
  }
  return out;
}

function ExtrudedMesh({
  points, origin, mPerPx, baseY, height, color,
}: {
  points: Point[]; origin: Point; mPerPx: number;
  baseY: number; height: number; color: string;
}) {
  const geo = useMemo(() => {
    if (points.length < 3 || height <= 0) return null;
    const shape = new THREE.Shape();
    points.forEach((p, i) => {
      const x = (p.x - origin.x) * mPerPx;
      const y = (p.y - origin.y) * mPerPx;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    g.scale(1, -1, 1);
    return g;
  }, [points, origin.x, origin.y, mPerPx, height]);
  if (!geo) return null;
  return (
    <group position={[0, baseY, 0]}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.75} metalness={0.05} side={THREE.DoubleSide} />
        <Edges threshold={15} color="#1a1a1a" />
      </mesh>
    </group>
  );
}

function RoadExtruded({
  outer, holes, origin, mPerPx, baseY, height,
}: {
  outer: Point[]; holes: Point[][]; origin: Point; mPerPx: number;
  baseY: number; height: number;
}) {
  const geo = useMemo(() => {
    if (outer.length < 3 || height <= 0) return null;
    const shape = new THREE.Shape();
    outer.forEach((p, i) => {
      const x = (p.x - origin.x) * mPerPx;
      const y = (p.y - origin.y) * mPerPx;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    });
    shape.closePath();
    for (const h of holes) {
      if (h.length < 3) continue;
      const hole = new THREE.Path();
      h.forEach((p, i) => {
        const x = (p.x - origin.x) * mPerPx;
        const y = (p.y - origin.y) * mPerPx;
        if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
      });
      hole.closePath();
      shape.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    g.scale(1, -1, 1);
    return g;
  }, [outer, holes, origin.x, origin.y, mPerPx, height]);
  if (!geo) return null;
  return (
    <group position={[0, baseY, 0]}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial color="#3f3f46" roughness={0.95} metalness={0.0} side={THREE.DoubleSide} />
        <Edges threshold={20} color="#18181b" />
      </mesh>
    </group>
  );
}


export function MasterplanSketch3DPreview({ sketch }: { sketch: Sketch }) {
  const [tick, setTick] = useState(0);
  const mPerPx = metersPerPx(sketch.scale);

  const origin = useMemo<Point>(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
    for (const ly of sketch.layers) {
      for (const p of ly.points) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
        n++;
      }
    }
    if (!n) return { x: 0, y: 0 };
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }, [sketch.layers]);

  const expanded = useMemo(() => expandLevels(sketch.levels), [sketch.levels]);
  const levelMap = useMemo(() => {
    const m = new Map<string, Expanded>();
    for (const e of expanded) if (!m.has(e.sourceId)) m.set(e.sourceId, e);
    return m;
  }, [expanded]);

  // Bound — for camera framing
  const bound = useMemo(() => {
    let r = 30;
    for (const ly of sketch.layers) {
      for (const p of ly.points) {
        const dx = (p.x - origin.x) * mPerPx;
        const dz = (p.y - origin.y) * mPerPx;
        r = Math.max(r, Math.hypot(dx, dz));
      }
    }
    return r;
  }, [sketch.layers, origin.x, origin.y, mPerPx]);

  const meshes = useMemo(() => {
    const out: { key: string; pts: Point[]; base: number; h: number; color: string }[] = [];
    for (const ly of sketch.layers) {
      if (isVoid(ly.name)) continue;
      if (ly.points.length < 3) continue;
      const lv = ly.levelId ? levelMap.get(ly.levelId) : undefined;
      const baseMdpl = lv?.baseMdpl ?? 0;
      let h = lv?.height ?? TYPICAL_FLOOR_H;
      let color = solidColorForRoomName(ly.name) || ly.color || "#cbd5e1";
      if (isLahan(ly.name)) { h = 0.2; color = "#d6d3d1"; }
      else if (isTaman(ly.name)) { h = 0.3; color = "#22c55e"; }
      out.push({ key: ly.id, pts: ly.points, base: baseMdpl, h, color });
    }
    return out;
  }, [sketch.layers, levelMap]);

  const roadRings = useMemo(() => {
    const roads = sketch.roads ?? [];
    if (!roads.length) return [] as { outer: Point[]; holes: Point[][] }[];
    const pxPerMeter = 1 / mPerPx;
    const FILLET_M = 4;
    const corridors = roads
      .map((r) => buildRoadCorridor(r, pxPerMeter) as Point[])
      .filter((c) => c.length >= 3);
    return unionFilletedCorridors(corridors, FILLET_M * pxPerMeter);
  }, [sketch.roads, mPerPx]);

  const camDist = bound * 2.2 + 30;


  return (
    <div className="relative border-t border-border/40 bg-gradient-to-b from-slate-100 to-slate-200">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <div className="rounded-md border border-border/40 bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur">
          <BoxIcon className="mr-1 inline h-3 w-3" /> Pratinjau 3D
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTick((t) => t + 1)}
          title="Perbarui & paskan kamera"
          className="h-7 bg-background/80 backdrop-blur"
        >
          <RefreshCw className="mr-1 h-3 w-3" /> Update
        </Button>
      </div>
      <div style={{ height: 360 }} className="w-full">
        <Canvas key={tick} shadows dpr={[1, 1.5]}>
          <PerspectiveCamera
            makeDefault
            position={[camDist * 0.7, camDist * 0.8, camDist * 0.7]}
            fov={40}
            near={0.1}
            far={camDist * 10}
          />
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[bound, bound * 1.5, bound * 0.6]}
            intensity={1.1}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
          {/* ground */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
            <planeGeometry args={[bound * 6, bound * 6]} />
            <meshStandardMaterial color="#e2e8f0" roughness={1} />
          </mesh>
          {meshes.map((m) => (
            <ExtrudedMesh
              key={m.key}
              points={m.pts}
              origin={origin}
              mPerPx={mPerPx}
              baseY={m.base}
              height={m.h}
              color={m.color}
            />
          ))}
          <OrbitControls
            makeDefault
            enableDamping
            target={[0, bound * 0.15, 0]}
            maxPolarAngle={Math.PI / 2 - 0.02}
          />
        </Canvas>
      </div>
    </div>
  );
}
