// Kotak "Detail 3D" untuk satu level: lantai, dinding sesuai tebal material,
// pintu, dan jendela. Tinggi dinding mengikuti tinggi level.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Edges, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { AppWindow, Box, Check, Maximize2, Minimize2, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WINDOW_HEIGHT_TYPES, windowHeightLabel, type WindowHeightType } from "@/lib/windows";
import { cn } from "@/lib/utils";
import { buildLevelDetail3d, type Detail3dInput } from "@/lib/level-detail-3d";
import { detail3dMergedMeshes, detail3dStyle } from "@/lib/level-detail-3d-mesh";

export type LevelDetail3dBoxProps = {
  levelName: string;
  input: Detail3dInput;
  /** Mengganti tipe jendela tersimpan; tanpa ini tombol Edit disembunyikan. */
  onWindowTypeChange?: (windowId: string, type: WindowHeightType) => void;
};

export function LevelDetail3dBox({ levelName, input, onWindowTypeChange }: LevelDetail3dBoxProps) {
  // Halaman Model 3D memuat ulang sketsa berkala; bangun ulang hanya bila isinya berubah.
  const stableRef = useRef<{ key: string; input: Detail3dInput } | null>(null);
  const inputKey = JSON.stringify(input);
  if (!stableRef.current || stableRef.current.key !== inputKey) stableRef.current = { key: inputKey, input };
  const stableInput = stableRef.current.input;
  const model = useMemo(() => buildLevelDetail3d(stableInput), [stableInput]);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const editableWindows = onWindowTypeChange ? model.windows.filter((window) => window.id) : [];
  const b = model.bounds;
  const cx = b ? (b.minX + b.maxX) / 2 : 0;
  const cy = b ? (b.minY + b.maxY) / 2 : 0;
  const span = b ? Math.max(4, b.maxX - b.minX, b.maxY - b.minY) : 10;
  const meshes = useMemo(() => detail3dMergedMeshes(model.prisms, cx, cy), [model.prisms, cx, cy]);
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
              Tinggi dinding {fmt(model.wallHeight)} m · {model.counts.walls} dinding · {model.counts.columns} kolom · {model.counts.doors} pintu · {model.counts.windows} jendela
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onWindowTypeChange && (
            <Button
              type="button"
              size="sm"
              variant={editing ? "default" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setEditing((value) => !value)}
              aria-pressed={editing}
              title="Edit tipe jendela"
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />Edit
            </Button>
          )}
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
                const style = detail3dStyle(m.kind, m.color);
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
            {editing && editableWindows.map((window) => (
              <Html
                key={window.id}
                position={[window.center.x - cx, (window.sill + window.head) / 2, window.center.y - cy]}
                center
                zIndexRange={[40, 0]}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-md transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Ubah tipe jendela (${windowHeightLabel(window.type)})`}
                      title={windowHeightLabel(window.type)}
                    >
                      <AppWindow className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-60">
                    <DropdownMenuLabel className="text-xs">Tipe jendela</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {WINDOW_HEIGHT_TYPES.map((option) => (
                      <DropdownMenuItem key={option.value} onSelect={() => onWindowTypeChange?.(window.id, option.value)} className="items-start gap-2">
                        <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", option.value === window.type ? "opacity-100" : "opacity-0")} />
                        <span className="flex flex-col">
                          <span className="text-xs font-medium">{option.label}</span>
                          <span className="text-[10px] text-muted-foreground">{option.hint}</span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </Html>
            ))}
            <OrbitControls makeDefault target={[0, model.wallHeight * 0.35, 0]} enableDamping />
          </Canvas>
        )}
        {editing && (
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-md bg-background/85 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
            {editableWindows.length ? "Tekan tombol pada jendela untuk memilih tipe jendela." : "Belum ada jendela di level ini."}
          </div>
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
