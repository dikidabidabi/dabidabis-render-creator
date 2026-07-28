// Shared R3F component that fetches OSM building footprints around a geo
// anchor and extrudes them in 3D world space. Anchoring matches FloorSlab /
// MapGround conventions in both the Masterplan preview and Model3D page:
//
//   sketch pixel (px, py) -> world ( (px - origin.x) * mPerPx,
//                                    0,
//                                    (py - origin.y) * mPerPx )
//   sketch.geo (lat, lon) is anchored at sketch pixel (0, 0).
//   +east  -> world +X
//   +north -> world -Z  (canvas Y grows downward = world +Z = south)

import { useEffect, useMemo, useRef, useState } from "react";
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
}: {
  geo: OsmGeo;
  origin: { x: number; y: number };
  mPerPx: number;
  radiusM?: number;
  groundY?: number;
  colorMode?: "sketch" | "bw";
  opacity?: number;
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

  // Anchor position of geo(0,0) in 3D world.
  const anchorX = -origin.x * mPerPx;
  const anchorZ = -origin.y * mPerPx;

  const meshes = useMemo(() => {
    if (!buildings) return [] as { geo: THREE.BufferGeometry; color: string; height: number; id: string }[];
    const out: { geo: THREE.BufferGeometry; color: string; height: number; id: string }[] = [];
    for (const b of buildings) {
      if (b.ring.length < 3) continue;
      const shape = new THREE.Shape();
      b.ring.forEach((p, i) => {
        // east -> +X, north -> -Z. Shape lives in XY then rotated to XZ.
        const sx = p.east;
        const sy = -p.north;
        if (i === 0) shape.moveTo(sx, sy);
        else shape.lineTo(sx, sy);
      });
      shape.closePath();
      let g: THREE.ExtrudeGeometry;
      try {
        g = new THREE.ExtrudeGeometry(shape, { depth: b.heightM, bevelEnabled: false });
      } catch {
        continue;
      }
      // Match FloorSlab orientation: rotateX(π/2), scale(1,-1,1).
      g.rotateX(Math.PI / 2);
      g.scale(1, -1, 1);
      g.computeVertexNormals();
      // Color: warm neutral for sketch mode, grey for B&W.
      const color = colorMode === "bw" ? "#c9c9c9" : b.source === "fallback" ? "#c4b7a4" : "#d6c9b3";
      out.push({ geo: g, color, height: b.heightM, id: b.id });
    }
    return out;
  }, [buildings, colorMode]);

  useEffect(() => {
    return () => {
      meshes.forEach((m) => m.geo.dispose());
    };
  }, [meshes]);

  if (!buildings || meshes.length === 0) return null;

  return (
    <group position={[anchorX, groundY, anchorZ]}>
      {meshes.map((m) => (
        <mesh key={m.id} geometry={m.geo} castShadow receiveShadow>
          <meshStandardMaterial
            color={m.color}
            transparent={opacity < 1}
            opacity={opacity}
            roughness={0.85}
            metalness={0.02}
          />
        </mesh>
      ))}
    </group>
  );
}
