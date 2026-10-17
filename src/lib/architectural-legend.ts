export function architecturalLegendEnabled(area: { showArchitectural?: boolean; showArchitecturalLegend?: boolean }): boolean {
  return area.showArchitectural === true && area.showArchitecturalLegend === true;
}

/** Share one sequence between plan labels and legend without mutating rooms. */
export function architecturalLegendRooms<T extends { id: string; name: string; areaM2: number }>(rooms: readonly T[]) {
  return rooms.map((room, index) => ({ room, number: index + 1 }));
}
