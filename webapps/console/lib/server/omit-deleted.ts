// Strips the `deleted` boolean from API responses. List endpoints already filter to
// `deleted: false` at query time, so the field is always false in returned objects —
// exposing it just leaks an internal soft-delete detail. Apply at every response site
// that spreads a Prisma row directly.

export function omitDeleted<T extends Record<string, any>>(obj: T): Omit<T, "deleted"> {
  if (obj == null || typeof obj !== "object") return obj;
  const { deleted, ...rest } = obj;
  return rest;
}

export function omitDeletedList<T extends Record<string, any>>(arr: T[]): Omit<T, "deleted">[] {
  return arr.map(omitDeleted);
}
