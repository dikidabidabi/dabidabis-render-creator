// Shared R3F component that fetches OSM building footprints around a geo
// anchor and extrudes them in 3D world space. Anchoring matches FloorSlab /
// MapGround conventions in both the Masterplan preview and Model3D page.
//
// Also supports an interactive "edit" mode: while `editMode` is true, users
// can press-and-drag any building vertically to push/pull its height. During
// the drag a live label shows the current height in meters. On release, the
// new height is committed via `onHeightChange`.

import { useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { fetchOsmBuildings, type OsmBuilding } from "@/lib/osm-buildings";

export type OsmGeo = { lat: number; lon: number; locked?: boolean };

export function OsmBuildingsLayer({
  geo,
  origin,
  mPerPx,
  radiusM = 350,
  groundY = 0,
  colorMode = "sketch",
  opacity = 1,
  editMode = false,
  heightOverrides,
  onHeightChange,
}: {
  geo: OsmGeo;
  origin: { x: number; y: number };
  mPerPx: number;
  radiusM?: number;
  groundY?: number;
  colorMode?: "sketch" | "bw";
  opacity?: number;
  editMode?: boolean;
  heightOverrides?: Record<string, number>;
  onHeightChange?: (id: string, height: number) => void;
}) {
  const [buildings, setBuildings] = useState<OsmBuilding[] | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) return;
    const myReq = ++reqRef.current;
    const ac = new AbortController();
    setBuildings(null);
    fetchOsmBuildings(geo.lat, geo.lon, radiusM, ac.signal)
      .then((data) => {
        if (reqRef.current === myReq) setBuildings(data);
      })
      .catch(() => {
        if (reqRef.current === myReq) setBuildings([]);
      });
    return () => ac.abort();
  }, [geo?.lat, geo?.lon, radiusM]);

  const anchorX = -origin.x * mPerPx;
  const anchorZ = -origin.y * mPerPx;

  const meshes = useMemo(() => {
    if (!buildings)
      return [] as {
        geo: THREE.BufferGeometry;
        color: string;
        baseHeight: number;
        id: string;
        cx: number;
        cz: number;
      }[];
    const out: {
      geo: THREE.BufferGeometry;
      color: string;
      baseHeight: number;
      id: string;
      cx: number;
      cz: number;
    }[] = [];
    for (const b of buildings) {
      if (b.ring.length < 3) continue;
      const shape = new THREE.Shape();
      let sumE = 0;
      let sumN = 0;
      b.ring.forEach((p, i) => {
        const sx = p.east;
        const sy = -p.north;
        if (i === 0) shape.moveTo(sx, sy);
        else shape.lineTo(sx, sy);
        sumE += p.east;
        sumN += p.north;
      });
      shape.closePath();
      let g: THREE.ExtrudeGeometry;
      try {
        g = new THREE.ExtrudeGeometry(shape, {
          depth: b.heightM,
          bevelEnabled: false,
        });
      } catch {
        continue;
      }
      g.rotateX(Math.PI / 2);
      g.scale(1, -1, 1);
      const idx = g.getIndex();
      if (idx) {
        const arr = idx.array as ArrayLike<number>;
        const flipped = new Uint32Array(arr.length);
        for (let i = 0; i < arr.length; i += 3) {
          flipped[i] = arr[i];
          flipped[i + 1] = arr[i + 2];
          flipped[i + 2] = arr[i + 1];
        }
        g.setIndex(new THREE.BufferAttribute(flipped, 1));
      }
      g.computeVertexNormals();
      const color =
        colorMode === "bw"
          ? "#c9c9c9"
          : b.source === "fallback"
            ? "#c4b7a4"
            : "#d6c9b3";
      const n = b.ring.length || 1;
      out.push({
        geo: g,
        color,
        baseHeight: b.heightM,
        id: b.id,
        cx: sumE / n,
        cz: -sumN / n,
      });
    }
    return out;
  }, [buildings, colorMode]);

  useEffect(() => {
    return () => {
      meshes.forEach((m) => m.geo.dispose());
    };
  }, [meshes]);

  // ---- drag state (edit mode) ----
  const [drag, setDrag] = useState<
    | {
        id: string;
        startY: number;
        startH: number;
        current: number;
      }
    | null
  >(null);

  const currentHeightOf = (id: string, baseH: number) => {
    if (drag && drag.id === id) return drag.current;
    const ov = heightOverrides?.[id];
    return typeof ov === "number" && Number.isFinite(ov) ? ov : baseH;
  };

  const onPointerDown = (
    e: ThreeEvent<PointerEvent>,
    m: { id: string; baseHeight: number },
  ) => {
    if (!editMode) return;
    e.stopPropagation();
    const startH = currentHeightOf(m.id, m.baseHeight);
    try {
      (e.target as Element)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    setDrag({
      id: m.id,
      startY: e.clientY,
      startH,
      current: startH,
    });
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return;
    e.stopPropagation();
    // 0.25 m per pixel; drag up (clientY decreases) => pull taller.
    const dy = drag.startY - e.clientY;
    const next = Math.max(2, Math.min(400, drag.startH + dy * 0.25));
    setDrag({ ...drag, current: next });
  };

  const commit = (e?: ThreeEvent<PointerEvent>) => {
    if (!drag) return;
    e?.stopPropagation();
    try {
      if (e) (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    onHeightChange?.(drag.id, drag.current);
    setDrag(null);
  };

  if (!buildings || meshes.length === 0) return null;

  return (
    <group position={[anchorX, groundY, anchorZ]}>
      {meshes.map((m) => {
        const h = currentHeightOf(m.id, m.baseHeight);
        const scaleY = h / Math.max(0.001, m.baseHeight);
        return (
          <group key={m.id}>
            <mesh
              geometry={m.geo}
              scale={[1, scaleY, 1]}
              castShadow
              receiveShadow
              onPointerDown={(e) => onPointerDown(e, m)}
              onPointerMove={onPointerMove}
              onPointerUp={commit}
              onPointerCancel={commit}
            >
              <meshStandardMaterial
                color={
                  editMode
                    ? drag?.id === m.id
                      ? "#f59e0b"
                      : "#eab676"
                    : m.color
                }
                transparent={opacity < 1}
                opacity={opacity}
                roughness={0.85}
                metalness={0.02}
                side={THREE.DoubleSide}
              />
            </mesh>
            {drag?.id === m.id && (
              <Html
                position={[m.cx, h + 2, m.cz]}
                center
                distanceFactor={40}
                zIndexRange={[100, 0]}
                style={{ pointerEvents: "none" }}
              >
                <div
                  style={{
                    background: "rgba(15,23,42,0.92)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: 4,
                    whiteSpace: "nowrap",
                    fontFamily: "ui-sans-serif, system-ui",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                  }}
                >
                  {h.toFixed(1)} m
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
