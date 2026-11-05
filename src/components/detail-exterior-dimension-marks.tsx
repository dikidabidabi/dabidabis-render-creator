import { dimensionBasis, type ExteriorChain } from "@/lib/detail-exterior-dimensions";
export function DetailExteriorDimensionMarks({ chain, offset, fontSize, strokeWidth, pxPerM, grid = false }: {
  chain: ExteriorChain; offset: number; fontSize: number; strokeWidth: number; pxPerM: number; grid?: boolean;
}) {
  const rail = chain.face + chain.outward * offset;
  const tick = fontSize * 0.34;
  const coordinates = chain.coordinates;
  if (coordinates.length < 2) return null;
  return <g data-dimension-side={chain.side} data-dimension-angle={chain.angle} transform={`rotate(${chain.angle})`}
    fill="var(--detail-dimension-ink)" stroke="var(--detail-dimension-ink)" strokeWidth={strokeWidth} pointerEvents="none">
    {grid && <line data-exterior-grid-line="true" x1={coordinates[0]} y1={chain.face} x2={coordinates[coordinates.length - 1]} y2={chain.face} strokeDasharray={`${fontSize * 0.34} ${fontSize * 0.25}`} opacity={0.72} />}
    {coordinates.map((x, index) => <line key={`tick-${index}`} x1={x} y1={chain.face} x2={x} y2={rail + chain.outward * tick} />)}
    {coordinates.slice(0, -1).map((x, index) => {
      const end = coordinates[index + 1], center = (x + end) / 2;
      const y = rail + (chain.outward < 0 ? -fontSize * 0.35 : fontSize * 1.05);
      return <g key={index}>
        <line x1={x} y1={rail} x2={end} y2={rail} />
        <text x={center} y={y} textAnchor="middle" stroke="none" fontFamily="Manrope, sans-serif" fontSize={fontSize} fontWeight={600}>{Math.round((end - x) / pxPerM * 1000)}</text>
      </g>;
    })}
  </g>;
}
export function DetailExteriorGridBubbles({ chain, labels, offset, fontSize, strokeWidth }: {
  chain: ExteriorChain; labels: string[]; offset: number; fontSize: number; strokeWidth: number;
}) {
  if (!chain.coordinates.length) return null;
  const rail = chain.face + chain.outward * offset;
  const radius = fontSize * 0.8;
  const center = rail + chain.outward * (radius + fontSize * 0.3);
  return <g data-grid-bubbles="true" data-dimension-side={chain.side} transform={`rotate(${chain.angle})`}
    fill="var(--detail-dimension-ink)" stroke="var(--detail-dimension-ink)" strokeWidth={strokeWidth} pointerEvents="none">
    {chain.coordinates.map((x, index) => !labels[index] ? null : <g key={index}>
      <line x1={x} y1={chain.face} x2={x} y2={center - chain.outward * radius} strokeWidth={strokeWidth * 0.8} />
      <circle cx={x} cy={center} r={radius} fill="none" strokeWidth={strokeWidth * 4.2} />
      <text x={x} y={center} textAnchor="middle" dominantBaseline="central" stroke="none" fontFamily="Manrope, sans-serif" fontSize={fontSize} fontWeight={700}>{labels[index]}</text>
    </g>)}
  </g>;
}
export function DetailExteriorGridLines({ chains, strokeWidth, dash }: { chains: ExteriorChain[]; strokeWidth: number; dash: string }) {
  return <g data-detail-grid="true" stroke="var(--detail-dimension-ink)" strokeWidth={strokeWidth} strokeDasharray={dash} opacity={0.72} pointerEvents="none">
    {chains.map((chain, index) => {
      const { u, n } = dimensionBasis(chain.angle);
      const a = chain.coordinates[0], b = chain.coordinates[chain.coordinates.length - 1];
      return <line key={`${chain.gridIndex}-${chain.side}-${index}`} data-grid-side={chain.side} x1={u.x * a + n.x * chain.face} y1={u.y * a + n.y * chain.face} x2={u.x * b + n.x * chain.face} y2={u.y * b + n.y * chain.face} />;
    })}
  </g>;
}