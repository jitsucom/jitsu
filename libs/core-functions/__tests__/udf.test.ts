import { Isolate } from "isolated-vm";
import { UDFTestRun, UDFWrapper } from "../src";
import express from "express";

test("UDFWrapper", async () => {
  let server: any = undefined;
  let wrapper: any = undefined;
  try {
    const app = express();
    app.get("/", (req, res) => {
      return res.send("FETCH RESPONSE");
    });
    var promiseResolve;
    let prom = new Promise<number>((resolve, reject) => {
      promiseResolve = resolve;
    });
    server = app.listen(0, async () => {
      const addr = server.address() as any;
      promiseResolve(addr.port);
    });
    const port = await prom;

    const udfCode = `
export const config = {
    slug: "udf",
    name: "UDF Wrapper test",
    description: "Description of UDF Wrapper test"
};
const udf = async (event, { log, fetch, props, store, geo, ...meta }) => {
    console.log("udf")
    event.test = "test123"
    const url = \`http://localhost:${port}/\`;
    console.log("url", url)
    const result = await fetch(url).then(r => r.text());
    console.log("result", result)
    event.prop1 = props.prop1
    event.store1 = await store.get("store1")
    event.fetch_result = result
    store.set("test", result)
    console.log("done")
    return event;
};

export default udf;
`;

    wrapper = UDFWrapper("udf", "UDF Wrapper test", udfCode);
    console.log("wrapper", wrapper.meta);
    const res = await UDFTestRun({
      functionId: "udf",
      functionName: "UDF Wrapper test",
      code: wrapper,
      event: {
        messageId: "test",
        type: "page",
        context: {},
      },
      config: {
        prop1: "test_prop1",
      },
      store: {
        store1: "test_store1",
      },
      workspaceId: "test",
    });
    console.log("res", res);

    expect(res.result).toEqual({
      messageId: "test",
      type: "page",
      context: {},
      test: "test123",
      prop1: "test_prop1",
      store1: "test_store1",
      fetch_result: "FETCH RESPONSE",
    });
    expect(res.store).toEqual({
      store1: "test_store1",
      test: "FETCH RESPONSE",
    });
  } finally {
    server?.close();
    wrapper?.close();
  }
});

test("isolate", async () => {
  const moduleCode = `
let adder=0;

export const myConst = 123;

function inc() {
    adder++
    return adder;
}
export default inc;
`;
  const isolate = new Isolate({ memoryLimit: 10 });
  const context = await isolate.createContext();
  const jail = context.global;

  // This make the global object available in the context as 'global'. We use 'derefInto()' here
  // because otherwise 'global' would actually be a Reference{} object in the new isolate.
  jail.setSync("global", jail.derefInto());
  const module = isolate.compileModuleSync(moduleCode, { filename: "udf.js" });
  module.instantiateSync(context, (specifier: string) => {
    throw new Error(`import not allowed: ${specifier}`);
  });
  module.evaluateSync();
  const exported = module.namespace;

  let ref = exported.getSync("default", {
    reference: true,
  });
  const inc = async () =>
    await ref.applySync(undefined, [], { arguments: { reference: true }, result: { promise: true } });
  const myConst = exported.getSync("myConst");

  console.log("udf", exported);
  console.log("myConst", myConst);
  console.log("inc", inc);

  expect(await inc()).toEqual(1);
  expect(await inc()).toEqual(2);
  expect(await inc()).toEqual(3);

  return [];
});
