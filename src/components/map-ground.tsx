// Shared MapGround: renders an OSM-tile textured plane in the 3D scene,
// anchored so that sketch.geo(lat,lon) maps to world (0,0). Used by the
// Masterplan 3D preview and the 3D Model page so that both stay consistent
// with the sketch source in terms of coordinates and (optional) rotation.

import { useEffect, useState } from "react";
import * as THREE from "three";
import { drawOsmTiles, type Geo } from "@/lib/geo";

type Point = { x: number; y: number };

export function MapGround({
  geo,
  origin,
  mPerPx,
  bound,
  groundY = -0.03,
}: {
  geo: Geo;
  origin: Point;
  mPerPx: number;
  bound: number;
  groundY?: number;
}) {
  const [state, setState] = useState<
    { tex: THREE.CanvasTexture; w: number; h: number } | null
  >(null);

  useEffect(() => {
    const rangeM = Math.max(80, bound * 2.2);
    const Wm = rangeM * 2;
    const Hm = rangeM * 2;
    const wpm = Math.min(4, 2048 / Wm); // canvas px per meter
    const cw = Math.max(256, Math.round(Wm * wpm));
    const ch = Math.max(256, Math.round(Hm * wpm));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // origin (3D world 0,0) sits at meter offset (cxM,cyM) from geo (sketch(0,0)).
    const cxM = origin.x * mPerPx;
    const cyM = origin.y * mPerPx;
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
      ctx.save();
      // Warna map dikembalikan seperti sebelumnya (tanpa brightness), namun
      // saturasi & kontras ditingkatkan agar peta tampak jelas.
      (ctx as any).filter = "saturate(1.35) contrast(1.15)";
      drawOsmTiles(ctx, {
        lat: geo.lat,
        lon: geo.lon,
        worldPxPerMeter: wpm,
        bounds,
        opacity: 1,
        onTileLoad: () => {
          tex.needsUpdate = true;
        },
      });
      ctx.restore();
      tex.needsUpdate = true;
    };
    redraw();
    // Extra polls to catch async tile loads.
    const timers = [400, 900, 1800, 3200, 5500].map((ms) =>
      setTimeout(redraw, ms),
    );
    setState({ tex, w: Wm, h: Hm });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      tex.dispose();
    };
  }, [geo.lat, geo.lon, origin.x, origin.y, mPerPx, bound]);

  if (!state) return null;
  // sketch.geo.mapRotation ada di halaman sketsa untuk memutar peta terhadap
  // konten sketsa. Terapkan rotasi yang sama di 3D agar peletakan map
  // konsisten dengan sumbernya di sketsa.
  const rotDeg = Number((geo as any).mapRotation) || 0;
  const rotY = (-rotDeg * Math.PI) / 180;
  const opacity = Math.max(0, Math.min(1, geo.mapOpacity ?? 1));
  return (
    <group rotation={[0, rotY, 0]} position={[0, groundY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[state.w, state.h]} />
        <meshBasicMaterial map={state.tex} transparent opacity={opacity} />
      </mesh>
    </group>
  );
}
