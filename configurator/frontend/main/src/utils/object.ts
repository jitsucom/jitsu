import { naturalComparator } from "./strings"

/**
 * Compares objects by a specified field value. The value must be string.
 * @param keyF predicate that returns a field value from object
 **/
export function naturalComparatorBy<T>(keyF: (obj: T) => string): (a: T, b: T) => number {
  return (a, b) => naturalComparator(keyF(a), keyF(b))
}

/**
 * Works exactly the same as `Object.entries` except that returns the union type of the object keys istead of a generic `string` type.
 * ```
 * WARNING``` - the function is only safe to use with objects that are not expected to be mutated in runtime.
 * @param object - object to extract entries from
 */
export const typedObjectEntries = <O>(object: O): [keyof O, O[keyof O]][] => {
  return Object.entries(object) as [keyof O, O[keyof O]][]
}

/**
 * Filters object properties by the rule
 * As a second generic parameter pass a union of keys that will be definitely preserved
 * @param object object to process
 * @param decideIfNeedToKeep rule that accepts object entries and returns boolean that if true will keep the object field
 * @returns new object with some fields filtered away
 */
export const filterObject = <T extends Object, PreservedKeys extends keyof T>(
  object: T,
  decideIfNeedToKeep: (entry: [key: string, value: unknown]) => boolean
): Pick<T, PreservedKeys> & Partial<Omit<T, PreservedKeys>> => {
  return Object.fromEntries(Object.entries(object).filter(decideIfNeedToKeep)) as Pick<T, PreservedKeys> &
    Partial<Omit<T, PreservedKeys>>
}

// type NonNullableObject<T extends {[key: string]: any}> = {[key: keyof T]: T[keyof T]}

// export const filterObjectNullishFields = <T extends Function>(object: T): {[key: keyof T]: T[keyof T]} => {
//   return {}
// }
