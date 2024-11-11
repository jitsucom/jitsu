export type Stopwatch = {
  startedAt: number;
  elapsedMs(): number;
  lapMs(): number;
  elapsedPretty(): string;
};

function formatMs(ms: number) {
  if (Math.floor(ms / (60 * 1000)) >= 1) {
    return `${Math.floor(ms / (60 * 1000))}m ${formatMs(ms % (60 * 1000))}`;
  }
  if (Math.floor(ms / 1000) >= 1) {
    return `${Math.floor(ms / 1000)}s ${formatMs(ms % 1000)}`;
  }
  return `${ms}ms`;
}

export function stopwatch(): Stopwatch {
  let startedAt = Date.now();
  let lastLap = startedAt;
  return {
    elapsedPretty(): string {
      return formatMs(this.elapsedMs());
    },
    elapsedMs(): number {
      return Date.now() - this.startedAt;
    },
    lapMs(): number {
      const now = Date.now();
      const lap = now - lastLap;
      lastLap = now;
      return lap;
    },
    startedAt: startedAt,
  };
}
