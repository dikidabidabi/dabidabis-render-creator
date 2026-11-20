// Kotak "Detail 3D" untuk satu level: lantai, dinding sesuai tebal material,
// pintu, dan jendela. Tinggi dinding mengikuti tinggi level.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Box, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildLevelDetail3d, type Detail3dInput, type Detail3dKind, type Detail3dPrism } from "@/lib/level-detail-3d";

const KIND_STYLE: Record<Exclude<Detail3dKind, "floor">, { color: string; opacity?: number; edges?: string }> = {
  wall: { color: "#f1ece4", edges: "#6b645c" },
  concrete: { color: "#b9b7b2", edges: "#2f2d2a" },
  concept: { color: "#d8d2c8", edges: "#4a453f" },
  glass: { color: "#8fc6e0", opacity: 0.38, edges: "#3f7f9c" },
  railing: { color: "#6f7378", edges: "#2a2c2e" },
  frame: { color: "#4a3f36" },
  door: { color: "#a8743f", edges: "#5a3b1c" },
  slab: { color: "#a3a7ad", edges: "#4b4f55" },
};

function prismGeometry(prism: Detail3dPrism, cx: number, cy: number): THREE.BufferGeometry | null {
  const depth = prism.top - prism.bottom;
  if (!(depth > 0) || prism.outer.length < 3) return null;
  const shape = new THREE.Shape(prism.outer.map((p) => new THREE.Vector2(p.x - cx, p.y - cy)));
  for (const hole of prism.holes) {
    if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x - cx, p.y - cy))));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  // Sama dengan halaman Model 3D: +y sketsa → +Z scene, ekstrusi ke atas (tidak ter-mirror).
  geo.rotateX(Math.PI / 2);
  geo.scale(1, -1, 1);
  geo.translate(0, prism.bottom, 0);
  geo.clearGroups();
  return geo;
}

function mergedByKey(prisms: Detail3dPrism[], cx: number, cy: number) {
  const buckets = new Map<string, { kind: Detail3dKind; color?: string; geos: THREE.BufferGeometry[] }>();
  for (const prism of prisms) {
    const key = prism.kind === "floor" ? `floor:${prism.color ?? ""}` : prism.kind;
    const geo = prismGeometry(prism, cx, cy);
    if (!geo) continue;
    const bucket = buckets.get(key) ?? { kind: prism.kind, color: prism.color, geos: [] };
    bucket.geos.push(geo);
    buckets.set(key, bucket);
  }
  const out: Array<{ key: string; kind: Detail3dKind; color?: string; geometry: THREE.BufferGeometry }> = [];
  for (const [key, bucket] of buckets) {
    const merged = bucket.geos.length === 1 ? bucket.geos[0]! : mergeGeometries(bucket.geos, false);
    if (merged && merged !== bucket.geos[0]) bucket.geos.forEach((g) => g.dispose());
    if (merged) out.push({ key, kind: bucket.kind, color: bucket.color, geometry: merged });
  }
  return out;
}

export type LevelDetail3dBoxProps = {
  levelName: string;
  input: Detail3dInput;
};

export function LevelDetail3dBox({ levelName, input }: LevelDetail3dBoxProps) {
  // Halaman Model 3D memuat ulang sketsa berkala; bangun ulang hanya bila isinya berubah.
  const stableRef = useRef<{ key: string; input: Detail3dInput } | null>(null);
  const inputKey = JSON.stringify(input);
  if (!stableRef.current || stableRef.current.key !== inputKey) stableRef.current = { key: inputKey, input };
  const stableInput = stableRef.current.input;
  const model = useMemo(() => buildLevelDetail3d(stableInput), [stableInput]);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const b = model.bounds;
  const cx = b ? (b.minX + b.maxX) / 2 : 0;
  const cy = b ? (b.minY + b.maxY) / 2 : 0;
  const span = b ? Math.max(4, b.maxX - b.minX, b.maxY - b.minY) : 10;
  const meshes = useMemo(() => mergedByKey(model.prisms, cx, cy), [model.prisms, cx, cy]);
  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes]);
  const camDist = span * 1.15 + model.wallHeight;
  const hasWalls = model.counts.walls > 0;
  const fmt = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card/40",
        fullscreen && "fixed inset-3 z-50 bg-background shadow-2xl",
      )}
      aria-label={`Detail 3D ${levelName}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">Detail 3D — {levelName}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              Tinggi dinding {fmt(model.wallHeight)} m · {model.counts.walls} dinding · {model.counts.doors} pintu · {model.counts.windows} jendela
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewKey((k) => k + 1)} aria-label="Atur ulang tampilan" title="Atur ulang tampilan">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setFullscreen((f) => !f)} aria-label={fullscreen ? "Perkecil" : "Layar penuh"} title={fullscreen ? "Perkecil" : "Layar penuh"}>
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      <div className={cn("relative bg-muted/30", fullscreen ? "min-h-0 flex-1" : "h-[420px]")}>
        {model.prisms.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
            Level ini belum punya ruang atau dinding bermaterial. Beri material dinding lewat Pick Material di halaman Sketsa.
          </div>
        ) : (
          <Canvas key={viewKey} shadows dpr={[1, 2]} camera={{ position: [camDist * 0.7, camDist * 1.1, camDist * 0.9], fov: 40, near: 0.05, far: camDist * 20 }}>
            <color attach="background" args={["#f4f1ec"]} />
            <ambientLight intensity={0.55} />
            <hemisphereLight args={["#ffffff", "#c9c2b8", 0.7]} />
            <directionalLight position={[span * 0.8, span * 1.8, span * 1.1]} intensity={1.25} castShadow shadow-mapSize={[2048, 2048]} />
            <directionalLight position={[-span, span, -span * 0.6]} intensity={0.45} />
            <group>
              {meshes.map((m) => {
                const style = m.kind === "floor" ? { color: m.color ?? "#d6d0c6", edges: "#55504a" } : KIND_STYLE[m.kind];
                const transparent = style.opacity !== undefined;
                return (
                  <mesh key={m.key} geometry={m.geometry} castShadow={!transparent} receiveShadow>
                    <meshStandardMaterial
                      color={style.color}
                      roughness={m.kind === "glass" ? 0.1 : 0.75}
                      metalness={m.kind === "glass" ? 0.1 : 0.02}
                      transparent={transparent}
                      opacity={style.opacity ?? 1}
                      depthWrite={!transparent}
                      side={THREE.DoubleSide}
                    />
                    {style.edges && <Edges threshold={20} color={style.edges} />}
                  </mesh>
                );
              })}
            </group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow>
              <planeGeometry args={[span * 4, span * 4]} />
              <shadowMaterial opacity={0.18} />
            </mesh>
            <OrbitControls makeDefault target={[0, model.wallHeight * 0.35, 0]} enableDamping />
          </Canvas>
        )}
        {!hasWalls && model.prisms.length > 0 && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md bg-background/85 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
            Belum ada dinding bermaterial di level ini — beri material lewat Pick Material di halaman Sketsa.
          </div>
        )}
      </div>
    </div>
  );
}
