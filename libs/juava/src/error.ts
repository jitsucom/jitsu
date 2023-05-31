export function getErrorMessage(e: any): string {
  return e?.message || "unknown error";
}

export function newError(message: string, cause?: any) {
  return new Error(cause?.message ? `${message}: ${cause?.message}` : message);
}
