export interface Throttle {
  throttle(): number;
  fail: () => void;
  success: () => void;
}

export function noThrottle(): Throttle {
  return {
    throttle: () => 0,
    fail: () => {},
    success: () => {},
  };
}

export function getThrottle(calculatePeriodMs: number): Throttle {
  let previousThrottle = 0;
  let previousThrottleTime = Date.now();
  let currentThrottle = 0;
  let fails = 0;
  let successes = 0;

  function recalculateThrottle() {
    const now = Date.now();
    if (now - previousThrottleTime < calculatePeriodMs) {
      return;
    }
    previousThrottleTime = now;
    previousThrottle = currentThrottle;
    const total = fails + successes;
    if (total < 2) {
      currentThrottle = 0;
      return;
    }
    const l = Math.min(10, total);
    currentThrottle = Math.min(fails / total, (l - 1) / l);
  }

  return {
    fail: () => {
      fails++;
      recalculateThrottle();
    },
    success: () => {
      successes++;
      recalculateThrottle();
    },
    throttle: () => {
      return (previousThrottle + currentThrottle) / 2;
    },
  };
}
