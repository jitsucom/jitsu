import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createWarehouseReader } from "@jitsu/warehouse-query";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { Database } from "./persistence";
import { execute } from "./execute";
import { createAdapterRegistry } from "./adapters";
import { createConsoleClient } from "./console-client";
import { KubernetesLease, inClusterLeaseRequest } from "./lease";

const Env = z.object({
  RETL_CONFIG_PATH: z.string().default("/config/reverse.json"),
  RETL_DATABASE_URL: z.string().url(),
  RETL_CONSOLE_URL: z.string().url(),
  RETL_CONSOLE_TOKEN: z.string().min(1),
  TASK_ID: z.string().min(1).max(512),
  POD_UID: z.string().min(1),
  KUBE_NAMESPACE: z.string().min(1),
  KUBERNETES_SERVICE_HOST: z.string().min(1),
  KUBERNETES_SERVICE_PORT: z.string().default("443"),
  RETL_TRIGGER: z.enum(["manual", "scheduled", "recovery"]).default("scheduled"),
  RETL_RECOVERY_OF: z.string().min(1).optional(),
  RETL_MAX_RUN_SECONDS: z.coerce.number().int().min(60).max(172800).default(172800),
});

async function main() {
  // eslint-disable-next-line no-restricted-properties -- standalone runner startup boundary.
  const env = Env.parse(process.env);
  const raw = await readFile(env.RETL_CONFIG_PATH);
  if (raw.length > 1_000_000) throw new Error("Run configuration too large");
  const config = ReverseRunConfig.parse(JSON.parse(raw.toString()));
  const db = new Database({ connectionString: env.RETL_DATABASE_URL });
  const controller = new AbortController();
  const consoleClient = createConsoleClient(env.RETL_CONSOLE_URL, env.RETL_CONSOLE_TOKEN, config);
  const adapters = createAdapterRegistry((_, signal) => consoleClient.accessToken(signal));
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  // Do not release leases while a hung provider callback could still write.
  // Hard exit leaves them to expire and preserves prepared recovery evidence.
  let grace: ReturnType<typeof setTimeout> | undefined;
  controller.signal.addEventListener(
    "abort",
    () => {
      grace = setTimeout(() => process.exit(1), 45_000);
    },
    { once: true }
  );
  const deadline = setTimeout(stop, env.RETL_MAX_RUN_SECONDS * 1000);
  try {
    const result = await execute({
      config,
      db,
      adapters,
      controller,
      taskId: env.TASK_ID,
      trigger: env.RETL_TRIGGER,
      recoveryOf: env.RETL_RECOVERY_OF,
      lease: new KubernetesLease(
        inClusterLeaseRequest(env.KUBERNETES_SERVICE_HOST, env.KUBERNETES_SERVICE_PORT),
        env.KUBE_NAMESPACE,
        config.id,
        env.POD_UID
      ),
      reader: createWarehouseReader,
      admit: () => consoleClient.admit(controller.signal),
    });
    process.exitCode = result === "SUCCESS" || result === "WAITING" ? 0 : 1;
  } finally {
    // Retain the hard-stop watchdog while closing outstanding resources.
    await db.close();
    clearTimeout(deadline);
    clearTimeout(grace);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
main().catch(() => {
  process.stderr.write("Reverse ETL runner failed; check configuration and durable recovery state\n");
  process.exit(1);
});
