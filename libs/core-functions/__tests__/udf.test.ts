import { NodeVM } from "vm2";
import * as swc from "@swc/core";

const moduleCode = `
let adder=0;

export const myConst = 123;

function inc() {
    adder++
    return adder;
}
export default inc;
`;

test("vm2", async () => {
  const vm = new NodeVM({
    timeout: 1000,
    allowAsync: true,
    require: false,
  });
  const transpiled = swc.transformSync(moduleCode, {
    filename: `index.js`,
    module: { type: "commonjs" },
  }).code;
  console.log("transpiled", transpiled);
  // const transpiled = transformSync(moduleCode, {
  //   presets: ["@babel/preset-env"],
  //   filename: `index.js`,
  //   plugins: [plugin],
  // }).code;
  const r = vm.run(`
${transpiled}
return module.exports;
  `);
  console.log("exports", r);
  const inc = r.default;
  expect(inc()).toEqual(1);
  expect(inc()).toEqual(2);
  expect(inc()).toEqual(3);

  return [];
});
//
// test("isolate", async () => {
//   const isolate = new ivm.Isolate({ memoryLimit: 10 });
//   const context = await isolate.createContext();
//   const jail = context.global;
//
//   // This make the global object available in the context as 'global'. We use 'derefInto()' here
//   // because otherwise 'global' would actually be a Reference{} object in the new isolate.
//   jail.setSync("global", jail.derefInto());
//   const module = isolate.compileModuleSync("let exports = {}\n" + moduleCode, { filename: "udf.js" });
//   module.instantiateSync(context, (specifier: string) => {
//     throw new Error(`import not allowed: ${specifier}`);
//   });
//   module.evaluateSync();
//   const exported = module.namespace;
//
//   let ref = exported.getSync("default", {
//     reference: true,
//   });
//   let add = ref.deref();
//   const myConst = exported.getSync("myConst2");
//
//   console.log("udf", exported);
//   console.log("myConst", myConst);
//   console.log("add", add);
//
//   console.log("add", add(1, 2));
//   console.log("add", add(1, 2));
//   console.log("add", add(1, 2));
//
//   return [];
// });
