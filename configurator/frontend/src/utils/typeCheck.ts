import nodejs_assert from 'assert'

/**
 * Checks if value is an object.
 *
 * @param value value to check
 *
 * @returns boolean
 */
export function isObject(value: unknown): value is Object {
  return typeof value === 'object' && value !== null;
}

/**
 * Checks if value is an array.
 *
 * @param value value to check
 *
 * @returns boolean
 */
export function isArray<T>(value: Array<T> | unknown): value is Array<T> {
  return Array.isArray(value);
}

/**
 * Checks whether the object has a property.
 *
 * @param object object to check
 * @param property property to look for
 *
 * @returns boolean
 */
export function hasOwnProperty<
 O extends {},
 P extends PropertyKey
>(object: O, property: P): object is O & Record<P, unknown> {
  return object.hasOwnProperty(property)
}

/**
 * Asserts whether condition is truthy - if not, throws an error.
 * Useful for making type checks that will provide type narrowing.
 *
 * Uses NodeJS built in assertion function. May be overloaded.
 *
 * @param {boolean} condition condition to check
 * @param {string} errMsg error message to throw if condition is falsy
 *
 * @returns {void} void
 * @throws {AssertionError} NodeJS assertion error
 */
export function assert(
  condition: boolean,
  errMsg?: string
): asserts condition {
  nodejs_assert(condition, errMsg)
}

/**
 * Asserts whether the value is array - if not, throws an error.
 * Useful for making type checks that will provide type narrowing.
 *
 * @param value value to assert
 * @param errMsg error message to throw if condition is falsy
 *
 * @returns void or never
 *
 */
export function assertIsArray(
  value: unknown,
  errMsg?: string
): asserts value is Array<unknown> {
  assert(Array.isArray(value), errMsg || `${value} is not an array`);
}

/**
 * Asserts whether the value is an object - if not, throws an error.
 * Useful for making type checks that will provide type narrowing.
 *
 * @param value value to assert
 * @param errMsg error message to throw if condition is falsy
 *
 * @returns void or never
 *
 */
export function assertIsObject(
  value: unknown,
  errMsg?: string
): asserts value is Object {
  assert(isObject(value), errMsg || `${value} is not an object`);
}

/**
 * Asserts that object has a property.
 *
 * @param object object to check
 * @param property property to look for
 * @param errMsg error to display if assertion failed
 *
 * @returns void or never
 */
export function assertHasOwnProperty<
  O extends {},
  P extends PropertyKey
>(
  object: O,
  property: P,
  errMsg?: string
): asserts object is O & Record<P, unknown> {
  assert(hasOwnProperty<O, P>(object, property), errMsg);
}