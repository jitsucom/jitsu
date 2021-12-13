import { isNullOrUndef } from "lib/commons/utils"
import isArray from "lodash/isArray"
import isObject from "lodash/isObject"
import set from "lodash/set"

const mapFieldValueArray = (array: Array<unknown>) => {
  return array.map(value =>
    isArray(value) ? mapFieldValueArray(value) : isObject(value) ? makeObjectFromFieldsValues(value) : value
  )
}

const makeObjectFromFieldsValues = <F = any>(
  fields: any,
  options?: { omitEmptyValues?: boolean; omitFieldsWithPrefix?: string }
): F =>
  Object.keys(fields).reduce((accumulator: any, current: string) => {
    const { omitEmptyValues, omitFieldsWithPrefix } = options ?? {}
    if (omitFieldsWithPrefix && current.startsWith(omitFieldsWithPrefix)) return accumulator

    const value = fields[current]
    if (["string", "number", "boolean"].includes(typeof value)) {
      if (omitEmptyValues && (value === "" || isNullOrUndef(value))) return accumulator
      set(accumulator, current, value === "null" ? null : value)
    } else if (typeof value === "object") {
      if (isArray(value)) {
        set(accumulator, current, mapFieldValueArray(value))
        // set(
        //   accumulator,
        //   current,
        //   value.map((f) =>
        //     typeof f === 'object' ? makeObjectFromFieldsValues(f) : f
        //   )
        // );
      } else if (value != null) {
        set(accumulator, current, makeObjectFromFieldsValues(value))
      }
    }

    return accumulator
  }, {} as F)

export { makeObjectFromFieldsValues }
