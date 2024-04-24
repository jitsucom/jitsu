export function parseNumber<T = number | undefined>(val: string | undefined, defaultValue?: T): T | number {
  if (val) {
    const n = parseFloat(val);
    if (!Number.isFinite(n)) {
      return defaultValue as T | number;
    }
    return n;
  } else {
    return defaultValue as T | number;
  }
}

export function parseRequiredNumber(val: string | undefined, error?: string): number {
  if (val) {
    const n = parseFloat(val);
    if (!Number.isFinite(n)) {
      throw new Error(error || "Object is not a finite number");
    }
    return n;
  } else {
    throw new Error(error || "Object is not defined");
  }
}
