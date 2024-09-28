export type ErrorLike = string | (() => Error) | Error;

function toError(err: ErrorLike): Error {
  if (typeof err === "string") {
    return new Error(err);
  } else if (typeof err === "function") {
    return err();
  } else {
    return err;
  }
}

export function assertTrue<T>(obj: boolean | null | undefined, error?: ErrorLike): asserts obj is true {
  if (obj === undefined || obj === null) {
    throw toError(error || "Object is not defined");
  } else if (obj === false) {
    throw toError(error || "Object is false");
  }
}

export function assertFalse(obj: boolean, error?: ErrorLike): asserts obj is false {
  if (obj === true) {
    throw toError(error || "Object is true");
  }
}

export function assertDefined<T>(obj: T | undefined | null, error?: ErrorLike): asserts obj is T {
  if (obj === undefined || obj === null) {
    throw toError(error || "Object is not defined");
  }
}

export function requireDefined<T>(obj: T | undefined | null, error?: string): T {
  if (obj === undefined || obj === null) {
    throw toError(error || "Object is not defined");
  }
  return obj as T;
}
