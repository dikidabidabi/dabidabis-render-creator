type DetailLevel = { id: string; mdpl?: number };
type NumberedDetail = { levelId: string; number: number };

/** Change labels only, never area IDs, geometry or furniture. */
export function renumberDetailAreas<T extends NumberedDetail>(areas: readonly T[], levels: readonly DetailLevel[]): T[] {
  const levelOrder = new Map(levels.map((level, index) => ({ level, index }))
    .sort((a, b) => (Number(a.level.mdpl) || 0) - (Number(b.level.mdpl) || 0) || a.index - b.index)
    .map(({ level }, index) => [level.id, index]));
  return areas.map((area, index) => ({ area, index }))
    .sort((a, b) => (levelOrder.get(a.area.levelId) ?? levels.length) - (levelOrder.get(b.area.levelId) ?? levels.length)
      || (Number(a.area.number) || 0) - (Number(b.area.number) || 0) || a.index - b.index)
    .map(({ area }, index) => area.number === index + 1 ? area : { ...area, number: index + 1 });
}
