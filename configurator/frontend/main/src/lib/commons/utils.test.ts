import { flatten, numberFormat, unflatten } from "./utils"

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
