// Slide Presentasi "Potongan 3D X-X": Detail 3D semua lantai pada elevasi
// sebenarnya dibelah garis potong, dilihat perspektif satu titik hilang.
// Gambar 3D dirender sekali ke PNG; bidang potong (poché) dan label lantai
// digambar sebagai SVG di atasnya agar tegas dan ikut terekspor.
import { useEffect, useMemo, useState } from "react";
import { buildLevelDetail3d, type Detail3dInput, type Detail3dKind } from "@/lib/level-detail-3d";
import {
  SECTION3D_PALETTE, clipPrismsToSection, mergeCutFaces, section3dBeams, section3dFloors, section3dFrame, sectionCutFaces,
  type ArchitecturalStyleId,
} from "@/lib/section-3d";
import type { StructuralGrid } from "@/lib/structural-grid";
import { renderSection3d, type Section3dRender } from "@/components/section3d-renderer";

const cache = new Map<string, Section3dRender>();
const STYLE_NAME: Record<ArchitecturalStyleId, string> = {
  tosca: "Tosca", brown: "Coklat", blue: "Biru", bata: "Bata", mono: "Monokrom", lightorange: "Oranye Terang", monobiru: "Mono Biru",
};
const SOLID: Detail3dKind[] = ["floor", "slab", "wall", "concrete", "concept", "column", "railing"];

export type Section3dLevel = { id: string; name: string; mdpl: number; typicalCount?: number; typicalHeight?: number; input: Detail3dInput };

export type Section3dSlideProps = {
  label: string;
  cut: { p1: { x: number; y: number }; p2: { x: number; y: number } };
  pxPerMeter: number;
  levels: Section3dLevel[];
  slabs: Array<{ levelId: string; outer: Array<{ x: number; y: number }>; holes?: Array<Array<{ x: number; y: number }>>; thicknessMm: number }>;
  grids: StructuralGrid[];
  style: ArchitecturalStyleId;
  slideWidth: number;
  slideHeight: number;
  /** Di dalam kotak Panel Arsitektur: tanpa judul, keterangan ringkas di bawah. */
  bare?: boolean;
};

type Section3dPalette = (typeof SECTION3D_PALETTE)[keyof typeof SECTION3D_PALETTE];
const SECTION3D_LEGEND = (palette: Section3dPalette) => [
  { fill: palette.cut, stroke: palette.edge, text: "Bidang potong (lantai, plat, balok, dinding, kolom)", short: "Bidang potong" },
  { fill: palette.wall, stroke: palette.edge, text: "Dinding tampak", short: "Dinding" },
  { fill: palette.floor, stroke: palette.edge, text: "Lantai", short: "Lantai" },
  { fill: "#bfe0ee", stroke: palette.edge, text: "Kaca / jendela", short: "Kaca" },
  { fill: "#a8743f", stroke: palette.edge, text: "Pintu", short: "Pintu" },
];

export function Section3dSlide({ label, cut, pxPerMeter, levels, slabs, grids, style, slideWidth, slideHeight, bare = false }: Section3dSlideProps) {
  const palette = SECTION3D_PALETTE[style];
  const sourceKey = useMemo(() => JSON.stringify({ cut, pxPerMeter, levels, slabs, grids, style }), [cut, pxPerMeter, levels, slabs, grids, style]);
  const data = useMemo(() => {
    const frame = section3dFrame(cut.p1, cut.p2, pxPerMeter);
    if (!frame) return null;
    const floors = section3dFloors(levels);
    const parts = levels.map((level) => {
      const model = buildLevelDetail3d(level.input);
      const beams = section3dBeams(slabs.filter((s) => s.levelId === level.id), grids, pxPerMeter);
      const prisms = clipPrismsToSection([...model.prisms, ...beams], frame);
      const bases = floors.filter((f) => f.levelId === level.id).map((f) => f.base);
      return { key: level.id, prisms, bases, faces: sectionCutFaces(prisms, frame) };
    }).filter((part) => part.prisms.length > 0 && part.bases.length > 0);
    // Siluet potong per salinan lantai: masif (lantai/plat/balok/dinding/kolom), kaca, kusen/daun.
    const groups = parts.flatMap((part) => part.bases.map((base) => ({
      key: `${part.key}@${base}`,
      solid: mergeCutFaces(part.faces.filter((f) => SOLID.includes(f.kind)).map((f) => ({ ...f, bottom: f.bottom + base, top: f.top + base }))),
      glass: mergeCutFaces(part.faces.filter((f) => f.kind === "glass").map((f) => ({ ...f, bottom: f.bottom + base, top: f.top + base }))),
      frame: mergeCutFaces(part.faces.filter((f) => f.kind === "frame" || f.kind === "door").map((f) => ({ ...f, bottom: f.bottom + base, top: f.top + base }))),
    })));
    const labelS = new Map<string, number>();
    for (const part of parts) {
      const s = part.faces.length ? Math.max(...part.faces.map((f) => f.s1)) : frame.length;
      labelS.set(part.key, s);
    }
    return { frame, floors: floors.filter((f) => labelS.has(f.levelId)), parts, groups, labelS };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const legendRowH = bare ? Math.max(34, Math.round(slideHeight * 0.07)) : 0;
  const viewLeft = Math.round(slideWidth * (bare ? 0.07 : 0.02));
  const viewTop = Math.round(slideHeight * (bare ? 0.02 : 0.13));
  const viewW = Math.round(slideWidth * (bare ? 0.91 : 0.76));
  const viewH = Math.round(bare ? slideHeight * 0.96 - legendRowH : slideHeight * 0.84);
  const cacheKey = `${sourceKey}|${viewW}x${viewH}`;
  const [render, setRender] = useState<Section3dRender | null>(() => cache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const hit = cache.get(cacheKey);
    if (hit) { setRender(hit); return; }
    setRender(null);
    setFailed(false);
    if (!data || !data.parts.length) return;
    try {
      const result = renderSection3d(data.parts, data.frame, palette, viewW, viewH);
      if (!result) return;
      if (cache.size > 8) cache.delete(cache.keys().next().value as string);
      cache.set(cacheKey, result);
      setRender(result);
    } catch (error) {
      console.warn("Potongan 3D render failed", error);
      setFailed(true);
    }
  }, [cacheKey, data, palette, viewW, viewH]);

  const toPath = (polygons: Array<Array<Array<{ s: number; h: number }>>>) => {
    if (!render || !data) return "";
    const { a, u } = data.frame;
    return polygons.map((polygon) => polygon.map((ring) => ring.map((p, i) => {
      const q = render.project(a.x + u.x * p.s, a.y + u.y * p.s, p.h);
      return `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    }).join(" ") + " Z").join(" ")).join(" ");
  };
  const elevation = (m: number) => { const mm = Math.round(m * 1000); return `${mm >= 0 ? "+" : ""}${mm.toLocaleString("id-ID")}`; };
  const floorLabels = render && data ? data.floors.map((floor) => {
    const s = (data.labelS.get(floor.levelId) ?? data.frame.length) + 0.6;
    const q = render.project(data.frame.a.x + data.frame.u.x * s, data.frame.a.y + data.frame.u.y * s, floor.base);
    return { floor, ...q };
  }) : [];

  return (
    <div data-architectural-style={style} data-section3d-slide="true" style={{ position: "relative", width: "100%", height: "100%", background: "var(--architectural-background-gradient)", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: viewLeft, top: viewTop, width: viewW, height: viewH }}>
        {render && <img src={render.dataUrl} alt={`Potongan 3D ${label}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />}
        {render && data && <svg width={viewW} height={viewH} viewBox={`0 0 ${viewW} ${viewH}`} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden="true">
          {data.groups.map((group) => <g key={group.key} data-section3d-cut={group.key}>
            <path d={toPath(group.glass)} fill="#bfe0ee" fillOpacity={0.85} stroke={palette.edge} strokeWidth={0.8} fillRule="evenodd" />
            <path d={toPath(group.frame)} fill={palette.edge} stroke={palette.edge} strokeWidth={0.6} fillRule="evenodd" />
            <path d={toPath(group.solid)} fill={palette.cut} stroke={palette.edge} strokeWidth={2.2} strokeLinejoin="miter" fillRule="evenodd" />
          </g>)}
          {floorLabels.map(({ floor, x, y }) => <g key={floor.key} data-section3d-level={floor.key}>
            <line x1={x} y1={y} x2={x - 34} y2={y} stroke={palette.edge} strokeWidth={1.2} />
            <path d={`M ${x - 34} ${y} l -6 -7 h 12 z`} fill={palette.edge} />
            <text x={x - 46} y={y - 6} textAnchor="end" fontFamily="Manrope, sans-serif" fontSize={13} fontWeight={700} fill="var(--architectural-caption-ink, #283b3a)">{floor.name}{floor.copies > 1 ? ` (${floor.copy + 1}/${floor.copies})` : ""}</text>
            <text x={x - 46} y={y + 9} textAnchor="end" fontFamily="Manrope, sans-serif" fontSize={11} fill="var(--architectural-caption-ink, #283b3a)">{elevation(floor.base)}</text>
          </g>)}
        </svg>}
        {!render && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 40, textAlign: "center", fontFamily: "Manrope, sans-serif", fontSize: 18, color: "var(--architectural-caption-ink, #555555)" }}>
          {!data || data.parts.length === 0 ? "Garis potong belum melewati lantai, dinding, atau ruang. Geser garis potong di halaman Sketsa." : failed ? "Potongan 3D tidak dapat ditampilkan di perangkat ini." : "Menyiapkan potongan 3D…"}
        </div>}
      </div>
      {bare ? (
        <div data-section3d-legend="compact" style={{ position: "absolute", left: slideWidth * 0.03, right: slideWidth * 0.03, bottom: 0, height: legendRowH, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 18px", fontFamily: "Manrope, sans-serif", fontSize: 13, color: "var(--architectural-caption-ink, #283b3a)" }}>
          {SECTION3D_LEGEND(palette).map((item) => <span key={item.text} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ width: 18, height: 11, background: item.fill, border: `1.5px solid ${item.stroke}` }} />{item.short}</span>)}
        </div>
      ) : <>
      <div style={{ position: "absolute", left: 52, top: 36, background: "var(--architectural-caption-surface)", color: "var(--architectural-caption-ink)", borderLeft: `8px solid ${palette.cut === "#ffffff" ? palette.edge : palette.cut}`, padding: "14px 22px" }}>
        <div style={{ fontFamily: "Sora, sans-serif", fontSize: 28, fontWeight: 800 }}>POTONGAN 3D {label}</div>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 16, marginTop: 4 }}>Perspektif potongan dari Detail 3D semua lantai</div>
      </div>
      <aside aria-label={`Legenda Potongan 3D ${label}`} data-section3d-legend="true" style={{ position: "absolute", right: "2%", top: "13%", width: slideWidth * 0.19, background: "var(--architectural-caption-surface)", color: "var(--architectural-caption-ink)", padding: "16px 18px", fontFamily: "Manrope, sans-serif" }}>
        <div style={{ fontFamily: "Sora, sans-serif", fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Keterangan</div>
        {SECTION3D_LEGEND(palette).map((item) => <div key={item.text} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, padding: "4px 0" }}>
          <span style={{ width: 22, height: 14, flex: "0 0 22px", background: item.fill, border: `1.5px solid ${item.stroke}` }} />{item.text}
        </div>)}
        <div style={{ borderTop: "1px solid currentColor", opacity: 0.35, margin: "12px 0" }} />
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Balok 40×70 cm pada as grid, balok tepi 20 cm.<br />
          Bayangan matahari 45°.<br />
          Style: {STYLE_NAME[style]} (mayoritas detail arsitektural).
        </div>
      </aside>
      </>}
    </div>
  );
}
