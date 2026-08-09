// Extrudes OSM road centerlines as a thin (10 cm) dark-grey slab in the 3D
// scene. Anchoring matches MapGround / OsmBuildingsLayer, and the whole layer
// is rotated by the sketch's map rotation so roads stay aligned with the map.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { fetchOsmRoads } from "@/lib/osm-roads";

const ROAD_H = 0.1; // 10 cm

export function OsmRoadsLayer({
  geo,
  origin,
  mPerPx,
  radiusM = 350,
  groundY = 0,
  rotationDeg = 0,
  visible = true,
}: {
  geo: { lat: number; lon: number };
  origin: { x: number; y: number };
  mPerPx: number;
  radiusM?: number;
  groundY?: number;
  rotationDeg?: number;
  visible?: boolean;
}) {
  const [roads, setRoads] = useState<
    { id: string; path: { east: number; north: number }[]; widthM: number }[] | null
  >(null);
  const reqRef = useRef(0);

  useEffect(() => {
    // Fetch regardless of `visible` so toggling the layer on is instant.
    if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) return;
    const myReq = ++reqRef.current;
    const ac = new AbortController();
    fetchOsmRoads(geo.lat, geo.lon, radiusM, ac.signal)
      .then((d) => {
        if (reqRef.current === myReq) setRoads(d);
      })
      .catch(() => {
        if (reqRef.current === myReq) setRoads([]);
      });
    return () => ac.abort();
  }, [geo?.lat, geo?.lon, radiusM]);

  const geometry = useMemo(() => {
    if (!roads || roads.length === 0) return null;
    const positions: number[] = [];
    const indices: number[] = [];

    const pushBox = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      w: number,
    ) => {
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) return;
      const nx = (-dz / len) * (w / 2);
      const nz = (dx / len) * (w / 2);
      const base = positions.length / 3;
      // 4 bottom then 4 top corners
      const corners: [number, number][] = [
        [ax + nx, az + nz],
        [bx + nx, bz + nz],
        [bx - nx, bz - nz],
        [ax - nx, az - nz],
      ];
      for (const [cx, cz] of corners) positions.push(cx, 0, cz);
      for (const [cx, cz] of corners) positions.push(cx, ROAD_H, cz);
      // top face
      indices.push(base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
      // sides
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        indices.push(base + i, base + j, base + 4 + j);
        indices.push(base + i, base + 4 + j, base + 4 + i);
      }
    };

    for (const r of roads) {
      for (let i = 0; i < r.path.length - 1; i++) {
        const a = r.path[i];
        const b = r.path[i + 1];
        pushBox(a.east, -a.north, b.east, -b.north, r.widthM);
      }
    }
    if (positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [roads]);

  // Dispose only the previous geometry (StrictMode-safe).
  const prevGeomRef = useRef<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    const prev = prevGeomRef.current;
    if (prev && prev !== geometry) prev.dispose();
    prevGeomRef.current = geometry;
  }, [geometry]);


  if (!visible || !geometry) return null;

  const anchorX = -origin.x * mPerPx;
  const anchorZ = -origin.y * mPerPx;
  const rotY = (-rotationDeg * Math.PI) / 180;

  return (
    <group rotation={[0, rotY, 0]}>
      <group position={[anchorX, groundY, anchorZ]}>
        <mesh geometry={geometry} receiveShadow>
          <meshStandardMaterial
            color="#4b5563"
            roughness={0.95}
            metalness={0}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}
