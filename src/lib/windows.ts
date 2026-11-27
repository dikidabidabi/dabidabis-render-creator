// Notasi jendela 2D untuk denah, disimpan di Sketch.windows.

export type WindowPoint = { x: number; y: number };

export type Window = {
  id: string;
  levelId?: string;
  a: WindowPoint;
  b: WindowPoint;
  /** Normal sisi orientasi jendela, tegak lurus dinding. */
  nx: number;
  ny: number;
  /** Jumlah daun/panel jendela. */
  leaves: number;
  /** Lebar total bukaan, 50–600 cm. */
  widthCm: number;
  kind?: "regular" | "dynamic";
  dividerSpacingCm?: number;
  endToleranceCm?: number;
  /** Tipe tinggi jendela; bawaan "standard". */
  heightType?: WindowHeightType;
};

/** full = lantai s/d puncak pintu (bata di atasnya); standard = ambang 0,8 m s/d puncak pintu;
 *  wall = lantai s/d puncak dinding tanpa bata di atasnya. */
export type WindowHeightType = "full" | "standard" | "wall" | "floor-to-ceiling";
export const WINDOW_HEIGHT_TYPES: { value: WindowHeightType; label: string; hint: string }[] = [
  { value: "full", label: "Full Window", hint: "Dari lantai sampai puncak pintu, dinding bata di atasnya" },
  { value: "standard", label: "Jendela Standar", hint: "Ambang 0,8 m sampai puncak pintu" },
  { value: "wall", label: "Window Wall", hint: "Dari lantai sampai puncak dinding, tanpa bata di atas" },
  { value: "floor-to-ceiling", label: "Floor to Ceiling", hint: "Dari lantai hingga bawah permukaan plafon ruang" },
];
export const WINDOW_STANDARD_SILL_M = 0.8;
export const WINDOW_DOOR_HEAD_M = 2.4;

export function windowHeightType(value: unknown): WindowHeightType {
  return value === "full" || value === "wall" || value === "floor-to-ceiling" ? value : "standard";
}

export function windowHeightLabel(value: unknown): string {
  const type = windowHeightType(value);
  return WINDOW_HEIGHT_TYPES.find((item) => item.value === type)?.label ?? "Jendela Standar";
}

/** Ambang & puncak jendela (m dari muka lantai) untuk tinggi dinding dan puncak pintu tertentu. */
export function windowVerticalRange(type: unknown, wallHeight: number, doorHead: number, ceilingHeight: number | null = 2.8): { sill: number; head: number } {
  const h = Math.max(0.1, wallHeight);
  const head = Math.min(doorHead, h);
  switch (windowHeightType(type)) {
    case "full": return { sill: 0, head };
    case "wall": return { sill: 0, head: h };
    case "floor-to-ceiling": return { sill: 0, head: Math.min(h, ceilingHeight ?? h) };
    default: return { sill: Math.min(WINDOW_STANDARD_SILL_M, head * 0.45), head };
  }
}

export const DYNAMIC_WINDOW_INITIAL_CM = 50;

/** Dynamic lengths are not subject to the regular window's 600 cm maximum. */
export function windowLengthCm(value: number, kind?: Window["kind"]): number {
  const length = Number.isFinite(value) ? value : DYNAMIC_WINDOW_INITIAL_CM;
  return Math.max(50, kind === "dynamic" ? length : Math.min(600, length));
}

/** Interior mullion centers, measured from the fixed A endpoint in real cm. */
export function windowDividerFractions(window: Pick<Window, "a" | "b" | "leaves" | "kind" | "dividerSpacingCm" | "endToleranceCm">, pxPerM: number): number[] {
  if (window.kind !== "dynamic") {
    const leaves = Math.max(1, Math.min(24, Math.round(window.leaves)));
    return Array.from({ length: leaves - 1 }, (_, i) => (i + 1) / leaves);
  }
  const lengthCm = Math.hypot(window.b.x - window.a.x, window.b.y - window.a.y) / pxPerM * 100;
  const spacing = window.dividerSpacingCm ?? 100;
  const tolerance = Math.max(0, window.endToleranceCm ?? 20);
  if (!Number.isFinite(lengthCm) || lengthCm <= 0 || !Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(tolerance)) return [];
  const fractions: number[] = [];
  for (let index = 1; index * spacing < lengthCm - tolerance - 1e-7; index++) {
    fractions.push(index * spacing / lengthCm);
  }
  return fractions;
}

/** Exact frame bounds shared by notation and architectural cuts. */
export function windowPlanGeometry(window: Pick<Window, "a" | "b">, pxPerM: number,
  walls: { a: WindowPoint; b: WindowPoint; thicknessMm: number }[] = []) {
  const length = Math.hypot(window.b.x - window.a.x, window.b.y - window.a.y);
  if (!Number.isFinite(length) || length < 1e-6 || !Number.isFinite(pxPerM) || pxPerM <= 0) return null;
  const dx = (window.b.x - window.a.x) / length, dy = (window.b.y - window.a.y) / length;
  const nx = -dy, ny = dx;
  const midpoint = { x: (window.a.x + window.b.x) / 2, y: (window.a.y + window.b.y) / 2 };
  let thicknessMm = 150, closestDistance = Infinity;
  for (const wall of walls) {
    const wx = wall.b.x - wall.a.x, wy = wall.b.y - wall.a.y;
    const wallLength = Math.hypot(wx, wy);
    if (!Number.isFinite(wallLength) || wallLength < 1e-6 || !Number.isFinite(wall.thicknessMm) || wall.thicknessMm <= 0) continue;
    if (Math.abs(wx / wallLength * dx + wy / wallLength * dy) < 0.94) continue;
    const t = Math.max(0, Math.min(1, ((midpoint.x - wall.a.x) * wx + (midpoint.y - wall.a.y) * wy) / wallLength ** 2));
    const distance = Math.hypot(midpoint.x - (wall.a.x + wx * t), midpoint.y - (wall.a.y + wy * t));
    if (distance < closestDistance) { closestDistance = distance; thicknessMm = wall.thicknessMm; }
  }
  const halfDepth = (closestDistance <= 0.35 * pxPerM ? thicknessMm : 150) / 1000 * pxPerM / 2;
  const footprint = [
    { x: window.a.x + nx * halfDepth, y: window.a.y + ny * halfDepth },
    { x: window.b.x + nx * halfDepth, y: window.b.y + ny * halfDepth },
    { x: window.b.x - nx * halfDepth, y: window.b.y - ny * halfDepth },
    { x: window.a.x - nx * halfDepth, y: window.a.y - ny * halfDepth },
  ];
  return { dx, dy, nx, ny, halfDepth, footprint };
}

/** Kusen ujung dan kusen pembatas sebagai poligon selebar kedalaman dinding,
 *  dipakai sebagai pelempar bayangan 45° pada slide arsitektural. */
export function windowFramePolygons(
  window: Pick<Window, "a" | "b" | "leaves" | "kind" | "dividerSpacingCm" | "endToleranceCm">,
  pxPerM: number,
  walls: { a: WindowPoint; b: WindowPoint; thicknessMm: number }[] = [],
): WindowPoint[][] {
  const geometry = windowPlanGeometry(window, pxPerM, walls);
  if (!geometry) return [];
  const { dx, dy, nx, ny, halfDepth } = geometry;
  const jambWidth = 0.05 * pxPerM;
  const jamb = (cx: number, cy: number, direction: number): WindowPoint[] => [
    { x: cx + nx * halfDepth, y: cy + ny * halfDepth },
    { x: cx - nx * halfDepth, y: cy - ny * halfDepth },
    { x: cx - nx * halfDepth + dx * jambWidth * direction, y: cy - ny * halfDepth + dy * jambWidth * direction },
    { x: cx + nx * halfDepth + dx * jambWidth * direction, y: cy + ny * halfDepth + dy * jambWidth * direction },
  ];
  const polygons = [jamb(window.a.x, window.a.y, 1), jamb(window.b.x, window.b.y, -1)];
  const halfJamb = jambWidth / 2;
  for (const t of windowDividerFractions(window, pxPerM)) {
    const cx = window.a.x + (window.b.x - window.a.x) * t;
    const cy = window.a.y + (window.b.y - window.a.y) * t;
    polygons.push([
      { x: cx - dx * halfJamb + nx * halfDepth, y: cy - dy * halfJamb + ny * halfDepth },
      { x: cx + dx * halfJamb + nx * halfDepth, y: cy + dy * halfJamb + ny * halfDepth },
      { x: cx + dx * halfJamb - nx * halfDepth, y: cy + dy * halfJamb - ny * halfDepth },
      { x: cx - dx * halfJamb - nx * halfDepth, y: cy - dy * halfJamb - ny * halfDepth },
    ]);
  }
  return polygons;
}

export function genWindowId(): string {
  return `W${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeWindow(raw: any): Window | null {
  if (!raw || typeof raw !== "object") return null;
  const ax = Number(raw.a?.x), ay = Number(raw.a?.y);
  const bx = Number(raw.b?.x), by = Number(raw.b?.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const dx = bx - ax, dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const rawNx = Number(raw.nx), rawNy = Number(raw.ny);
  const fallbackNx = -dy / length, fallbackNy = dx / length;
  const normalLength = Math.hypot(rawNx, rawNy);
  const nx = Number.isFinite(rawNx) && Number.isFinite(rawNy) && normalLength > 1e-6 ? rawNx / normalLength : fallbackNx;
  const ny = Number.isFinite(rawNx) && Number.isFinite(rawNy) && normalLength > 1e-6 ? rawNy / normalLength : fallbackNy;
  const widthRaw = Number(raw.widthCm);
  const leavesRaw = Number(raw.leaves);
  const kind = raw.kind === "dynamic" ? "dynamic" : "regular";
  const spacingRaw = Number(raw.dividerSpacingCm), toleranceRaw = Number(raw.endToleranceCm);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : genWindowId(),
    levelId: typeof raw.levelId === "string" ? raw.levelId : undefined,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    nx,
    ny,
    leaves: Number.isFinite(leavesRaw) ? Math.max(1, Math.min(24, Math.round(leavesRaw))) : 1,
    widthCm: windowLengthCm(Number.isFinite(widthRaw) ? widthRaw : kind === "dynamic" ? 50 : 120, kind),
    kind,
    heightType: windowHeightType(raw.heightType),
    ...(kind === "dynamic" ? {
      dividerSpacingCm: Number.isFinite(spacingRaw) ? Math.max(5, spacingRaw) : 100,
      endToleranceCm: Number.isFinite(toleranceRaw) ? Math.max(0, toleranceRaw) : 20,
    } : {}),
  };
}

export function normalizeWindows(raw: any): Window[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const window = normalizeWindow(item);
    return window ? [window] : [];
  });
}