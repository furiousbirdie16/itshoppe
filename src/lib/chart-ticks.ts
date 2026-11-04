/**
 * Round y-axis ticks for a chart.
 *
 * Left to itself the chart library picked steps like 65k / 130k / 195k, which
 * nobody reads at a glance. This picks a step of 1, 2, 2.5 or 5 times a power
 * of ten, starts at zero (or below it when the data goes negative) and puts
 * the top tick above the largest value so the line never touches the edge.
 */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0, 1];
  const raw = (hi - lo) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v < hi + step; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
    if (v >= hi) break;
  }
  // The top tick sits above the maximum, not on it.
  if (ticks[ticks.length - 1] <= hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
