// @Libs
import nodejs_assert from "assert"
// @Utils
import { toArrayIfNot } from "./arrays"

type AssertionOptions = {
  errMsg: string
  allowUndefined?: boolean
}

/**
 * Checks if value is an object.
 *
 * @param value value to check
 *
 * @returns boolean
 */
export function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null
}

/**
 * Checks if value is an array.
 *
 * @param value value to check
 *
 * @returns boolean
 */
export function isArray<T>(value: Array<T> | unknown): value is Array<T> {
  return Array.isArray(value)
}

/**
 * Checks whether the object has a property.
 *
 * @param object object to check
 * @param property property to look for
 *
 * @returns boolean
 */
export function hasOwnProperty<O extends {}, P extends PropertyKey>(
  object: O,
  property: P
): object is O & Record<P, unknown> {
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
 * @param errorName error name to specify
 *
 * @returns {void} void
 * @throws {AssertionError} NodeJS assertion error
 */
export function assert(condition: boolean, errMsg: string, errorName?: string): asserts condition {
  const error = new Error(errMsg)
  error.name = errorName
  nodejs_assert(condition, error)
}

/**
 * Asserts whether the value is string - if not, throws an error.
 * Useful for making type checks that will provide type narrowing.
 *
 * @param value value to assert
 * @param errMsg error message to throw if assertion fails
 * @param errorName error name to specify
 *
 * @returns void or never
 *
 */
export function assertIsString(
  value: unknown,
  options?: AssertionOptions,
  errorName?: string
): asserts value is string {
  let condition = typeof value === "string"
  if (options?.allowUndefined) condition = condition || typeof value === "undefined"

  assert(condition, options?.errMsg || `array assertion failed - ${value} is not an array`, errorName)
}

/**
 * Asserts whether the value is boolean - if not, throws an error.
 * Useful for making type checks that will provide type narrowing.
 *
 * @param value value to assert
 * @param errMsg error message to throw if assertion fails
 * @param errorName error name to specify
 *
 * @returns void or never
 *
 */
export function assertIsBoolean(value: unknown, errMsg: string, errorName?: string): asserts value is string {
  const condition = typeof value === "boolean"
  assert(condition, errMsg || `array assertion failed - ${value} is not an array`, errorName)
}

/**
 * Asserts whether the value is array - if not, throws an error.
 * Useful for making type checks that will provide type narrowing.
 *
 * @param value value to assert
 * @param errMsg error message to throw if assertion fails
 * @param errorName error name to specify
 *
 * @returns void or never
 *
 */
export function assertIsArray(value: unknown, errMsg: string, errorName?: string): asserts value is Array<unknown> {
  assert(Array.isArray(value), `${errMsg}\nArray assertion failed: value is not an array`, errorName)
}

/**
 * Asserts whether the value is an array and whether the type of
 * its values is the same as type of the passed type reference values
 * @param value value to assert
 * @param typeReferenceValues
 * Type reference value or an array of values. Values may be arbitrary,
 * just make sure that their types are ones you want to assert.
 * @example
 * ```
 * const array = ['foo', 'bar', 42, ']
 * ```
 * @param errMsg error message to throw if assertion fails
 * @param errorName error name to specify
 * @returns
 */
export function assertIsArrayOfTypes<T>(
  value: unknown,
  typeReferenceValues: T | T[],
  errMsg: string,
  errorName?: string
): asserts value is Array<T> {
  assertIsArray(value, `${errMsg}\nassertIsArrayOfTypes error`)
  if (value.length === 0) return
  const actualTypes = Array.from(new Set(value.map(element => typeof element))) // filtering duplicates
  const whitelistedTypes = new Set(toArrayIfNot(typeReferenceValues).map(element => typeof element))
  const negatedIntersection = [...actualTypes].filter(type => !whitelistedTypes.has(type))
  assert(negatedIntersection.length === 0, errMsg || `array of type assertion failed`, errorName)
}

/**
 * Asserts whether the value is an object - if not, throws an error.
 * Useful for making type checks that will provide type narrowing.
 *
 * @param value value to assert
 * @param errMsg error message to throw if condition is falsy
 * @param errorName error name to specify
 *
 * @returns void or never
 *
 */
export function assertIsObject(value: unknown, errMsg: string, errorName?: string): asserts value is UnknownObject {
  assert(isObject(value), `${errMsg}\nObject assertion failed - value is not an object`, errorName)
}

/**
 * Asserts that object has a property.
 *
 * @param object object to check
 * @param property property to look for
 * @param errMsg error to display if assertion failed
 * @param errorName error name to specify
 *
 * @returns void or never
 */
export function assertHasOwnProperty<O extends {}, P extends PropertyKey>(
  object: O,
  property: P,
  errMsg: string,
  errorName?: string
): asserts object is O & Record<P, unknown> {
  assert(hasOwnProperty<O, P>(object, property), errMsg, errorName)
}

/**
 * Asserts that object has all properties from the argument array
 *
 * @param object object to check
 * @param properties array of properties to look for
 * @param errMsg error to display if assertion failed
 * @param errorName error name to specify
 *
 * @returns void or never
 */
export function assertHasAllProperties<O extends {}, P extends (string | number)[]>(
  object: O,
  properties: P,
  errMsg: string,
  errorName?: string
): asserts object is O & Record<keyof P, unknown> {
  properties.forEach(property =>
    assert(hasOwnProperty(object, property), `${errMsg}\nRequired property '${property}' not found`, errorName)
  )
}
