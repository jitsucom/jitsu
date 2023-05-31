export type InterfaceWrapper<T> = {
  get(): WithAsyncMethods<T>;
  loaded(instance: T);
};

type MethodCall<M> = {
  method: keyof M;
  args: any[];
  resolve?: (value: any) => void;
  reject?: (reason: any) => void;
};

type WithAsyncMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R extends Promise<any> ? R : Promise<R>
    : T[K];
};

/**
 * This function creates a wrapper around an interface that allows to call methods on it, but all methods will go to queue. Once actual instance
 * implementation becomes available, all queued methods will be called on it.
 *
 *
 * @param methods of methods that should be wrapped. Per each method of you should specify if it should be wrapped. You'll need to mark all
 * methods for type safety. If method is not wrapped, it will throw an error when called.
 */
export function delayMethodExec<T>(methods: Record<keyof T, boolean>): InterfaceWrapper<T> {
  const queue: Array<MethodCall<T>> = [];

  let instance: Partial<T> = {};
  for (const [_method, enabled] of Object.entries(methods)) {
    const method = _method as keyof T;
    if (enabled) {
      instance[method] = ((...args) => {
        queue.push({ method, args });
        return new Promise((resolve, reject) => {
          queue[queue.length - 1].resolve = resolve;
          queue[queue.length - 1].reject = reject;
        });
      }) as any;
    } else {
      instance[method] = (() => {
        throw new Error(`Method ${_method} is not implemented`);
      }) as any;
    }
  }

  return {
    get() {
      return instance as WithAsyncMethods<T>;
    },
    loaded(newInstance: T) {
      for (const { method, args, resolve, reject } of queue) {
        try {
          const result = (newInstance[method] as any)(...args);
          if (typeof result.then === "function") {
            result.then(resolve).catch(reject);
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(e);
        }
      }
      for (const method of Object.keys(methods)) {
        instance[method] = newInstance[method];
      }
    },
  };
}
