
interface TimeValueUnit {
  value: number;
  unit: 'd' | 'h' | 'm' | 's';
}
/**
 * Formats a millisecond duration into a human-readable short string.
 *
 * - < 60 s   → "Xs"
 * - < 1 h    → "Xm Ys"
 * - ≥ 1 h    → "XhYm"
 */
export function formatSeconds(ms: number): string {

  const totalSeconds = Math.round(ms / 1000);
  const isNegative = totalSeconds < 0;
  const absSeconds = Math.abs(totalSeconds);
  // get days, hours, minutes, seconds components
  const days = Math.floor(absSeconds / 86_400);
  const hours = Math.floor((absSeconds % 86_400) / 3_600);
  const minutes = Math.floor((absSeconds % 3_600) / 60);
  const seconds = absSeconds % 60;
  const timeResult = formatOutput(
    { value: days, unit: 'd' },
    { value: hours, unit: 'h' },
    { value: minutes, unit: 'm' },
    { value: seconds, unit: 's' }
  ).trim();

  // Handle the case where all components are zero
  if (timeResult === '') {
    return '0s';
  }

  if (isNegative) {
    return '-' + timeResult;
  }
  return timeResult;
}

export function formatOutput(...units: TimeValueUnit[]): string {
  return units.map(({ value, unit }) => (value === 0 ? '' : `${value}${unit} `)).join('');
}
