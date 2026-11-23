// Slide Presentasi "Detail 3D": aksonometri satu level (lantai, dinding, kolom,
// pintu, jendela) dengan nomor ruang dan legenda di sisi kanan, layar penuh
// seperti Slide Detail. Gambar 3D dirender sekali ke PNG agar ikut terekspor
// PDF/PPTX dan tidak menahan konteks WebGL.
import { useEffect, useMemo, useState } from "react";
import { buildLevelDetail3d, detail3dLegendRooms, type Detail3dInput, type Detail3dModel } from "@/lib/level-detail-3d";
import { renderDetail3dAxo } from "@/components/detail3d-axo-renderer";
import { ARCHITECTURAL_LEGEND_FONTS, ARCHITECTURAL_LEGEND_HEADER_HEIGHT, ARCHITECTURAL_LEGEND_LINE_HEIGHT, architecturalLegendLayout } from "@/lib/architectural-legend";

type Label = { id: string; x: number; y: number };
type AxoRender = { dataUrl: string; labels: Label[] };

const INK = "#1d1d1b";
const cache = new Map<string, AxoRender>();

function renderAxonometric(model: Detail3dModel, labels: Array<{ id: string; center: { x: number; y: number } }>, width: number, height: number): AxoRender | null {
  const result = renderDetail3dAxo([{ model, base: 0 }], labels.map(({ id, center }) => ({ id, x: center.x, y: center.y, h: 0.02 })), width, height, { look: "bright" });
  return result ? { dataUrl: result.dataUrl, labels: result.points } : null;
}

export type LevelDetail3dSlideProps = {
  levelName: string;
  /** Teks elevasi, mis. "+3500". */
  elevation: string;
  input: Detail3dInput;
  slideWidth: number;
  slideHeight: number;
};

export function LevelDetail3dSlide({ levelName, elevation, input, slideWidth, slideHeight }: LevelDetail3dSlideProps) {
  const inputKey = useMemo(() => JSON.stringify(input), [input]);
  const model = useMemo(() => buildLevelDetail3d(input), [inputKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const rooms = useMemo(() => detail3dLegendRooms(input), [inputKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewW = Math.round(slideWidth * 0.72);
  const viewTop = Math.round(slideHeight * 0.16);
  const viewH = Math.round(slideHeight * 0.8);
  const legendBox = { width: slideWidth * 0.22, height: slideHeight * 0.92 };
  // Satu kolom selama teksnya sebesar dua kolom; dua kolom untuk daftar ruang yang panjang.
  const legend = useMemo(() => {
    const one = architecturalLegendLayout(rooms, legendBox, levelName, 1);
    const two = architecturalLegendLayout(rooms, legendBox, levelName, 2);
    return one.scale >= two.scale - 1e-4 ? one : two;
  }, [rooms, legendBox.width, legendBox.height, levelName]); // eslint-disable-line react-hooks/exhaustive-deps
  const cacheKey = `${inputKey}|${viewW}x${viewH}`;
  const [render, setRender] = useState<AxoRender | null>(() => cache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const hit = cache.get(cacheKey);
    if (hit) { setRender(hit); return; }
    setRender(null);
    setFailed(false);
    try {
      const result = renderAxonometric(model, rooms, viewW, viewH);
      if (!result) return;
      if (cache.size > 24) cache.delete(cache.keys().next().value as string);
      cache.set(cacheKey, result);
      setRender(result);
    } catch (error) {
      console.warn("Detail 3D slide render failed", error);
      setFailed(true);
    }
  }, [cacheKey, model, rooms, viewW, viewH]);
  const numberById = new Map(rooms.map((room, index) => [room.id, index + 1]));
  const fmt = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const empty = model.prisms.length === 0;
  return (
    <div data-detail3d-slide="true" style={{ position: "relative", width: "100%", height: "100%", background: "#ffffff", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "2%", top: viewTop, width: viewW, height: viewH }}>
        {render && <img src={render.dataUrl} alt={`Aksonometri 3D ${levelName}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />}
        {render && render.labels.map((label) => {
          const number = numberById.get(label.id);
          if (number === undefined) return null;
          return <div key={label.id} data-detail3d-room-number={number} style={{
            position: "absolute", left: label.x, top: label.y, transform: "translate(-50%, -50%)",
            minWidth: 30, height: 30, padding: "0 6px", borderRadius: 15, background: "#ffffff", border: `2px solid ${INK}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "Sora, sans-serif", fontSize: 15, fontWeight: 800, color: INK, boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
          }}>{number}</div>;
        })}
        {!render && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 40, textAlign: "center", fontFamily: "Manrope, sans-serif", fontSize: 18, color: "#555555" }}>
          {empty ? "Level ini belum punya ruang atau dinding bermaterial. Beri material dinding lewat Pick Material di halaman Sketsa." : failed ? "Aksonometri 3D tidak dapat ditampilkan di perangkat ini." : "Menyiapkan aksonometri 3D…"}
        </div>}
      </div>
      <div style={{ position: "absolute", left: 52, top: 44, background: "rgba(255,255,255,0.92)", borderLeft: "8px solid #e85d3a", padding: "16px 22px" }}>
        <div style={{ fontFamily: "Sora, sans-serif", fontSize: 28, fontWeight: 800 }}>DETAIL 3D</div>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, marginTop: 4 }}>{levelName} · Aksonometri</div>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, marginTop: 6, color: "#555555" }}>
          Tinggi dinding {fmt(model.wallHeight)} m · {model.counts.columns} kolom · {model.counts.doors} pintu · {model.counts.windows} jendela
        </div>
      </div>
      <aside aria-label="Legenda ruang Detail 3D" data-detail3d-legend="true" style={{ position: "absolute", right: "2%", top: "4%", width: legendBox.width, height: legendBox.height, overflow: "hidden" }}>
        <svg viewBox={`0 0 ${legendBox.width} ${legendBox.height}`} preserveAspectRatio="xMinYMin meet" style={{ display: "block", width: "100%", height: "100%" }} fill={INK} fontFamily="Manrope, sans-serif">
          <g transform={`scale(${legend.scale})`}>
            <text x="0" y="40" fontFamily="Sora, sans-serif" fontSize={legend.levelFont} fontWeight={700}>{levelName}</text>
            <text x="0" y="92" fontSize={ARCHITECTURAL_LEGEND_FONTS.elevation} fontWeight={600}>Elevasi {elevation} mm</text>
            {legend.columns.map((column, columnIndex) => <g key={`col-${columnIndex}`} transform={`translate(${columnIndex * (legend.colW + legend.columnGap)} ${ARCHITECTURAL_LEGEND_HEADER_HEIGHT})`}>
              {column.map(({ room, number, nameLines, top }) => <g key={room.id} data-detail3d-legend-room={number}>
                <text x="0" y={top} fontSize={ARCHITECTURAL_LEGEND_FONTS.name} fontWeight={600}><tspan fontSize={ARCHITECTURAL_LEGEND_FONTS.number} fontWeight={700}>{number}.{" "}</tspan>{nameLines.map((line, index) => <tspan key={index} x={index === 0 ? undefined : 0} dy={index === 0 ? 0 : ARCHITECTURAL_LEGEND_LINE_HEIGHT}>{line}</tspan>)}</text>
                <text x="0" y={top + (nameLines.length - 1) * ARCHITECTURAL_LEGEND_LINE_HEIGHT + 38} fontSize={ARCHITECTURAL_LEGEND_FONTS.area}>{fmt(room.areaM2)} m²</text>
              </g>)}
            </g>)}
          </g>
        </svg>
      </aside>
    </div>
  );
}
