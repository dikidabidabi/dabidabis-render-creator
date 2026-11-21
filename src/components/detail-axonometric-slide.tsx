// Slide Presentasi "Detail Aksonometri": Detail 3D semua lantai disusun
// bertumpuk (eksplode vertikal) dalam satu aksonometri. Lift dan tangga antar-
// lantai dihubungkan garis putus-putus. Gambar 3D dirender sekali ke PNG agar
// ikut terekspor PDF/PPTX; garis dan label digambar di atasnya sebagai SVG.
import { useEffect, useMemo, useState } from "react";
import { buildLevelDetail3d, detail3dLegendRooms, type Detail3dInput, type Detail3dModel } from "@/lib/level-detail-3d";
import { detailAxoGap, detailAxoLinks, detailAxoStack, type AxoLinkKind } from "@/lib/detail-axonometric";
import type { Stair } from "@/lib/stairs";
import { renderDetail3dAxo, type AxoPoint, type AxoRender } from "@/components/detail3d-axo-renderer";

const INK = "#1d1d1b";
const LINK_STYLE: Record<AxoLinkKind, { color: string; label: string }> = {
  lift: { color: "#e85d3a", label: "Lift" },
  tangga: { color: "#1f6fb2", label: "Tangga" },
};
const cache = new Map<string, AxoRender>();

export type DetailAxoLevel = { id: string; name: string; mdpl: number; typicalCount?: number; input: Detail3dInput };

export type DetailAxonometricSlideProps = {
  levels: DetailAxoLevel[];
  stairs: Stair[];
  slideWidth: number;
  slideHeight: number;
};

export function DetailAxonometricSlide({ levels, stairs, slideWidth, slideHeight }: DetailAxonometricSlideProps) {
  const sourceKey = useMemo(() => JSON.stringify({ levels, stairs }), [levels, stairs]);
  const data = useMemo(() => {
    const built = [...levels]
      .sort((a, b) => a.mdpl - b.mdpl)
      .map((level) => ({ level, model: buildLevelDetail3d(level.input) as Detail3dModel, rooms: detail3dLegendRooms(level.input) }))
      .filter((item) => item.model.prisms.length > 0);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { model } of built) {
      if (!model.bounds) continue;
      minX = Math.min(minX, model.bounds.minX); minY = Math.min(minY, model.bounds.minY);
      maxX = Math.max(maxX, model.bounds.maxX); maxY = Math.max(maxY, model.bounds.maxY);
    }
    const span = Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY) : 0;
    const stackLevels = built.map(({ level }) => ({ levelId: level.id, mdpl: level.mdpl, input: level.input }));
    const stack = detailAxoStack(stackLevels, detailAxoGap(span));
    const baseOf = new Map(stack.map((item) => [item.levelId, item.base]));
    const links = detailAxoLinks(stackLevels, stairs);
    const points: AxoPoint[] = [];
    links.forEach((link, index) => {
      points.push({ id: `l${index}a`, x: link.from.x, y: link.from.y, h: (baseOf.get(link.from.levelId) ?? 0) + 0.02 });
      points.push({ id: `l${index}b`, x: link.to.x, y: link.to.y, h: (baseOf.get(link.to.levelId) ?? 0) + 0.02 });
    });
    // Sudut denah tiap lantai untuk menaruh label lantai di sisi kirinya.
    for (const { level, model } of built) {
      const b = model.bounds;
      if (!b) continue;
      const h = baseOf.get(level.id) ?? 0;
      [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]].forEach(([x, y], corner) => points.push({ id: `c:${level.id}:${corner}`, x: x!, y: y!, h }));
    }
    return { built, parts: built.map(({ level, model }) => ({ model, base: baseOf.get(level.id) ?? 0 })), links, points };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const viewW = Math.round(slideWidth * 0.7);
  const viewTop = Math.round(slideHeight * 0.05);
  const viewH = Math.round(slideHeight * 0.9);
  const viewLeft = Math.round(slideWidth * 0.04);
  const cacheKey = `${sourceKey}|${viewW}x${viewH}`;
  const [render, setRender] = useState<AxoRender | null>(() => cache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const hit = cache.get(cacheKey);
    if (hit) { setRender(hit); return; }
    setRender(null);
    setFailed(false);
    try {
      const result = renderDetail3dAxo(data.parts, data.points, viewW, viewH);
      if (!result) return;
      if (cache.size > 8) cache.delete(cache.keys().next().value as string);
      cache.set(cacheKey, result);
      setRender(result);
    } catch (error) {
      console.warn("Detail Aksonometri render failed", error);
      setFailed(true);
    }
  }, [cacheKey, data, viewW, viewH]);

  const pointById = new Map((render?.points ?? []).map((p) => [p.id, p]));
  const fmt = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const levelLabels = data.built.map(({ level }) => {
    const corners = [0, 1, 2, 3].map((corner) => pointById.get(`c:${level.id}:${corner}`)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!corners.length) return null;
    const left = corners.reduce((best, p) => (p.x < best.x ? p : best));
    return { level, x: left.x, y: left.y };
  });
  const kinds = (Object.keys(LINK_STYLE) as AxoLinkKind[]).filter((kind) => data.links.some((link) => link.kind === kind));
  const legendW = slideWidth * 0.22;

  return (
    <div data-detail-axo-slide="true" style={{ position: "relative", width: "100%", height: "100%", background: "#ffffff", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: viewLeft, top: viewTop, width: viewW, height: viewH }}>
        {render && <img src={render.dataUrl} alt="Detail aksonometri semua lantai" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />}
        {render && <svg width={viewW} height={viewH} viewBox={`0 0 ${viewW} ${viewH}`} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden="true">
          {data.links.map((link, index) => {
            const a = pointById.get(`l${index}a`), b = pointById.get(`l${index}b`);
            if (!a || !b) return null;
            const color = LINK_STYLE[link.kind].color;
            return <g key={index} data-detail-axo-link={link.kind}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth={6} strokeLinecap="round" opacity={0.85} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={3} strokeDasharray="12 8" strokeLinecap="round" />
              <circle cx={a.x} cy={a.y} r={5} fill={color} stroke="#ffffff" strokeWidth={1.5} />
              <circle cx={b.x} cy={b.y} r={5} fill={color} stroke="#ffffff" strokeWidth={1.5} />
            </g>;
          })}
          {levelLabels.map((label) => label && <g key={label.level.id} data-detail-axo-level={label.level.id}>
            <line x1={label.x - 6} y1={label.y} x2={label.x - 46} y2={label.y} stroke={INK} strokeWidth={1.2} />
            <text x={label.x - 52} y={label.y + 5} textAnchor="end" fontFamily="Sora, sans-serif" fontSize={15} fontWeight={700} fill={INK}>{label.level.name}</text>
          </g>)}
        </svg>}
        {!render && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 40, textAlign: "center", fontFamily: "Manrope, sans-serif", fontSize: 18, color: "#555555" }}>
          {data.parts.length === 0 ? "Belum ada lantai dengan ruang atau dinding bermaterial. Beri material dinding lewat Pick Material di halaman Sketsa." : failed ? "Aksonometri 3D tidak dapat ditampilkan di perangkat ini." : "Menyiapkan detail aksonometri…"}
        </div>}
      </div>
      <div style={{ position: "absolute", left: 52, top: 44, background: "rgba(255,255,255,0.92)", borderLeft: "8px solid #e85d3a", padding: "16px 22px" }}>
        <div style={{ fontFamily: "Sora, sans-serif", fontSize: 28, fontWeight: 800 }}>DETAIL AKSONOMETRI</div>
        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 18, marginTop: 4 }}>Susunan Detail 3D semua lantai</div>
      </div>
      <aside aria-label="Legenda Detail Aksonometri" data-detail-axo-legend="true" style={{ position: "absolute", right: "2%", top: "5%", width: legendW, maxHeight: "90%", overflow: "hidden", fontFamily: "Manrope, sans-serif", color: INK }}>
        <div style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Lantai</div>
        {[...data.built].reverse().map(({ level, rooms }) => {
          const mm = Math.round(level.mdpl * 1000);
          const typical = Math.max(1, Math.round(Number(level.typicalCount) || 1));
          return <div key={level.id} style={{ borderTop: "1px solid #d8d4cc", padding: "7px 0" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{level.name}{typical > 1 ? ` · tipikal ×${typical}` : ""}</div>
            <div style={{ fontSize: 13, color: "#555555" }}>Elevasi {mm >= 0 ? "+" : ""}{mm} mm · {rooms.length} ruang · {fmt(rooms.reduce((s, r) => s + r.areaM2, 0))} m²</div>
          </div>;
        })}
        <div style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 800, margin: "18px 0 8px" }}>Sirkulasi Vertikal</div>
        {kinds.length === 0 && <div style={{ fontSize: 13, color: "#555555" }}>Belum ada lift atau tangga yang terhubung antar-lantai. Beri nama ruang "Lift" atau "Tangga", atau gambar tangga di Sketsa.</div>}
        {kinds.map((kind) => <div key={kind} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 600, padding: "4px 0" }}>
          <svg width="48" height="12" aria-hidden="true"><line x1="2" y1="6" x2="46" y2="6" stroke={LINK_STYLE[kind].color} strokeWidth={3} strokeDasharray="10 6" strokeLinecap="round" /></svg>
          {LINK_STYLE[kind].label} · {data.links.filter((link) => link.kind === kind).length} penghubung
        </div>)}
      </aside>
    </div>
  );
}
