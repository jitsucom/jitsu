// import { JitsuFunction } from "@jitsu/protocols/functions";
// import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
// import ivm from "isolated-vm";
//
// export const UDFWrapper = (functionId, functionCode: string) => {
//   const startMs = new Date().getTime();
//   const isolate = new ivm.Isolate({ memoryLimit: 10 });
//   const context = isolate.createContextSync();
//   const jail = context.global;
//   // This make the global object available in the context as 'global'. We use 'derefInto()' here
//   // because otherwise 'global' would actually be a Reference{} object in the new isolate.
//   jail.setSync("global", jail.derefInto());
//   const module = isolate.compileModuleSync(functionCode, { filename: `${functionId}.js` });
//   module.instantiateSync(context, (specifier: string) => {
//     throw new Error(`import not allowed: ${specifier}`);
//   });
//   module.evaluateSync();
//   const exported = module.namespace;
//   let userFunction = exported.getSync("default", {
//     reference: true,
//   });
//   if (!userFunction) {
//     userFunction = exported.getSync("onEvent", {
//       reference: true,
//     });
//   }
//   if (!userFunction) {
//     throw new Error("Function not found. Please export default function or 'onEvent' function.");
//   }
//   console.log(`udf compile time ${new Date().getTime() - startMs}ms`);
//   return {
//     // userFunction: async (event, ctx) => {
//     //   return userFunction.apply(jail, [event, ctx], { arguments: { reference: true }, result: { promise: true } });
//     // },
//     close: () => {
//       isolate.dispose();
//     },
//   };
// };
