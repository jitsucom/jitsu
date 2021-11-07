import { withQueryParams } from "./queryParams"

describe("withQueryParams function", () => {
  it("concatenates multiple query params ignoring nulls and undefineds", () => {
    const baseUrl = "/api/v1/endpoint"
    const params = {
      param1: "value1",
      paramUndefined: undefined,
      param2: "value2",
      paramNull: null,
    }
    expect(withQueryParams(baseUrl, params)).toBe("/api/v1/endpoint?param1=value1&param2=value2")
  })
})
