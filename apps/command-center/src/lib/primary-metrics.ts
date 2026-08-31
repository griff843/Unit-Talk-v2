/**
 * Returns the most recent measured daily count. A missing or empty series is
 * unavailable, not zero and not interchangeable with the loaded picks window.
 */
export function readTodayPickCount(dailyPickCounts: number[] | null | undefined): number | null {
  if (!dailyPickCounts || dailyPickCounts.length === 0) return null;

  const count = dailyPickCounts[dailyPickCounts.length - 1];
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}
