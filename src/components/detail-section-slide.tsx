import { useId, useMemo } from "react";
import { buildDetailSection, detailSectionHatch, detailSectionElevation, formatSectionElevation, type DetailSectionCut, type DetailSectionSketch } from "@/lib/detail-section";

export function DetailSectionSlide({ sketch, cut, ppm, width, height }: { sketch: DetailSectionSketch; cut: DetailSectionCut; ppm: number; width: number; height: number }) {
  const id = useId().replace(/:/g, "");
  const data = useMemo(() => buildDetailSection(sketch, cut, ppm), [sketch, cut, ppm]);
  if (!data) return null;
  const w = width, h = height;
  const scale = Math.min((w - 190) / Math.max(0.1, data.maxS - data.minS), (h - 100) / Math.max(0.1, data.maxH - data.minH));
  const left = 55 + ((w - 190) - (data.maxS - data.minS) * scale) / 2;
  const top = 20 + ((h - 100) - (data.maxH - data.minH) * scale) / 2;
  const span = Math.max(data.maxS - data.minS, data.maxH - data.minH) * scale;
  const font = span * 0.012, dimStroke = span * 0.0001625;
  const x = (s: number) => left + (data.maxS - s) * scale;
  const y = (v: number) => top + (data.maxH - v) * scale;
  const path = (polygons: Array<Array<Array<{ s: number; h: number }>>>) => polygons.map(poly => poly.map(ring => ring.map((p, i) => `${i ? "L" : "M"}${x(p.s)} ${y(p.h)}`).join(" ") + "Z").join(" ")).join(" ");
  const mm = (v: number) => Math.round(v * 1000).toLocaleString("id-ID");
  const verticalDimension = (at: number, bottom: number, top: number, label: string) => <g stroke="var(--detail-dimension-ink)" strokeWidth={dimStroke}>
    <path d={`M${at} ${y(bottom)}V${y(top)} M${at - 4} ${y(bottom) + 4}l8 -8 M${at - 4} ${y(top) + 4}l8 -8`} fill="none" />
    <text x={at - 6} y={(y(bottom) + y(top)) / 2} transform={`rotate(-90 ${at - 6} ${(y(bottom) + y(top)) / 2})`} textAnchor="middle" stroke="none" fontSize={font} fontWeight={600}>{label}</text>
  </g>;
  const gridY = y(data.minH) + 28;
  const elevationMarker = (s: number, level: number, label: string, direction: "up" | "down", available: number) => {
    const size = Math.min(font, Math.max(1, available / 9));
    const boxW = size * 8.5, boxH = size * 1.6;
    const anchorX = x(s) - boxW / 2 - size, anchorY = y(level);
    const boxX = anchorX + size, boxY = direction === "up" ? anchorY + size * 2.7 : anchorY - size * 4.3;
    const edgeY = direction === "up" ? boxY : boxY + boxH;
    return <g stroke="var(--detail-dimension-ink)" strokeWidth={dimStroke} fill="var(--detail-dimension-ink)">
      <path d={`M${anchorX} ${anchorY}l${-size * 0.65} ${direction === "up" ? size * 0.35 : -size * 0.35}h${size * 1.3}Z`} />
      <path d={`M${anchorX} ${anchorY}V${edgeY}H${boxX}`} fill="none" />
      <rect x={boxX} y={boxY} width={boxW} height={boxH} fill="var(--detail-opening-fill)" />
      <text x={boxX + boxW / 2} y={boxY + boxH / 2} dominantBaseline="central" textAnchor="middle" stroke="none" fontSize={size}>{label}</text>
    </g>;
  };
  return <svg data-detail-section="true" aria-label={`Detail potongan ${cut.label ?? ""}`} width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className="detail-section-drawing">
    <defs>
      <pattern id={`${id}-wall`} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M1 0V7 M3 0V7" stroke="var(--detail-opening-ink)" strokeWidth={0.3} /></pattern>
      <pattern id={`${id}-concrete`} width={7} height={7} patternUnits="userSpaceOnUse"><rect width={7} height={7} fill="var(--detail-concrete-fill)" /><g fill="var(--detail-opening-ink)" opacity={0.28}><circle cx={1.6} cy={1.7} r={0.3} /><circle cx={5.2} cy={5.1} r={0.24} /><circle cx={5.5} cy={1.5} r={0.16} /><circle cx={1.8} cy={5.4} r={0.16} /></g></pattern>
    </defs>
    <rect width={w} height={h} fill="var(--detail-opening-fill)" />
    <g data-section-visible-projection="true" stroke="var(--detail-opening-ink)" strokeWidth={span * 0.00035} fill="none">{data.visibleLines.map((line, i) => <line key={i} x1={x(line.a.s)} y1={y(line.a.h)} x2={x(line.b.s)} y2={y(line.b.h)} />)}</g>
    {data.groups.map(group => {
      const hatch = detailSectionHatch(group.kind);
      const fill = hatch ? `url(#${id}-${hatch})` : group.kind === "cladingFrame" || group.kind === "ceilingFrame" ? "var(--detail-opening-ink)" : "var(--detail-opening-fill)";
      return <path key={group.kind} data-section-material={group.kind} d={path(group.polygons)} fill={fill} fillRule="evenodd" stroke="var(--detail-opening-ink)" strokeWidth={span * (hatch ? 0.001 : 0.0005)} />;
    })}
    <g stroke="var(--architectural-grid-ink)" fill="var(--detail-opening-fill)" strokeWidth={Math.max(span * 0.00028, 0.12)}>{data.grids.map(hit => <g key={hit.key}>
      <line x1={x(hit.s)} x2={x(hit.s)} y1={y(data.maxH) - 10} y2={gridY + 18} strokeDasharray="7 4" />
      <circle cx={x(hit.s)} cy={gridY + 18} r={font * 0.8} /><text x={x(hit.s)} y={gridY + 18} textAnchor="middle" dominantBaseline="central" fontSize={font} fill="var(--detail-opening-ink)" stroke="none">{hit.label}</text>
    </g>)}</g>
    <g stroke="var(--detail-dimension-ink)" strokeWidth={dimStroke} fill="var(--detail-dimension-ink)">{data.grids.slice(1).map((hit, i) => {
      const prev = data.grids[i]; if (!prev) return null;
      const xa = x(prev.s), xb = x(hit.s);
      return <g key={hit.key}><path d={`M${xa} ${gridY}H${xb} M${xa - 4} ${gridY + 4}l8 -8 M${xb - 4} ${gridY + 4}l8 -8`} fill="none" /><text x={(xa + xb) / 2} y={gridY - 5} stroke="none" fontSize={font} fontWeight={600} textAnchor="middle">{mm(hit.s - prev.s)}</text></g>;
    })}</g>
    {data.floors.map((floor, i) => <g key={floor.key} fill="var(--detail-dimension-ink)">
      <text x={x(data.minS) + 8} y={y(floor.base) - 5} fontSize={font}>{floor.name}{floor.copies > 1 ? ` (${floor.copy + 1})` : ""}</text><text x={x(data.minS) + 8} y={y(floor.base) + font} fontSize={font}>FFL {formatSectionElevation(detailSectionElevation(floor.base, data.datum))}</text>
      {data.floors[i + 1] && verticalDimension(x(data.maxS) - 35, floor.base, data.floors[i + 1]?.base ?? floor.base, mm((data.floors[i + 1]?.base ?? floor.base) - floor.base))}
    </g>)}
    {data.rooms.map(room => {
      const available = (room.s1 - room.s0) * scale * 0.8;
      const size = Math.min(font, available / Math.max(1, room.name.length * 0.62));
      const s = (room.s0 + room.s1) / 2;
      return <g key={room.key} data-section-room={room.name}>
        <text x={x(s)} y={y(room.base) - Math.min(font, available / 9) * 5.3} textAnchor="middle" fontSize={size} fontWeight={600} fill="var(--detail-opening-ink)">{room.name}</text>
        {elevationMarker(s, room.base, `FFL ${formatSectionElevation(room.ffl)}`, "down", available)}
      </g>;
    })}
    {data.ceilingDimensions.map((dim, i) => {
      const room = data.rooms.find(room => room.base === dim.base && dim.s >= room.s0 && dim.s <= room.s1);
      const available = room ? (room.s1 - room.s0) * scale * 0.8 : font * 10;
      return <g key={i} data-ceiling-dimension="true">{elevationMarker(dim.s, dim.head, `AFF ${formatSectionElevation(detailSectionElevation(dim.head, dim.base))}`, "up", available)}</g>;
    })}
  </svg>;
}