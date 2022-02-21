import { flatten, getObjectDepth, numberFormat, sanitize, unflatten } from "./utils"

test("numberFormat", () => {
  expect(numberFormat(1000)).toBe("1,000")
  expect(numberFormat({})(1000)).toBe("1,000")
  expect(numberFormat()(1000)).toBe("1,000")
})

test("flatten", () => {
  expect(flatten({ x: { y: { z: 1 } }, a: { b: 2 } })).toStrictEqual({ "x.y.z": 1, "a.b": 2 })
})

test("unflatten", () => {
  expect(unflatten({ "x.y.z": 1, "a.b": 2 })).toStrictEqual({ x: { y: { z: 1 } }, a: { b: 2 } })
})

test("object depth", () => {
  expect(getObjectDepth(null)).toBe(0)
  expect(getObjectDepth({})).toBe(0)
  expect(getObjectDepth({ foo: 1 })).toBe(1)
  expect(getObjectDepth({ foo: {} })).toBe(2)
})

test("sanitize with allow list", () => {
  expect(sanitize({ a: 1, b: 2, c: 3 }, { allow: ["a", "b"] })).toStrictEqual({ a: 1, b: 2 })
})

test("sanitize with block list", () => {
  expect(sanitize({ a: 1, b: 2, c: 3 }, { block: ["a", "b"] })).toStrictEqual({ c: 3 })
})
