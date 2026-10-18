/** Shared gradual 45-degree shadow profile, distances in sketch units. */
export function architecturalShadowProfile(pxPerM: number, distanceM: number) {
  const steps = Array.from({ length: 6 }, (_, i) => {
    const fraction = (6 - i) / 6;
    return {
      distance: distanceM * fraction * pxPerM,
      blur: pxPerM * distanceM / 1.5 * (0.015 + 0.18 * fraction ** 2),
    };
  });
  return { steps, opacity: 1 - Math.pow(1 - 0.456, 1 / steps.length) };
}