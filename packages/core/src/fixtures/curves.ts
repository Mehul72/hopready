// A piecewise-linear curve over minutes of the day, used for demo traffic and car park filling.
// Points are [minute, value] in increasing minute order, starting at 0 and ending at 1440.
export type DayCurve = readonly (readonly [minute: number, value: number])[];

export function valueAt(curve: DayCurve, minuteOfDay: number): number {
  const first = curve[0];
  if (!first) throw new Error('A day curve needs at least one point');
  if (minuteOfDay <= first[0]) return first[1];

  for (let index = 1; index < curve.length; index++) {
    const [endMinute, endValue] = curve[index]!;
    if (minuteOfDay > endMinute) continue;
    const [startMinute, startValue] = curve[index - 1]!;
    const share = (minuteOfDay - startMinute) / (endMinute - startMinute);
    return startValue + (endValue - startValue) * share;
  }
  return curve[curve.length - 1]![1];
}
