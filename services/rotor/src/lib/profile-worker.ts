// Profile UDF worker — runs a profile function in an isolated Deno Web Worker.
// Receives: { type: "init", code, id, variables }
// Then:     { type: "exec", events, user }
// Returns:  { type: "result", result, error, logs }

const _self = globalThis as any;

let compiledFn: any;
let funcId: string;
let funcProps: any;

_self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === "init") {
    funcId = msg.id;
    funcProps = msg.variables || {};
    try {
      // Compile the UDF code as a module
      const blob = new Blob([msg.iifeCode], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const mod = await import(url);
      URL.revokeObjectURL(url);
      compiledFn = mod.default || (mod.__udf && mod.__udf.default);
      if (!compiledFn) {
        throw new Error("No default export found in profile UDF");
      }
      _self.postMessage({ type: "ready" });
    } catch (err: any) {
      _self.postMessage({
        type: "result",
        error: { message: err.message, name: err.name || "CompilationError", stack: err.stack },
        logs: [],
      });
    }
    return;
  }

  if (msg.type === "exec") {
    const { events, user } = msg;
    const logs: any[] = [];

    try {
      // Build providers from events array
      let eventIndex = 0;
      const eventsProvider = async () => {
        if (eventIndex < events.length) {
          return events[eventIndex++];
        }
        return undefined;
      };
      const userProvider = async () => user;

      const funcCtx = {
        function: { id: funcId, type: "profile", debugTill: new Date(Date.now() + 86400000) },
        props: funcProps,
      };

      const result = await compiledFn(eventsProvider, userProvider, funcCtx);
      _self.postMessage({ type: "result", result: result || undefined, logs });
    } catch (err: any) {
      _self.postMessage({
        type: "result",
        error: { message: err.message, name: err.name || "Error", stack: err.stack, retryPolicy: err.retryPolicy },
        logs,
      });
    }
    return;
  }
};
