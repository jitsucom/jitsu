import { delayMethodExec } from "../../src/method-queue";
import { expect } from "@playwright/test";

interface ITest {
  method(str: string, num: number): string;

  _internalMethod(str: string, num: number): string;
}

interface AsyncInterface {
  method(str: string, num: number): Promise<string>;

  _internalMethod(str: string, num: number);
}

test("method-queue", async () => {
  const testResult: string[] = [];
  const wrap = delayMethodExec<ITest>({
    method: true,
    _internalMethod: false,
  });
  const instance = wrap.get();
  const wrapPromise = instance.method("a", 1).then(res => testResult.push(res));

  expect(testResult).toEqual([]);
  expect(() => instance._internalMethod("a", 1)).toThrowError();

  wrap.loaded({
    _internalMethod(str, num) {
      return `${str}${num}`;
    },
    method(str, num) {
      const result = this._internalMethod(str, num);
      testResult.push(result);
      return `result:${result}`;
    },
  });
  await wrapPromise;

  expect(testResult).toEqual(["a1", "result:a1"]);

  instance.method("b", 2);
  expect(testResult).toEqual(["a1", "result:a1", "b2"]);
});

test("test-async", async () => {
  const testResult: string[] = [];
  const wrap = delayMethodExec<AsyncInterface>({
    method: true,
    _internalMethod: false,
  });
  const instance = wrap.get();
  const wrapPromise = instance.method("a", 1).then(res => testResult.push(res));

  wrap.loaded({
    _internalMethod(str, num) {
      return `${str}${num}`;
    },
    async method(str, num) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return `result:${this._internalMethod(str, num)}`;
    },
  });
  await wrapPromise;
  expect(testResult).toEqual(["result:a1"]);
});
