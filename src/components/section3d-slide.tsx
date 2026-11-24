// Slide Presentasi "Potongan 3D X-X": Detail 3D semua lantai pada elevasi
// sebenarnya dibelah garis potong, dilihat perspektif satu titik hilang.
// Gambar 3D dirender sekali ke PNG; bidang potong (poché) dan label lantai
// digambar sebagai SVG di atasnya agar tegas dan ikut terekspor.
import { useEffect, useMemo, useState } from "react";
import { buildLevelDetail3d, type Detail3dInput, type Detail3dKind, type Detail3dPrism } from "@/lib/level-detail-3d";
import {
  SECTION3D_PALETTE, clipPrismsToSection, mergeCutFaces, section3dBeams, section3dCeilings, section3dFloors, section3dFrame, section3dStairs, sectionCutFaces,
  type ArchitecturalStyleId, type Section3dStairSurface,
} from "@/lib/section-3d";
import type { StructuralGrid } from "@/lib/structural-grid";
import { renderSection3d, type Section3dRender } from "@/components/section3d-renderer";
import { sectionLegendMetrics } from "@/lib/section-room-legend";

const cache = new Map<string, Section3dRender>();
const STYLE_NAME: Record<ArchitecturalStyleId, string> = {
  tosca: "Tosca", brown: "Coklat", blue: "Biru", bata: "Bata", mono: "Monokrom", lightorange: "Oranye Terang", monobiru: "Mono Biru",
};
const SOLID: Detail3dKind[] = ["floor", "slab", "wall", "concrete", "concept", "column", "railing", "ceiling", "ceilingFrame", "stair"];

/** Tangga sketsa: bidang anak tangga & bordes denah (px) dari level asal ke level tujuan. */
export type Section3dStair = { id: string; levelId: string; toLevelId: string; surfaces: Section3dStairSurface[] };

export type Section3dLevel = { id: string; name: string; mdpl: number; typicalCount?: number; typicalHeight?: number; input: Detail3dInput };

/** Legenda ruang (ceklis "Legenda" pada garis potong): penomoran = Potongan Prinsip Skematik. */
export type Section3dRoomLegend = {
  rooms: Array<{ key: string; number: number; name: string; color: string; areaM2: number }>;
  /** Nomor pada bidang potong: s = jarak (m) dari ujung awal garis potong. */
  marks: Array<{ levelId: string; number: number; s: number }>;
};
const NUMBER_INK = "#1d1d1b";

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
  roomLegend?: Section3dRoomLegend;
  stairs?: Section3dStair[];
};

type Section3dPalette = (typeof SECTION3D_PALETTE)[keyof typeof SECTION3D_PALETTE];
const SECTION3D_LEGEND = (palette: Section3dPalette) => [
  { fill: palette.cut, stroke: palette.edge, text: "Bidang potong (lantai, plat, balok, plafon, dinding, kolom, tangga)", short: "Bidang potong" },
  { fill: palette.wall, stroke: palette.edge, text: "Dinding tampak", short: "Dinding" },
  { fill: "#f7f5f0", stroke: palette.edge, text: "Plafon. Ketinggian dan spesifikasi sesuai gambar", short: "Plafon" },
  { fill: palette.floor, stroke: palette.edge, text: "Lantai", short: "Lantai" },
  { fill: "#bfe0ee", stroke: palette.edge, text: "Kaca / jendela", short: "Kaca" },
  { fill: "#a8743f", stroke: palette.edge, text: "Pintu", short: "Pintu" },
];

export function Section3dSlide({ label, cut, pxPerMeter, levels, slabs, grids, style, slideWidth, slideHeight, bare = false, roomLegend, stairs = [] }: Section3dSlideProps) {
  const palette = SECTION3D_PALETTE[style];
  const sourceKey = useMemo(() => JSON.stringify({ cut, pxPerMeter, levels, slabs, grids, style, stairs }), [cut, pxPerMeter, levels, slabs, grids, style, stairs]);
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
    // Plafon hanya di Potongan 3D: per salinan lantai, ditutup plat lantai di atasnya
    // (salinan tipikal berikutnya atau level berikutnya).
    const ceilingParts = new Map<string, { key: string; prisms: Detail3dPrism[]; bases: number[]; faces: ReturnType<typeof sectionCutFaces> }>();
    floors.forEach((floor, index) => {
      const level = levels.find((lv) => lv.id === floor.levelId);
      const next = floors[index + 1];
      if (!level || !next || !parts.some((part) => part.key === level.id)) return;
      const groupKey = `${level.id}__plafon__${next.levelId}__${floor.height}`;
      const existing = ceilingParts.get(groupKey);
      if (existing) { existing.bases.push(floor.base); return; }
      const ceilings = section3dCeilings(level.input.rooms, slabs.filter((s) => s.levelId === next.levelId), pxPerMeter, floor.height);
      const prisms = clipPrismsToSection(ceilings, frame);
      if (!prisms.length) return;
      ceilingParts.set(groupKey, { key: groupKey, prisms, bases: [floor.base], faces: sectionCutFaces(prisms, frame) });
    });
    // Tangga: masif dari level asal ke level tujuan, tiap salinan lantai tipikal.
    const stairParts = new Map<string, { key: string; prisms: Detail3dPrism[]; bases: number[]; faces: ReturnType<typeof sectionCutFaces> }>();
    for (const stair of stairs) {
      const target = floors.find((f) => f.levelId === stair.toLevelId);
      for (const floor of floors.filter((f) => f.levelId === stair.levelId)) {
        const heightM = floor.copies > 1 ? floor.height : target ? target.base - floor.base : 0;
        if (!(heightM > 0.1)) continue;
        const groupKey = `${stair.id}__tangga__${heightM.toFixed(4)}`;
        const existing = stairParts.get(groupKey);
        if (existing) { existing.bases.push(floor.base); continue; }
        const prisms = clipPrismsToSection(section3dStairs(stair.surfaces, heightM, pxPerMeter), frame);
        if (!prisms.length) continue;
        stairParts.set(groupKey, { key: groupKey, prisms, bases: [floor.base], faces: sectionCutFaces(prisms, frame) });
      }
    }
    const allParts = [...parts, ...ceilingParts.values(), ...stairParts.values()];
    // Siluet potong: kaca & kusen/daun per salinan lantai; masif (lantai/plat/balok/dinding/
    // kolom/plafon/tangga) digabung satu siluet agar tangga menyatu dengan plat seperti poché.
    type Face = ReturnType<typeof sectionCutFaces>[number];
    const lift = (f: Face, base: number) => ({ ...f, bottom: f.bottom + base, top: f.top + base,
      ...(f.b0 !== undefined ? { b0: f.b0 + base } : {}), ...(f.b1 !== undefined ? { b1: f.b1 + base } : {}) });
    const groups = allParts.flatMap((part) => part.bases.map((base) => ({
      key: `${part.key}@${base}`,
      glass: mergeCutFaces(part.faces.filter((f) => f.kind === "glass").map((f) => lift(f, base))),
      frame: mergeCutFaces(part.faces.filter((f) => f.kind === "frame" || f.kind === "door").map((f) => lift(f, base))),
    })));
    const solid = mergeCutFaces(allParts.flatMap((part) => part.bases.flatMap((base) => part.faces.filter((f) => SOLID.includes(f.kind)).map((f) => lift(f, base)))));
    const labelS = new Map<string, number>();
    for (const part of parts) {
      const s = part.faces.length ? Math.max(...part.faces.map((f) => f.s1)) : frame.length;
      labelS.set(part.key, s);
    }
    return { frame, floors: floors.filter((f) => labelS.has(f.levelId)), parts: allParts, groups, solid, labelS };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const legendRooms = roomLegend?.rooms ?? [];
  const roomMetrics = sectionLegendMetrics(legendRooms.length);
  const asideW = roomLegend ? Math.max(slideWidth * 0.19, roomMetrics.width + 36) : slideWidth * 0.19;
  const compactRoomRows = roomLegend && legendRooms.length ? Math.ceil(legendRooms.length / Math.max(1, Math.floor((slideWidth * 0.94) / 170))) : 0;
  const legendRowH = bare ? Math.min(Math.round(slideHeight * 0.35), Math.max(34, Math.round(slideHeight * 0.07)) + compactRoomRows * 18) : 0;
  const viewLeft = Math.round(slideWidth * (bare ? 0.07 : 0.02));
  const viewTop = Math.round(slideHeight * (bare ? 0.02 : 0.13));
  const viewW = Math.round(bare ? slideWidth * 0.91 : roomLegend ? slideWidth * 0.95 - asideW : slideWidth * 0.76);
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
  const fmtArea = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const elevation = (m: number) => { const mm = Math.round(m * 1000); return `${mm >= 0 ? "+" : ""}${mm.toLocaleString("id-ID")}`; };
  const floorLabels = render && data ? data.floors.map((floor) => {
    const s = (data.labelS.get(floor.levelId) ?? data.frame.length) + 0.6;
    const q = render.project(data.frame.a.x + data.frame.u.x * s, data.frame.a.y + data.frame.u.y * s, floor.base);
    return { floor, ...q };
  }) : [];

  // Nomor ruang di bidang potong, setengah tinggi lantai (maks. 1,5 m) tiap salinan lantai.
  const roomMarks = render && data && roomLegend ? roomLegend.marks.flatMap((mark) => data.floors
    .filter((floor) => floor.levelId === mark.levelId)
    .map((floor) => {
      const q = render.project(data.frame.a.x + data.frame.u.x * mark.s, data.frame.a.y + data.frame.u.y * mark.s, floor.base + Math.min(1.5, floor.height / 2));
      return { key: `${mark.levelId}-${mark.number}-${mark.s.toFixed(3)}-${floor.key}`, number: mark.number, ...q };
    })) : [];

  return (
    <div data-architectural-style={style} data-section3d-slide="true" style={{ position: "relative", width: "100%", height: "100%", background: "var(--architectural-background-gradient)", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: viewLeft, top: viewTop, width: viewW, height: viewH }}>
        {render && <img src={render.dataUrl} alt={`Potongan 3D ${label}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />}
        {render && data && <svg width={viewW} height={viewH} viewBox={`0 0 ${viewW} ${viewH}`} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden="true">
          {data.groups.map((group) => <g key={group.key} data-section3d-cut={group.key}>
            <path d={toPath(group.glass)} fill="#bfe0ee" fillOpacity={0.85} stroke={palette.edge} strokeWidth={0.8} fillRule="evenodd" />
            <path d={toPath(group.frame)} fill={palette.edge} stroke={palette.edge} strokeWidth={0.6} fillRule="evenodd" />
          </g>)}
          <path data-section3d-cut="solid" d={toPath(data.solid)} fill={palette.cut} stroke={palette.cut === "#ffffff" ? "#1a1a1a" : "none"} strokeWidth={palette.cut === "#ffffff" ? 1 : 0} strokeLinejoin="miter" fillRule="evenodd" />
          {floorLabels.map(({ floor, x, y }) => <g key={floor.key} data-section3d-level={floor.key}>
            <line x1={x} y1={y} x2={x - 34} y2={y} stroke={palette.edge} strokeWidth={1.2} />
            <path d={`M ${x - 34} ${y} l -6 -7 h 12 z`} fill={palette.edge} />
            <text x={x - 46} y={y - 6} textAnchor="end" fontFamily="Manrope, sans-serif" fontSize={13} fontWeight={700} fill="var(--architectural-caption-ink, #283b3a)">{floor.name}{floor.copies > 1 ? ` (${floor.copy + 1}/${floor.copies})` : ""}</text>
            <text x={x - 46} y={y + 9} textAnchor="end" fontFamily="Manrope, sans-serif" fontSize={11} fill="var(--architectural-caption-ink, #283b3a)">{elevation(floor.base)}</text>
          </g>)}
        </svg>}
        {roomMarks.map((mark) => <div key={mark.key} data-section3d-room-number={mark.number} style={{
          position: "absolute", left: mark.x, top: mark.y, transform: "translate(-50%, -50%)",
          minWidth: 15, height: 15, padding: "0 3px", borderRadius: 7.5, background: "#ffffff", border: `1px solid ${NUMBER_INK}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "Sora, sans-serif", fontSize: 7.5, fontWeight: 800, color: NUMBER_INK, boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
        }}>{mark.number}</div>)}
        {!render && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 40, textAlign: "center", fontFamily: "Manrope, sans-serif", fontSize: 18, color: "var(--architectural-caption-ink, #555555)" }}>
          {!data || data.parts.length === 0 ? "Garis potong belum melewati lantai, dinding, atau ruang. Geser garis potong di halaman Sketsa." : failed ? "Potongan 3D tidak dapat ditampilkan di perangkat ini." : "Menyiapkan potongan 3D…"}
        </div>}
      </div>
      {bare ? (
        <div data-section3d-legend="compact" style={{ position: "absolute", left: slideWidth * 0.03, right: slideWidth * 0.03, bottom: 0, height: legendRowH, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 18px", fontFamily: "Manrope, sans-serif", fontSize: 13, color: "var(--architectural-caption-ink, #283b3a)" }}>
          {SECTION3D_LEGEND(palette).map((item) => <span key={item.text} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ width: 18, height: 11, background: item.fill, border: `1.5px solid ${item.stroke}` }} />{item.short}</span>)}
          {legendRooms.map((r) => <span key={r.key} data-section3d-legend-room={r.number} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <b style={{ color: r.color, fontVariantNumeric: "tabular-nums" }}>{r.number}.</b>{r.name} : {fmtArea(r.areaM2)} m²
          </span>)}
        </div>
      ) : <>
      <div style={{ position: "absolute", left: 52, top: 36, background: "var(--architectural-caption-surface)", color: "var(--architectural-caption-ink)", borderLeft: `8px solid ${palette.cut === "#ffffff" ? palette.edge : palette.cut}`, padding: "14px 22px" }}>
        <div style={{ fontFamily: "Sora, sans-serif", fontSize: 28, fontWeight: 800 }}>POTONGAN 3D {label}</div>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 16, marginTop: 4 }}>Perspektif potongan dari Detail 3D semua lantai</div>
      </div>
      <aside aria-label={`Legenda Potongan 3D ${label}`} data-section3d-legend="true" style={{ position: "absolute", right: "2%", top: "13%", width: asideW, maxHeight: slideHeight * 0.84, display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box", background: "var(--architectural-caption-surface)", color: "var(--architectural-caption-ink)", padding: "16px 18px", fontFamily: "Manrope, sans-serif" }}>
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
        {roomLegend && <div data-section3d-room-legend="true" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto", marginTop: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.7, fontWeight: 600, marginBottom: 10, flexShrink: 0 }}>Legenda Ruang</div>
          {legendRooms.length === 0 ? (
            <div style={{ fontSize: 13, opacity: 0.6 }}>Tidak ada ruang teriris pada garis potong ini.</div>
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, columnCount: roomMetrics.cols, columnGap: 10, fontSize: roomMetrics.fontSize, lineHeight: 1.3, flex: "1 1 auto", minHeight: 0 }}>
              {legendRooms.map((r) => <li key={r.key} data-section3d-legend-room={r.number} style={{ display: "flex", gap: 5, breakInside: "avoid", marginBottom: roomMetrics.marginBottom }}>
                <span style={{ flexShrink: 0, minWidth: 16, fontWeight: 700, color: r.color, fontVariantNumeric: "tabular-nums" }}>{r.number}.</span>
                <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{r.name} : {fmtArea(r.areaM2)} m²</span>
              </li>)}
            </ol>
          )}
        </div>}
      </aside>
      </>}
    </div>
  );
}
