export function parseDate(dateStr: string | undefined, defaultValue: Date): Date {
  if (!dateStr) {
    return defaultValue;
  }
  const parsed = Date.parse(dateStr);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  return new Date(parsed);
}
