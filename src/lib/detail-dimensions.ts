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