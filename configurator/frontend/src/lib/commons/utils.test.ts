import { numberFormat } from "./utils"

test("numberFormat", () => {
  expect(numberFormat(1000)).toBe("1,000")
  expect(numberFormat({})(1000)).toBe("1,000")
  expect(numberFormat()(1000)).toBe("1,000")
})
