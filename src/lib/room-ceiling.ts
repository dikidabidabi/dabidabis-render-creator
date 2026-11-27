export type CeilingHeight = number | null;
export const DEFAULT_CEILING_HEIGHT_M = 2.8;
export const CEILING_STACK_M = 0.005 + 0.02 + 0.04;

/** Null explicitly removes the ceiling; missing/invalid legacy values use 2.8 m. */
export function normalizeCeilingHeight(value: unknown): CeilingHeight {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && value > 0.5 ? value : DEFAULT_CEILING_HEIGHT_M;
}

export function parseCeilingHeight(value: string): number | undefined {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0.5 ? n : undefined;
}

export function ceilingBottom(height: unknown, floorHeight: number, slabThickness = 0.15): number | null {
  const chosen = normalizeCeilingHeight(height);
  if (chosen === null) return null;
  const bottom = Math.min(chosen, floorHeight - slabThickness - CEILING_STACK_M);
  return bottom > 0.5 ? bottom : null;
}

/** Atomic same-column, same-level fill; other room fields remain untouched. */
export function fillRoomCeiling<T extends { id: string; levelId?: string; ceilingHeightM?: CeilingHeight }>(
  rooms: T[], levelId: string, visibleIds: string[], sourceIndex: number, targetIndex: number, value: CeilingHeight,
): T[] {
  const ids = new Set(visibleIds.slice(Math.min(sourceIndex, targetIndex), Math.max(sourceIndex, targetIndex) + 1));
  return rooms.map(room => room.levelId === levelId && ids.has(room.id) ? { ...room, ceilingHeightM: normalizeCeilingHeight(value) } : room);
}