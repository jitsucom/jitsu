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
  let previousThrottleTime = Date.now();
  let currentThrottle = 0;
  let fails = 0;
  let successes = 0;

  function recalculateThrottle() {
    const total = fails + successes;
    const now = Date.now();
    if (total > 100 || (total >= 10 && now - previousThrottleTime > calculatePeriodMs)) {
      previousThrottleTime = now;

      const l = Math.min(100, total);
      currentThrottle = Math.min(fails / total, (l - 1) / l);
      fails = 0;
      successes = 0;
    }
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
      return currentThrottle;
    },
  };
}
