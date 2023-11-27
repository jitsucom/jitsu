import Marshal from "./marshalling"

class Data {
  num = 12
  str = "str"
  internal: DataEmbedded = new DataEmbedded()

  public method(): number {
    return this.num
  }
}

class DataEmbedded {
  str2: string = "embedded"

  public method(): string {
    return this.str2
  }
}

test("marshalUnmarshal", () => {
  let data = new Data()
  console.log("Testing", JSON.stringify(data, null, 2))
  let pureJson = Marshal.toPureJson(data)
  console.log(pureJson)
  expect(pureJson["num"]).toBe(12)
  expect(pureJson["internal"]["str2"]).toBe("embedded")

  pureJson["num"] = 13
  pureJson["internal"]["str2"] = "embedded2"

  let copy = Marshal.newInstance(pureJson, [Data, DataEmbedded])
  console.log(copy)
  expect(copy["num"]).toBe(13)
  expect(copy["internal"]["str2"]).toBe("embedded2")
  expect(copy.method()).toBe(13)

  expect(copy.internal.method()).toBe("embedded2")
})

class Superclass {
  public a: string

  constructor(a: string) {
    this.a = a
  }
}

class Subclass extends Superclass {
  public b: string

  constructor(a: string, b: string) {
    super(a)
    this.b = b
  }

  public method() {
    return this.b
  }
}

test("inheritanceUnmarshalling", () => {
  let object = [new Subclass("a1", "b1"), new Subclass("a2", "b2"), new Superclass("a3")]
  let pureJson = Marshal.toPureJson(object)
  console.log("PURE", pureJson)
  let unmarshalled = Marshal.newInstance(pureJson, [Subclass, Superclass])
  console.log("RESTORED", unmarshalled)
  expect(unmarshalled[0].method()).toBe("b1")
})

test("testKnownClassMarhsalling", () => {
  let result = Marshal.newKnownInstance(Data, {
    num: 14,
    str: "str",
  })
  expect(result.method).toBeDefined()
  expect(result.method()).toBe(14)
})
