// Test helper, not part of the runner: runs ONE webhook sync through execute() in its own process, so webhook-kill.test.ts
// can kill it with a real signal while a request is in flight. Everything is production code except what a test must
// supply: a file-backed object store (so artifacts survive a kill), a no-op lease (there is no Kubernetes here), a
// generated source, and the address guard's documented test hook so a loopback receiver is reachable.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { createGuardedRequest } from "@jitsu/destination-functions/src/functions/lib/guarded-request";
import { defaultDeliveryDeps } from "@jitsu/destination-functions/src/functions/webhook/deliver";
import { createWebhookRuntime } from "@jitsu/destination-functions/src/functions/webhook/runtime";
import { Database } from "./persistence";
import { execute } from "./execute";
import type { ObjectStore } from "./artifacts/store";

/** Immutable objects on disk; a write is atomic (temp file then rename), like an object store's. */
class FileObjects implements ObjectStore {
  constructor(private readonly dir: string) {}
  private path(key: string) {
    return join(this.dir, encodeURIComponent(key));
  }
  async put(key: string, value: Buffer, signal: AbortSignal) {
    signal.throwIfAborted();
    await mkdir(this.dir, { recursive: true });
    try {
      if (!(await readFile(this.path(key))).equals(value)) throw new Error("collision");
      return;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    const temp = `${this.path(key)}.${process.pid}.tmp`;
    await writeFile(temp, value);
    await rename(temp, this.path(key));
  }
  async get(key: string, max: number, signal: AbortSignal) {
    signal.throwIfAborted();
    const value = await readFile(this.path(key));
    if (value.length > max) throw new Error("oversized");
    return value;
  }
}

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

async function main() {
  const rows = Number(env("KILL_ROWS"));
  const config = ReverseRunConfig.parse({
    version: 1,
    kind: "reverse",
    id: "kill-sync",
    workspaceId: "workspace",
    fromId: "model",
    toId: "destination",
    configRevision: "a".repeat(64),
    updatedAt: new Date().toISOString(),
    model: {
      warehouseId: "warehouse",
      query: "SELECT id, name FROM source",
      primaryKey: ["id"],
      cursor: { column: "id", type: "number" },
    },
    warehouse: { destinationType: "postgres" },
    destination: {
      destinationType: "webhook",
      url: env("KILL_RECEIVER_URL"),
      method: "POST",
      signatureMethod: "hmac",
      signatureSecret: "kill-secret",
    },
    options: {
      version: 2,
      stream: "rows",
      mode: "upsert",
      mapping: { id: "id", name: "name" },
      streamOptions: { deliveryAttested: true, allowInsecureHttp: true, recordsPerRequest: 50, concurrency: 2 },
      checkpointEvery: 5000,
      schedule: "",
      timezone: "Etc/UTC",
      errorPolicy: "fail",
      disabled: false,
    },
  });
  const controller = new AbortController();
  // Same stop behaviour as src/main.ts: SIGTERM aborts the run, and a watchdog hard-exits if it does not finish.
  process.once("SIGTERM", () => {
    controller.abort();
    setTimeout(() => process.exit(1), 45_000).unref();
  });
  const db = new Database(
    {
      host: env("KILL_DB_HOST"),
      port: Number(env("KILL_DB_PORT")),
      database: env("KILL_DB_NAME"),
      user: "runner_runtime",
      password: "runtime",
    },
    { objectStorage: { store: new FileObjects(env("KILL_OBJECT_DIR")), signal: controller.signal } }
  );
  // Test hook of the address guard: loopback is allowed; the sender, retries and recovery are unchanged production code.
  const deps = { ...defaultDeliveryDeps, send: createGuardedRequest({ isBlocked: () => false }) };
  let result = "ERROR";
  try {
    result = await execute({
      config,
      db,
      adapters: new Map([["webhook", cfg => createWebhookRuntime(cfg as any, undefined, deps)]]),
      controller,
      taskId: env("KILL_TASK_ID"),
      workerId: `worker-${process.pid}`,
      trigger: "scheduled",
      lease: { acquire: async () => {}, renew: async () => {}, release: async () => {} },
      admit: async () => config,
      reader: () =>
        ({
          sql: {} as any,
          columns: async () => [],
          preview: async () => ({ rows: [], columns: [], truncated: false }),
          close: async () => {},
          stream: async function* (_model: any, after: any, signal: AbortSignal) {
            for (let id = after ? Number(after.value) + 1 : 1; id <= rows; id++) {
              signal.throwIfAborted();
              yield {
                row: { id, name: `user-${id}` },
                deleted: false,
                checkpoint: { value: String(id), primaryKeyValues: [String(id)] },
              };
            }
          },
        } as any),
    });
  } finally {
    await db.close();
  }
  process.stdout.write(`RESULT ${result}\n`);
  process.exit(result === "COMPLETE" || result === "PENDING" ? 0 : 1);
}
main().catch(error => {
  process.stderr.write(`CHILD_ERROR ${String(error?.message ?? error)}\n`);
  process.exit(2);
});
