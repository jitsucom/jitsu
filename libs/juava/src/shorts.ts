export function asArray<T>(arrayLike: T | T[]): T[] {
  return Array.isArray(arrayLike) ? arrayLike : [arrayLike];
}

export function asSingleton<T>(arrayLike: T | T[]): T {
  if (Array.isArray(arrayLike)) {
    if (arrayLike.length !== 1) {
      throw new Error(`Expected singleton array. Got ${arrayLike.length} elements`);
    }
    return arrayLike[0];
  }
  return arrayLike;
}

export type NotFunction = Exclude<any, Function>;

export type FunctionLike<T, V = void> = ((args: V) => NotFunction) | NotFunction;

export function asFunction<T, V = void>(f: FunctionLike<T, V>): (arg: V) => T {
  if (typeof f === "function") {
    return f;
  } else {
    return () => f;
  }
}
