import { idToSnakeCaseFast } from "./strings";

export function toSnakeCase(param: any): any {
  if (Array.isArray(param)) {
    return param.map(toSnakeCase);
  } else if (typeof param === "object" && param !== null) {
    const r = {};
    for (const [key, value] of Object.entries(param)) {
      r[idToSnakeCaseFast(key)] = toSnakeCase(value);
    }
    return r;
  } else {
    return param;
  }
}

export function removeUndefined(param: any): any {
  if (Array.isArray(param)) {
    return param.map(removeUndefined);
  } else if (typeof param === "object" && param !== null) {
    for (const [key, value] of Object.entries(param)) {
      switch (typeof value) {
        case "undefined":
          delete param[key];
          break;
        case "object":
          if (value !== null) {
            removeUndefined(value);
          }
          break;
      }
    }
  }
  return param;
}

export function transferAsSnakeCase(target: Record<string, any>, source: any, omit?: string[]) {
  if (typeof source !== "object") {
    return;
  }
  for (const [k, v] of Object.entries(source)) {
    if (!omit || !omit.includes(k)) {
      target[idToSnakeCaseFast(k)] = toSnakeCase(v);
    }
  }
}

export function transferValueAsSnakeCase(target: Record<string, any>, property: string, source: any) {
  if (typeof source === "undefined") {
    return;
  }
  target[property] = toSnakeCase(source);
}

export function transfer(target: Record<string, any>, source: any, omit?: string[]) {
  if (typeof source !== "object") {
    return;
  }
  for (const [k, v] of Object.entries(source)) {
    if (!omit || !omit.includes(k)) {
      target[k] = v;
    }
  }
}

export function transferValue(target: Record<string, any>, property: string, source: any) {
  if (typeof source === "undefined") {
    return;
  }
  target[property] = source;
}
