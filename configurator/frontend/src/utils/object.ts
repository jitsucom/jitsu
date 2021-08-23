/**
 * Works exactly the same as `Object.entries` except that returns the union type of the object keys istead of a generic `string` type.
 * ```
 * WARNING``` - the function is only safe to use with objects that are not expected to be mutated in runtime.
 * @param object - object to extract entries from
 */
export const typedObjectEntries = <O>(object: O): [keyof O, O[keyof O]][] => {
  return Object.entries(object) as [keyof O, O[keyof O]][];
};
