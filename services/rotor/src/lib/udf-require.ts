// A UDF compiled to an IIFE for a worker (compileUdfToIIFE) reaches a Node built-in such as `crypto` through esbuild's
// `require` shim, and a worker has no `require`: evaluating the code threw "Dynamic require of ... is not supported", and
// the function was replaced by one that throws. The worker preloads the allowed built-ins and hands the IIFE a `require`
// that serves only those.

/** A `require` for the modules given by name (`crypto`; `node:crypto` is the same). Any other name throws, as before. */
export function makeUdfRequire(modules: Record<string, any>): (name: string) => any {
  return (name: string) => {
    const key = String(name).replace(/^node:/, "");
    if (Object.prototype.hasOwnProperty.call(modules, key)) {
      return modules[key];
    }
    throw new Error(`Dynamic require of "${name}" is not supported`);
  };
}

/** Evaluates the IIFE code of a UDF (`var __udf = ...`) and returns `__udf`, with `require` in scope. */
export function evaluateUdfIife(iifeCode: string, udfRequire: (name: string) => any): any {
  const factory = new Function("require", iifeCode + "\nreturn __udf;");
  return factory(udfRequire);
}
