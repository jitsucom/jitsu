export function setFixedInterval(fn: () => Promise<any> | any, intervalMs: number, cancelled?: () => boolean): void {
  let next = Date.now() + intervalMs;

  const tick = async () => {
    if (cancelled && cancelled()) {
      return;
    }
    await fn();

    const now = Date.now();
    next += intervalMs;
    const delay = Math.max(0, next - now);

    setTimeout(tick, delay);
  };

  setTimeout(tick, intervalMs);
}
