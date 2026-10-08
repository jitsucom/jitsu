import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { Client } from "pg";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as http from "node:http";
import type { AddressInfo, Socket } from "node:net";

// A real process is killed with a real signal while a request to the endpoint is in flight, then the next processes must
// recover with no human step. What this does NOT cover: a Kubernetes pod (no Lease, no kubelet, no 60 s grace period).
const ROWS = Number(process.env.WEBHOOK_KILL_ROWS ?? 3000);
const hangAt = Math.floor(ROWS / 2);

let container: StartedTestContainer;
let admin: Client;
let childFile: string;
let objectDir: string;
let work: string;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "retl-kill-"));
  objectDir = join(work, "objects");
  childFile = join(work, "child.cjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./webhook-kill-child.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["pg-native"],
    outfile: childFile,
    logLevel: "silent",
  });
  container = await new GenericContainer("postgres:18-alpine")
    .withEnvironment({ POSTGRES_PASSWORD: "test", POSTGRES_DB: "runner_test" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const config = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: "runner_test",
    user: "postgres",
    password: "test",
  };
  admin = new Client(config);
  await admin.connect();
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve("prisma/build/index.js"),
      "db",
      "push",
      `--schema=${fileURLToPath(new URL("../../../webapps/console/prisma/schema.prisma", import.meta.url))}`,
      "--skip-generate",
    ],
    {
      // eslint-disable-next-line no-restricted-properties -- disposable test database only.
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://postgres:test@${config.host}:${config.port}/${config.database}?schema=newjitsu`,
      },
      stdio: "ignore",
    }
  );
  await admin.query(
    "CREATE ROLE runner_runtime LOGIN PASSWORD 'runtime'; GRANT USAGE ON SCHEMA newjitsu TO runner_runtime"
  );
  for (const table of ["control", "target_owner"])
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON newjitsu.reverse_sync_${table} TO runner_runtime`);
  await admin.query(
    "GRANT SELECT,INSERT,UPDATE ON newjitsu.source_state,newjitsu.source_task TO runner_runtime; GRANT INSERT ON newjitsu.task_log TO runner_runtime"
  );
}, 120_000);
afterAll(async () => {
  await admin?.end();
  await container?.stop();
  if (work) await rm(work, { recursive: true, force: true });
});

// The endpoint: records every delivered record, and holds ONE request open forever after processing it (the answer never
// arrives), which is the moment the process is killed.
const receiver = {
  server: undefined as unknown as http.Server,
  sockets: new Set<Socket>(),
  ids: new Map<number, number>(),
  keys: new Map<string, number>(),
  hung: false,
  onHung: () => {},
};
const startReceiver = async () => {
  receiver.ids.clear();
  receiver.keys.clear();
  receiver.hung = false;
  const hungPromise = new Promise<void>(resolve => (receiver.onHung = resolve));
  receiver.server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const records = JSON.parse(Buffer.concat(chunks).toString()).records as {
        idempotencyKey: string;
        data: { id: number };
      }[];
      for (const record of records) {
        receiver.ids.set(record.data.id, (receiver.ids.get(record.data.id) ?? 0) + 1);
        receiver.keys.set(record.idempotencyKey, (receiver.keys.get(record.idempotencyKey) ?? 0) + 1);
      }
      if (!receiver.hung && records.some(record => record.data.id === hangAt)) {
        receiver.hung = true;
        receiver.onHung();
        return; // never answer
      }
      res.statusCode = 200;
      res.end();
    });
  });
  receiver.server.on("connection", socket => {
    receiver.sockets.add(socket);
    socket.on("close", () => receiver.sockets.delete(socket));
  });
  await new Promise<void>(resolve => receiver.server.listen(0, "127.0.0.1", resolve));
  return { hung: hungPromise };
};
afterEach(async () => {
  for (const socket of receiver.sockets) socket.destroy();
  await new Promise<void>(resolve => receiver.server?.close(() => resolve()));
});
beforeEach(async () => {
  await admin.query(
    "TRUNCATE newjitsu.reverse_sync_control,newjitsu.reverse_sync_target_owner,newjitsu.source_state,newjitsu.source_task,newjitsu.task_log"
  );
  await rm(objectDir, { recursive: true, force: true });
});

/** Reject if the endpoint is not hit in time, with what the child printed so far, instead of hanging until the test timeout. */
const stall = (child: { output: () => string }, ms = 90_000) =>
  new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            `no request reached the hang point after ${ms / 1000}s; endpoint saw ${
              receiver.ids.size
            } rows; child output: ${child.output().slice(0, 1500)}`
          )
        ),
      ms
    ).unref()
  );

function startChild(taskId: string): {
  child: ChildProcess;
  output: () => string;
  done: Promise<{ code: number | null; signal: string | null; out: string }>;
} {
  const child = spawn(process.execPath, ["--no-warnings", childFile], {
    env: {
      // eslint-disable-next-line no-restricted-properties -- test child needs PATH and node options only.
      ...process.env,
      KILL_ROWS: String(ROWS),
      KILL_RECEIVER_URL: `http://127.0.0.1:${(receiver.server.address() as AddressInfo).port}/hook`,
      KILL_DB_HOST: container.getHost(),
      KILL_DB_PORT: String(container.getMappedPort(5432)),
      KILL_DB_NAME: "runner_test",
      KILL_OBJECT_DIR: objectDir,
      KILL_TASK_ID: taskId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout!.on("data", chunk => (out += chunk));
  child.stderr!.on("data", chunk => (out += chunk));
  const done = new Promise<{ code: number | null; signal: string | null; out: string }>(resolve =>
    child.on("exit", (code, signal) => resolve({ code, signal, out }))
  );
  return { child, done, output: () => out };
}
const taskError = async (taskId: string) =>
  String((await admin.query("SELECT error FROM newjitsu.source_task WHERE task_id=$1", [taskId])).rows[0]?.error ?? "");
const missingIds = () => {
  const missing: number[] = [];
  for (let id = 1; id <= ROWS && missing.length < 5; id++) if (!receiver.ids.has(id)) missing.push(id);
  return missing;
};

/** After an interruption: plain scheduled runs, as production would start them, until one completes. */
async function runUntilComplete(prefix: string) {
  const runs: { result: string; error: string }[] = [];
  for (let i = 1; i <= 4; i++) {
    const taskId = `${prefix}-after-${i}`;
    const { done } = startChild(taskId);
    const { code, out } = await done;
    const result = /RESULT (\w+)/.exec(out)?.[1] ?? `NO_RESULT(exit ${code}): ${out.slice(0, 200)}`;
    runs.push({ result, error: result === "FAILED" ? await taskError(taskId) : "" });
    if (result === "COMPLETE") break;
  }
  return runs;
}

describe("a process killed while a request to the endpoint is in flight", () => {
  it("SIGKILL: the next run fails once with a readable message and the one after delivers every row", async () => {
    const { hung } = await startReceiver();
    const { child, done, output } = startChild("kill-1");
    await Promise.race([
      hung,
      done.then(r => Promise.reject(new Error(`child exited before the endpoint was hit: exit ${r.code} ${r.out}`))),
    ]); // the endpoint has processed the batch and will never answer
    child.kill("SIGKILL");
    const killed = await done;
    expect(killed.signal).toBe("SIGKILL");
    expect(receiver.ids.has(hangAt)).toBe(true);
    expect(receiver.ids.size).toBeLessThan(ROWS);

    const runs = await runUntilComplete("kill");
    process.stdout.write(`KILL-RESULT ${JSON.stringify(runs)}\n`);
    expect(runs.at(-1)!.result).toBe("COMPLETE");
    expect(runs.filter(run => run.result === "FAILED").length).toBeLessThanOrEqual(1);
    for (const run of runs.filter(run => run.result === "FAILED"))
      expect(run.error).toContain("Recovery completed cleanup; next run will restart extraction");
    expect(missingIds()).toEqual([]);
    // The repeats carry the same idempotency keys: exactly one key per row, however many times it was sent.
    expect(receiver.keys.size).toBe(ROWS);
  }, 300_000);

  it("SIGTERM: the process stops itself promptly, and the same recovery follows", async () => {
    const { hung } = await startReceiver();
    const { child, done, output } = startChild("term-1");
    await Promise.race([
      hung,
      done.then(r => Promise.reject(new Error(`child exited before the endpoint was hit: exit ${r.code} ${r.out}`))),
    ]);
    const started = Date.now();
    child.kill("SIGTERM");
    const stopped = await done;
    const seconds = (Date.now() - started) / 1000;
    process.stdout.write(
      `TERM-STOP exit=${stopped.code} signal=${stopped.signal} after=${seconds}s out=${stopped.out.trim()}\n`
    );
    expect(stopped.signal).toBeNull(); // it exited by itself, was not killed by the signal
    expect(seconds).toBeLessThan(45); // within the watchdog
    expect(stopped.code).not.toBe(0);

    const runs = await runUntilComplete("term");
    process.stdout.write(`TERM-RESULT ${JSON.stringify(runs)}\n`);
    expect(runs.at(-1)!.result).toBe("COMPLETE");
    expect(runs.filter(run => run.result === "FAILED").length).toBeLessThanOrEqual(1);
    expect(missingIds()).toEqual([]);
    expect(receiver.keys.size).toBe(ROWS);
  }, 300_000);
});
