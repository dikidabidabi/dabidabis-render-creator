// Tampak (elevasi) dari proyeksi model Detail 3D semua lantai: kamera
// ortografik datar dari salah satu arah mata angin, lantai tipikal diulang
// sesuai jumlahnya. Dirender sekali ke PNG agar ikut terekspor PDF/PPTX/PSD.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { buildLevelDetail3d, type Detail3dInput, type Detail3dModel } from "@/lib/level-detail-3d";
import { renderDetail3dAxo, type AxoRender } from "@/components/detail3d-axo-renderer";
import { TAMPAK_LABEL, type TampakDir } from "@/lib/competition-panels";

export type TampakLevel = { id: string; name: string; mdpl: number; typicalCount?: number; input: Detail3dInput };

const cache = new Map<string, AxoRender>();

/** Arah kamera (dari bangunan ke pengamat) untuk tampak, memperhitungkan rotasi utara. */
export function tampakViewDir(dir: TampakDir, northRotationDeg: number): THREE.Vector3 {
  const r = ((Number(northRotationDeg) || 0) * Math.PI) / 180;
  // Utara di denah (x kanan, y bawah) = (sin r, −cos r); sumbu z Three.js = y denah.
  const north = new THREE.Vector3(Math.sin(r), 0, -Math.cos(r));
  const east = new THREE.Vector3(Math.cos(r), 0, Math.sin(r));
  if (dir === "utara") return north;
  if (dir === "selatan") return north.negate();
  if (dir === "timur") return east;
  return east.negate();
}

export function TampakSlide({ levels, dir, northRotation, slideWidth, slideHeight }: {
  levels: TampakLevel[]; dir: TampakDir; northRotation: number; slideWidth: number; slideHeight: number;
}) {
  const sourceKey = useMemo(() => JSON.stringify({ levels, dir, northRotation }), [levels, dir, northRotation]);
  const parts = useMemo(() => {
    const out: Array<{ model: Detail3dModel; base: number }> = [];
    let base = 0;
    for (const level of [...levels].sort((a, b) => a.mdpl - b.mdpl)) {
      const model = buildLevelDetail3d(level.input) as Detail3dModel;
      const k = Math.max(1, Math.round(Number(level.typicalCount) || 1));
      for (let i = 0; i < k; i++) {
        if (model.prisms.length > 0) out.push({ model, base });
        base += Math.max(0.1, Number(level.input.wallHeight) || 0);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);
  const viewW = Math.round(slideWidth * 0.9);
  const viewH = Math.round(slideHeight * 0.74);
  const cacheKey = `${sourceKey}|${viewW}x${viewH}`;
  const [render, setRender] = useState<AxoRender | null>(() => cache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const hit = cache.get(cacheKey);
    if (hit) { setRender(hit); return; }
    setRender(null);
    setFailed(false);
    try {
      const b = parts[0]?.model.bounds;
      const ground = b ? [{ id: "ground", x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, h: 0 }] : [];
      const result = renderDetail3dAxo(parts, ground, viewW, viewH, { viewDir: tampakViewDir(dir, northRotation) });
      if (!result) return;
      if (cache.size > 12) cache.delete(cache.keys().next().value as string);
      cache.set(cacheKey, result);
      setRender(result);
    } catch (error) {
      console.warn("Tampak render failed", error);
      setFailed(true);
    }
  }, [cacheKey, parts, viewW, viewH, dir, northRotation]);

  const floors = parts.length;
  return (
    <div data-tampak-slide={dir} style={{ position: "relative", width: "100%", height: "100%", background: "#ffffff", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 52, top: 44, borderLeft: "8px solid #e85d3a", padding: "10px 20px" }}>
        <div style={{ fontFamily: "Sora, sans-serif", fontSize: 30, fontWeight: 800, color: "#1d1d1b" }}>{TAMPAK_LABEL[dir].toUpperCase()}</div>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 17, color: "#444444", marginTop: 4 }}>Proyeksi model 3D · {floors} lantai</div>
      </div>
      <div style={{ position: "absolute", left: (slideWidth - viewW) / 2, top: slideHeight * 0.2, width: viewW, height: viewH }}>
        {render
          ? <img src={render.dataUrl} alt={TAMPAK_LABEL[dir]} style={{ width: "100%", height: "100%", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontFamily: "Manrope, sans-serif", fontSize: 18, color: "#555555", textAlign: "center", padding: 40 }}>
              {parts.length === 0 ? "Belum ada dinding bermaterial. Beri material dinding lewat Pick Material di Sketsa." : failed ? "Tampak 3D tidak dapat ditampilkan di perangkat ini." : "Menyiapkan tampak…"}
            </div>}
      </div>
      {render?.points[0] && <div style={{ position: "absolute", left: slideWidth * 0.04, right: slideWidth * 0.04, top: slideHeight * 0.2 + render.points[0].y - 1, borderTop: "3px solid #1d1d1b" }} />}
    </div>
  );
}
