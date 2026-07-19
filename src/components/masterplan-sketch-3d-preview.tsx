// MasterplanSketch3DPreview
// Lightweight 3D preview of a sketch. Now includes Screenshot (JPEG) + hi-res
// 2K/4K capture + a library of stored screenshots keyed by sketch id, so the
// Studio page's Input node can consume them automatically.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Edges, PerspectiveCamera, OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import {
  RefreshCw,
  Box as BoxIcon,
  Maximize2,
  Minimize2,
  Camera,
  Trash2,
  Download,
  Palette,
  Move3d,
  Sun,
  SunDim,
  Save,
  RotateCcw,
  Map as MapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { solidColorForRoomName } from "@/lib/room-color";
import {
  roadCorridorPolygon as buildRoadCorridor,
  unionFilletedCorridors,
  clipRingsByPolygon,
  type RoadSegment,
} from "@/lib/roads";
import { drawOsmTiles, type Geo } from "@/lib/geo";


type Point = { x: number; y: number };
type Layer = {
  id: string;
  name: string;
  points: Point[];
  areaM2: number;
  color: string;
  levelId?: string;
  floors?: number;
};
type Level = {
  id: string;
  name: string;
  mdpl: number;
  typicalCount?: number;
  typicalHeight?: number;
  parentLayerId?: string;
};
type Sketch = {
  id: string;
  title: string;
  scale: string;
  layers: Layer[];
  levels: Level[];
  roads?: RoadSegment[];
  geo?: Geo;
};


type Shot = { id: string; dataUrl: string; ts: number };


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

function FloorLines({
  points, origin, mPerPx, baseY, floorH, floors,
}: {
  points: Point[]; origin: Point; mPerPx: number;
  baseY: number; floorH: number; floors: number;
}) {
  const geo = useMemo(() => {
    if (points.length < 3 || floors < 2) return null;
    const positions: number[] = [];
    for (let i = 1; i < floors; i++) {
      const y = i * floorH;
      for (let j = 0; j < points.length; j++) {
        const a = points[j];
        const b = points[(j + 1) % points.length];
        const ax = (a.x - origin.x) * mPerPx;
        const az = (a.y - origin.y) * mPerPx;
        const bx = (b.x - origin.x) * mPerPx;
        const bz = (b.y - origin.y) * mPerPx;
        positions.push(ax, y, az, bx, y, bz);
      }
    }
    if (!positions.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [points, origin.x, origin.y, mPerPx, floorH, floors]);
  if (!geo) return null;
  return (
    <group position={[0, baseY, 0]}>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color="#1f2937" transparent opacity={0.55} />
      </lineSegments>
    </group>
  );
}

function R3FRefCapture({
  target,
}: {
  target: React.MutableRefObject<{ gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null>;
}) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    target.current = { gl, scene, camera };
  }, [gl, scene, camera, target]);
  return null;
}

function VerticalPerspectiveCorrection({
  controlsRef,
}: {
  controlsRef: React.MutableRefObject<any>;
}) {
  const { size } = useThree();
  useEffect(() => {
    return () => {
      const ctrl = controlsRef.current;
      const cam = ctrl?.object as THREE.PerspectiveCamera | undefined;
      if (cam && (cam as any).isPerspectiveCamera) cam.clearViewOffset();
    };
  }, [controlsRef]);
  useFrame(() => {
    const ctrl = controlsRef.current;
    if (!ctrl?.object) return;
    const cam = ctrl.object as THREE.PerspectiveCamera;
    if (!(cam as any).isPerspectiveCamera) return;
    const target = ctrl.target as THREE.Vector3;
    const dx = target.x - cam.position.x;
    const dz = target.z - cam.position.z;
    const dy = target.y - cam.position.y;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 1e-3) return;
    cam.up.set(0, 1, 0);
    cam.lookAt(target.x, cam.position.y, target.z);
    const fovY = (cam.fov * Math.PI) / 180;
    const ndcY = dy / horiz / Math.tan(fovY / 2);
    const shiftPx = -ndcY * (size.height / 2);
    cam.setViewOffset(size.width, size.height, 0, shiftPx, size.width, size.height);
  });
  return null;
}

function toBW(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#c8c8c8";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const v = Math.max(160, Math.min(230, l));
  const s = v.toString(16).padStart(2, "0");
  return `#${s}${s}${s}`;
}



function MapGround({
  geo, origin, mPerPx, bound,
}: {
  geo: Geo; origin: Point; mPerPx: number; bound: number;
}) {
  const [state, setState] = useState<{ tex: THREE.CanvasTexture; w: number; h: number } | null>(null);
  useEffect(() => {
    const rangeM = Math.max(80, bound * 2.2);
    const Wm = rangeM * 2;
    const Hm = rangeM * 2;
    const wpm = Math.min(4, 2048 / Wm); // canvas px per meter
    const cw = Math.max(256, Math.round(Wm * wpm));
    const ch = Math.max(256, Math.round(Hm * wpm));
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // origin (3D world 0,0) sits at meter offset (cxM,cyM) from geo (sketch(0,0)).
    const cxM = origin.x * mPerPx;
    const cyM = origin.y * mPerPx;
    // Anchor ctx so that geo maps to a specific canvas pixel; drawOsmTiles draws
    // tiles positioned in world-coord where world(0,0) = geo.
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(0, 0, cw, ch);
    ctx.translate(cw / 2 - cxM * wpm, ch / 2 - cyM * wpm);
    const bounds = {
      minX: (cxM - Wm / 2) * wpm,
      maxX: (cxM + Wm / 2) * wpm,
      minY: (cyM - Hm / 2) * wpm,
      maxY: (cyM + Hm / 2) * wpm,
    };
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    let cancelled = false;
    const redraw = () => {
      if (cancelled) return;
      drawOsmTiles(ctx, {
        lat: geo.lat, lon: geo.lon,
        worldPxPerMeter: wpm,
        bounds,
        opacity: 1,
        onTileLoad: () => { tex.needsUpdate = true; },
      });
      tex.needsUpdate = true;
    };
    redraw();
    // Extra polls to catch async tile loads.
    const timers = [400, 900, 1800, 3200, 5500].map((ms) => setTimeout(redraw, ms));
    setState({ tex, w: Wm, h: Hm });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      tex.dispose();
    };
  }, [geo.lat, geo.lon, origin.x, origin.y, mPerPx, bound]);
  if (!state) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} receiveShadow>
      <planeGeometry args={[state.w, state.h]} />
      <meshBasicMaterial map={state.tex} transparent opacity={Math.max(0.2, Math.min(1, geo.mapOpacity ?? 0.85))} />
    </mesh>
  );
}


export function MasterplanSketch3DPreview({ sketch }: { sketch: Sketch }) {
  const [tick, setTick] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [projection, setProjection] = useState<"persp" | "axon">("persp");
  const [colorMode, setColorMode] = useState<"sketch" | "bw">("sketch");
  const [noLight, setNoLight] = useState(false);
  const [autoTilt, setAutoTilt] = useState(false);
  const [hasSavedView, setHasSavedView] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const orbitRef = useRef<any>(null);
  const r3fRef = useRef<{ gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null>(null);
  const mPerPx = metersPerPx(sketch.scale);

  const viewKey = `dabidabis_masterplan3d_view_${sketch.id}`;
  useEffect(() => {
    try { setHasSavedView(!!localStorage.getItem(viewKey)); } catch { setHasSavedView(false); }
  }, [viewKey]);
  const savePerspectiveView = useCallback(() => {
    const ctrl = orbitRef.current;
    if (!ctrl?.object) return;
    const cam = ctrl.object as THREE.Camera;
    const t = ctrl.target as THREE.Vector3;
    try {
      localStorage.setItem(viewKey, JSON.stringify({ pos: [cam.position.x, cam.position.y, cam.position.z], target: [t.x, t.y, t.z] }));
      setHasSavedView(true);
    } catch { /* ignore */ }
  }, [viewKey]);
  const restorePerspectiveView = useCallback(() => {
    const ctrl = orbitRef.current;
    if (!ctrl?.object) return;
    try {
      const raw = localStorage.getItem(viewKey);
      if (!raw) return;
      const { pos, target } = JSON.parse(raw) as { pos: number[]; target: number[] };
      ctrl.object.position.set(pos[0], pos[1], pos[2]);
      ctrl.target.set(target[0], target[1], target[2]);
      ctrl.update();
    } catch { /* ignore */ }
  }, [viewKey]);


  const shotsKey = `dabidabis_model3d_shots_${sketch.id}`;
  const [shots, setShots] = useState<Shot[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(shotsKey);
      setShots(raw ? JSON.parse(raw) : []);
    } catch {
      setShots([]);
    }
  }, [shotsKey]);

  const saveShots = useCallback(
    (next: Shot[]) => {
      setShots(next);
      let attempt = next.slice();
      for (let i = 0; i < 10; i++) {
        try {
          localStorage.setItem(shotsKey, JSON.stringify(attempt));
          return;
        } catch {
          if (attempt.length <= 1) {
            try { localStorage.removeItem(shotsKey); } catch { /* ignore */ }
            try { localStorage.setItem(shotsKey, JSON.stringify(attempt)); return; } catch { /* fall */ }
            return;
          }
          attempt = attempt.slice(0, attempt.length - 1);
          setShots(attempt);
        }
      }
    },
    [shotsKey],
  );

  const takeScreenshot = useCallback(() => {
    const el = canvasWrapRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!el) return;
    try {
      const dataUrl = el.toDataURL("image/jpeg", 0.9);
      if (!dataUrl || dataUrl.length < 1000) return;
      const item: Shot = { id: `s_${Date.now()}`, dataUrl, ts: Date.now() };
      saveShots([item, ...shots].slice(0, 12));
    } catch (e) {
      console.error(e);
    }
  }, [shots, saveShots]);

  const takeHiRes = useCallback((targetW: number, label: string) => {
    const r = r3fRef.current;
    if (!r) return;
    const { gl, scene, camera } = r;
    const prevSize = new THREE.Vector2();
    gl.getSize(prevSize);
    const prevPR = gl.getPixelRatio();
    const aspect = prevSize.x > 0 && prevSize.y > 0 ? prevSize.x / prevSize.y : 16 / 9;
    const targetH = Math.max(1, Math.round(targetW / aspect));
    const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    const prevAspect = persp ? (camera as THREE.PerspectiveCamera).aspect : 1;
    try {
      gl.setPixelRatio(1);
      gl.setSize(targetW, targetH, false);
      if (persp) {
        (camera as THREE.PerspectiveCamera).aspect = targetW / targetH;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }
      gl.render(scene, camera);
      const dataUrl = gl.domElement.toDataURL("image/jpeg", 0.95);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${(sketch.title || "masterplan").replace(/[^a-zA-Z0-9_-]+/g, "_")}_${label}_${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error(e);
    } finally {
      gl.setPixelRatio(prevPR);
      gl.setSize(prevSize.x, prevSize.y, false);
      if (persp) {
        (camera as THREE.PerspectiveCamera).aspect = prevAspect;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }
    }
  }, [sketch.title]);

  const removeShot = (id: string) => saveShots(shots.filter((s) => s.id !== id));
  const downloadShot = (s: Shot) => {
    const a = document.createElement("a");
    a.href = s.dataUrl;
    a.download = `${(sketch.title || "masterplan").replace(/[^a-zA-Z0-9_-]+/g, "_")}_${s.ts}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

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

  const MP_FLOOR_H = 4;
  const meshes = useMemo(() => {
    const out: { key: string; pts: Point[]; base: number; h: number; color: string; floors: number }[] = [];
    for (const ly of sketch.layers) {
      if (isVoid(ly.name)) continue;
      if (ly.points.length < 3) continue;
      const lv = ly.levelId ? levelMap.get(ly.levelId) : undefined;
      const baseMdpl = lv?.baseMdpl ?? 0;
      let h = lv?.height ?? TYPICAL_FLOOR_H;
      let color = solidColorForRoomName(ly.name) || ly.color || "#cbd5e1";
      let floors = 1;
      if (isLahan(ly.name)) { h = 0.05; color = "#d6d3d1"; }
      else if (isTaman(ly.name)) { h = 0.3; color = "#22c55e"; }
      else {
        floors = Math.max(1, Math.round(ly.floors ?? 1));
        h = floors * MP_FLOOR_H;
      }
      out.push({ key: ly.id, pts: ly.points, base: baseMdpl, h, color, floors });
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
    let rings = unionFilletedCorridors(corridors, FILLET_M * pxPerMeter);
    const lah = sketch.layers.find((l) => isLahan(l.name) && l.points.length >= 3);
    if (lah) rings = clipRingsByPolygon(rings, lah.points);
    return rings;
  }, [sketch.roads, sketch.layers, mPerPx]);

  const camDist = bound * 2.2 + 30;

  return (
    <div
      ref={wrapRef}
      className={
        fullscreen
          ? "fixed inset-0 z-50 bg-gradient-to-b from-slate-100 to-slate-200"
          : "relative border-t border-border/40 bg-gradient-to-b from-slate-100 to-slate-200"
      }
    >
      <div className="absolute right-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <div className="rounded-md border border-border/40 bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur">
          <BoxIcon className="mr-1 inline h-3 w-3" /> Pratinjau 3D
        </div>
        <div className="flex overflow-hidden rounded-md border border-border/40 bg-background/80 text-xs backdrop-blur">
          <button
            type="button"
            onClick={() => setProjection("persp")}
            className={cn("px-2 py-1 transition-colors", projection === "persp" ? "bg-primary text-primary-foreground" : "hover:bg-background")}
          >
            Perspektif
          </button>
          <button
            type="button"
            onClick={() => setProjection("axon")}
            className={cn("px-2 py-1 transition-colors", projection === "axon" ? "bg-primary text-primary-foreground" : "hover:bg-background")}
          >
            Aksonometri
          </button>
        </div>
        <div className="flex overflow-hidden rounded-md border border-border/40 bg-background/80 text-xs backdrop-blur">
          <button
            type="button"
            onClick={() => setColorMode("sketch")}
            className={cn("flex items-center gap-1 px-2 py-1 transition-colors", colorMode === "sketch" ? "bg-primary text-primary-foreground" : "hover:bg-background")}
          >
            <Palette className="h-3 w-3" /> Warna
          </button>
          <button
            type="button"
            onClick={() => setColorMode("bw")}
            className={cn("px-2 py-1 transition-colors", colorMode === "bw" ? "bg-primary text-primary-foreground" : "hover:bg-background")}
          >
            Hitam-Putih
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={takeScreenshot} title="Screenshot"
          className="h-7 bg-background/80 backdrop-blur">
          <Camera className="mr-1 h-3 w-3" /> Screenshot
        </Button>
        <Button variant="outline" size="sm" onClick={() => takeHiRes(2560, "2K")} title="Ekspor 2K"
          className="h-7 bg-background/80 backdrop-blur">
          2K
        </Button>
        <Button variant="outline" size="sm" onClick={() => takeHiRes(3840, "4K")} title="Ekspor 4K"
          className="h-7 bg-background/80 backdrop-blur">
          4K
        </Button>
        {projection === "persp" && (
          <>
            <Button
              variant={autoTilt ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoTilt((v) => !v)}
              title="Koreksi perspektif vertikal (garis vertikal tetap lurus)"
              className="h-7 bg-background/80 backdrop-blur"
            >
              <Move3d className="mr-1 h-3 w-3" /> {autoTilt ? "Koreksi V: On" : "Koreksi V"}
            </Button>
            <Button
              variant={noLight ? "default" : "outline"}
              size="sm"
              onClick={() => { setNoLight((v) => !v); setTick((t) => t + 1); }}
              title="Matikan cahaya & bayangan"
              className="h-7 bg-background/80 backdrop-blur"
            >
              {noLight ? <SunDim className="mr-1 h-3 w-3" /> : <Sun className="mr-1 h-3 w-3" />}
              {noLight ? "No Light" : "Cahaya"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={savePerspectiveView}
              title="Simpan sudut pandang perspektif"
              className="h-7 bg-background/80 backdrop-blur"
            >
              <Save className="mr-1 h-3 w-3" /> Save View
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={restorePerspectiveView}
              disabled={!hasSavedView}
              title="Pulihkan sudut pandang tersimpan"
              className="h-7 bg-background/80 backdrop-blur disabled:opacity-50"
            >
              <RotateCcw className="mr-1 h-3 w-3" /> Restore
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => setTick((t) => t + 1)} title="Perbarui"
          className="h-7 bg-background/80 backdrop-blur">
          <RefreshCw className="mr-1 h-3 w-3" /> Update
        </Button>
        <Button variant="outline" size="sm"
          onClick={() => { setFullscreen((v) => !v); setTick((t) => t + 1); }}
          title={fullscreen ? "Keluar layar penuh" : "Layar penuh"}
          className="h-7 bg-background/80 backdrop-blur">
          {fullscreen ? <Minimize2 className="mr-1 h-3 w-3" /> : <Maximize2 className="mr-1 h-3 w-3" />}
          {fullscreen ? "Tutup" : "Full"}
        </Button>
      </div>
      <div ref={canvasWrapRef} style={{ height: fullscreen ? "100vh" : 360 }} className="w-full">
        <Canvas key={`${tick}-${projection}-${noLight ? "nl" : "l"}`} shadows={!noLight} dpr={[1, 1.5]} gl={{ preserveDrawingBuffer: true }}>
          <R3FRefCapture target={r3fRef} />
          <color attach="background" args={[colorMode === "bw" ? "#f3f3f3" : "#eef1f4"]} />
          {projection === "persp" ? (
            <PerspectiveCamera
              makeDefault
              position={[camDist * 0.7, camDist * 0.8, camDist * 0.7]}
              fov={40}
              near={0.1}
              far={camDist * 10}
            />
          ) : (
            <OrthographicCamera
              makeDefault
              position={[camDist, camDist, camDist]}
              zoom={Math.max(2, 400 / Math.max(40, camDist))}
              near={-camDist * 10}
              far={camDist * 10}
            />
          )}
          {noLight ? (
            <ambientLight intensity={1.0} />
          ) : (
            <>
              <ambientLight intensity={0.55} />
              <directionalLight
                position={[bound, bound * 1.5, bound * 0.6]}
                intensity={1.1}
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
              />
            </>
          )}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
            <planeGeometry args={[bound * 6, bound * 6]} />
            <meshStandardMaterial color={colorMode === "bw" ? "#e5e5e5" : "#e2e8f0"} roughness={1} />
          </mesh>
          {meshes.map((m) => (
            <ExtrudedMesh
              key={m.key}
              points={m.pts}
              origin={origin}
              mPerPx={mPerPx}
              baseY={m.base}
              height={m.h}
              color={colorMode === "bw" ? toBW(m.color) : m.color}
            />
          ))}
          {meshes.map((m) =>
            m.floors >= 2 ? (
              <FloorLines
                key={`fl-${m.key}`}
                points={m.pts}
                origin={origin}
                mPerPx={mPerPx}
                baseY={m.base}
                floorH={MP_FLOOR_H}
                floors={m.floors}
              />
            ) : null,
          )}
          {roadRings.map((rr, i) => (
            <RoadExtruded
              key={`road-${i}`}
              outer={rr.outer}
              holes={rr.holes}
              origin={origin}
              mPerPx={mPerPx}
              baseY={0}
              height={0.15}
            />
          ))}
          <OrbitControls
            ref={orbitRef}
            makeDefault
            enableDamping
            target={[0, bound * 0.15, 0]}
            maxPolarAngle={Math.PI / 2 - 0.02}
          />
          {projection === "persp" && autoTilt && <VerticalPerspectiveCorrection controlsRef={orbitRef} />}
        </Canvas>
      </div>


      {/* Library Screenshot */}
      <div className={fullscreen
        ? "absolute bottom-3 left-3 right-3 z-10 max-h-40 overflow-auto rounded-lg border border-border/40 bg-background/90 p-2 backdrop-blur"
        : "border-t border-border/40 bg-background/60 p-2"}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Library Screenshot · {shots.length}
          </span>
        </div>
        {shots.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            Belum ada screenshot. Klik <b>Screenshot</b>. Screenshot tersedia di halaman Studio sebagai input.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6">
            {shots.map((s) => (
              <div key={s.id} className="group relative overflow-hidden rounded border border-border/60 bg-background">
                <img
                  src={s.dataUrl}
                  alt="shot"
                  className="block aspect-[4/3] w-full cursor-pointer object-cover"
                  onClick={() => downloadShot(s)}
                />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeShot(s.id); }}
                  className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-600/90"
                  aria-label="Hapus screenshot"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); downloadShot(s); }}
                  className="absolute left-1 top-1 rounded bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Unduh"
                >
                  <Download className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
