import { getLog } from "juava";
import { StoreMetrics } from "@jitsu/core-functions";

import { Counter, Gauge, Histogram } from "prom-client";

const log = getLog("metrics");

export const promStoreStatuses = new Counter({
  name: "profiles_store_statuses",
  help: "profiles store statuses",
  labelNames: ["namespace", "operation", "status"] as const,
});
export const promWarehouseStatuses = new Histogram({
  name: "profiles_warehouse_statuses",
  help: "profiles warehouse statuses",
  labelNames: ["id", "table", "status"] as const,
  buckets: [0.02, 0.05, 0.2, 0.5, 1, 2], // durations in seconds
});
export const promQueueSize = new Gauge({
  name: "profiles_queue_size",
  help: "profiles queue size",
  // add `as const` here to enforce label names
  labelNames: ["builderId", "priority"] as const,
});
export const promQueueProcessed = new Counter({
  name: "profiles_queue_processed",
  help: "profiles queuue processed",
  labelNames: ["builderId", "priority"] as const,
});
export const promProfileStatuses = new Histogram({
  name: "profiles_statuses",
  help: "profiles statuses",
  buckets: [0.2, 1, 2, 5, 10, 60, 300], // durations in seconds
  labelNames: ["builderId", "priority", "status"] as const,
});

export const metrics: StoreMetrics = {
  storeStatus: (namespace: string, operation: string, status: string) => {
    promStoreStatuses.labels(namespace, operation, status).inc();
  },
  warehouseStatus: (id: string, table: string, status: string, timeMs: number) => {
    promWarehouseStatuses.labels(id, table, status).observe(timeMs / 1000);
  },
};
