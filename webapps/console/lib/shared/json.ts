/**
 * Sometime JSON.stringify() throws an exception, if the object contains circular references.
 *
 * This method fixes that by catching the exception and returning stringifies option instead. It's intended to be used
 * for debugging logging
 */
export function safeJsonStringify(obj: any, space?: number): string {
  try {
    if (!space) {
      return JSON.stringify(obj);
    } else {
      return JSON.stringify(obj, null, space);
    }
  } catch (e) {
    return obj + "";
  }
}
