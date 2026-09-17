import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spoolJsonRows } from "./stream-spool";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "jitsu-spool-test-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function* rows() {
  yield '{"id":"9007199254740993"}';
  yield '{"id":"2"}';
}
describe("warehouse temporary spool", () => {
  it("drains the source before exposing rows, preserves values and cleans up after early return", async () => {
    let ended = false;
    async function* source() {
      yield* rows();
      ended = true;
    }
    for await (const row of spoolJsonRows<{ id: string }>(source(), undefined, { directory })) {
      expect(ended).toBe(true);
      expect(row.id).toBe("9007199254740993");
      break;
    }
    expect(await readdir(directory)).toEqual([]);
  });
  it("rejects oversized data before yielding and removes the partial file", async () => {
    const run = async () => {
      for await (const _row of spoolJsonRows(rows(), undefined, { directory, maxBytes: 5 }))
        throw new Error("Must not yield partial data");
    };
    await expect(run()).rejects.toThrow("temporary-file budget");
    expect(await readdir(directory)).toEqual([]);
  });
  it("cleans up on source failure and cancellation", async () => {
    const controller = new AbortController();
    for (const cancelled of [false, true]) {
      async function* source() {
        yield '{"id":1}';
        if (cancelled) controller.abort(new Error("cancelled"));
        else throw new Error("source failed");
      }
      const run = async () => {
        for await (const _row of spoolJsonRows(source(), controller.signal, { directory }))
          throw new Error("Must not yield partial data");
      };
      await expect(run()).rejects.toThrow(cancelled ? "cancelled" : "source failed");
      expect(await readdir(directory)).toEqual([]);
    }
  });
});
