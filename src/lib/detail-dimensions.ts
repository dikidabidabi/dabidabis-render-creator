export type DetailDimensionSettings = {
  dimensions?: boolean;
  gridDimensions?: boolean;
  roomDimensions?: boolean;
};

/** Missing sub-options retain the previous all-dimensions behavior. */
export function detailDimensionVisibility(area: DetailDimensionSettings) {
  const enabled = area.dimensions === true;
  return {
    grid: enabled && area.gridDimensions !== false,
    room: enabled && area.roomDimensions !== false,
  };
}
/**
 * Removes room-dimension break points until no two adjacent labels collide
 * (labels need at least one digit of clear gap). The shortest segment of a
 * colliding pair is merged into its neighbour; break points that lie on a grid
 * coordinate are kept whenever another break point can be removed instead.
 */
export function mergeCrowdedDimensions(
  coordinates: number[],
  gridCoordinates: number[],
  options: { pxPerM: number; fontSize: number; tolerance?: number; digitWidth?: number },
): number[] {
  const tolerance = options.tolerance ?? 0.5;
  const digit = options.digitWidth ?? options.fontSize * 0.6;
  const onGrid = (value: number) => gridCoordinates.some((g) => Math.abs(g - value) <= tolerance);
  const labelWidth = (a: number, b: number) =>
    String(Math.round((Math.abs(b - a) / options.pxPerM) * 1000)).length * digit;
  const points = [...coordinates];
  for (let guard = 0; guard < 500 && points.length > 2; guard += 1) {
    let worst = -1;
    let worstLength = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length - 2; i += 1) {
      const a = points[i], b = points[i + 1], c = points[i + 2];
      const centerGap = Math.abs((b + c) / 2 - (a + b) / 2);
      const needed = (labelWidth(a, b) + labelWidth(b, c)) / 2 + digit;
      if (centerGap + 1e-9 >= needed) continue;
      for (const s of [i, i + 1]) {
        const length = Math.abs(points[s + 1] - points[s]);
        if (length < worstLength) { worstLength = length; worst = s; }
      }
    }
    if (worst < 0) break;
    // Internal endpoints of the shortest segment that may be removed.
    const candidates = [worst, worst + 1].filter((index) => index > 0 && index < points.length - 1);
    const length = (index: number) => Math.abs(points[index + 1] - points[index]);
    const neighbourLength = (index: number) => (index === worst ? length(worst - 1) : length(worst + 1));
    candidates.sort((p, q) => Number(onGrid(points[p])) - Number(onGrid(points[q])) || neighbourLength(p) - neighbourLength(q));
    points.splice(candidates[0], 1);
  }
  return points;
}
