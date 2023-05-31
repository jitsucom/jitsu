export type Stopwatch = {
  startedAt: number;
  elapsedMs(): number;
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
  return {
    elapsedPretty(): string {
      return formatMs(this.elapsedMs());
    },
    elapsedMs(): number {
      return Date.now() - this.startedAt;
    },
    startedAt: Date.now(),
  };
}
