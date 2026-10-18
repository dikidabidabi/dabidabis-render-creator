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
};

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
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : genWindowId(),
    levelId: typeof raw.levelId === "string" ? raw.levelId : undefined,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    nx,
    ny,
    leaves: Number.isFinite(leavesRaw) ? Math.max(1, Math.min(24, Math.round(leavesRaw))) : 1,
    widthCm: Number.isFinite(widthRaw) ? Math.max(50, Math.min(600, widthRaw)) : 120,
  };
}

export function normalizeWindows(raw: any): Window[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const window = normalizeWindow(item);
    return window ? [window] : [];
  });
}