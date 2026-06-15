import fs from "fs";
import * as JSON5 from "json5";
import { z } from "zod";
import { getServerLog } from "./log";
import { getServerEnv } from "./serverEnv";

const log = getServerLog("maintenance");

export const MaintenanceState = z.object({
  planned_start: z.string().optional(),
  planned_end: z.string().optional(),
  description: z.string().optional(),
  active: z.boolean().optional(),
  visible: z.boolean().optional(),
  show_in_advance: z.boolean().optional(),
  // Whether backend consumers (Rotor/Bulker) must also be paused. Surfaced here,
  // but acting on it is a separate ticket — the console does not pause consumers.
  stop_consuming: z.boolean().optional(),
  // Declared DB availability during maintenance. The console enforces read-only
  // at the API layer regardless (writes always blocked while `active`); this
  // field communicates *intent* so "maintenance mode" isn't conflated with "DB
  // is gone":
  //   - "read_only" (default when unset): DB is up; reads work, writes blocked.
  //     The DB-down → maintenance page fallback still triggers if a query
  //     happens to fail, but it isn't expected.
  //   - "off": DB is genuinely unavailable. Endpoints that depend on the DB
  //     should expect failures and short-circuit where possible to avoid wasting
  //     work or producing partial state.
  database_access: z.enum(["read_only", "off"]).optional(),
});
export type MaintenanceState = z.infer<typeof MaintenanceState>;

// Visible subset exposed to the browser / maintenance page.
export const PublicMaintenanceState = MaintenanceState.pick({
  planned_start: true,
  planned_end: true,
  description: true,
  active: true,
  show_in_advance: true,
  database_access: true,
});
export type PublicMaintenanceState = z.infer<typeof PublicMaintenanceState>;

let cache: { value: MaintenanceState | undefined; ts: number } | undefined;
// Short TTL so edits to the mounted ConfigMap propagate without a restart
// (k8s refreshes mounted ConfigMap files within ~1 minute).
const TTL_MS = 10_000;

type LoadResult = { ok: true; value: MaintenanceState | undefined } | { ok: false; reason: "invalid" };

function load(): LoadResult {
  const serverEnv = getServerEnv();
  let raw: string | undefined;
  const file = serverEnv.MAINTENANCE_CONFIG_FILE;
  if (file) {
    try {
      if (fs.existsSync(file)) {
        raw = fs.readFileSync(file, "utf-8").trim();
      }
    } catch (e) {
      log.atWarn().withCause(e).log(`Can't read maintenance config file ${file}`);
    }
  }
  if (!raw && serverEnv.MAINTENANCE) {
    raw = serverEnv.MAINTENANCE.trim();
  }
  if (!raw) {
    // No source — operator explicitly cleared / never set the descriptor.
    // This is the legitimate "no maintenance" state.
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: MaintenanceState.parse(JSON5.parse(raw)) };
  } catch (e) {
    log.atWarn().withCause(e).log(`Invalid maintenance descriptor — keeping last known state`);
    return { ok: false, reason: "invalid" };
  }
}

// Fail-closed placeholder for the cold-start invalid-descriptor case. Operators
// must already have intended *some* maintenance window (the descriptor is
// present), so admitting writes during a parse error is unsafe.
const INVALID_DESCRIPTOR_FALLBACK: MaintenanceState = {
  active: true,
  visible: false,
  description: "Maintenance descriptor is unparseable; failing closed until it's fixed.",
};

export function getMaintenanceState(): MaintenanceState | undefined {
  const now = Date.now();
  if (!cache || now - cache.ts > TTL_MS) {
    const result = load();
    if (result.ok) {
      cache = { value: result.value, ts: now };
    } else {
      // Descriptor is present but unparseable — fail closed. If we have a prior
      // good value, keep it (so an active window isn't disrupted by a typo);
      // if not (cold start with a broken descriptor), synthesize an active
      // stub so writes stay blocked until the descriptor is fixed. Either way,
      // we don't admit writes just because the JSON broke.
      cache = { value: cache?.value ?? INVALID_DESCRIPTOR_FALLBACK, ts: now };
    }
  }
  return cache.value;
}

// The master switch for read-only enforcement.
export function isMaintenanceActive(): boolean {
  return getMaintenanceState()?.active === true;
}

// True iff maintenance is active AND the descriptor declares the DB is offline.
// Use this in endpoints that would otherwise touch the DB to short-circuit before
// the connection attempt (e.g. the sync admission gate at /api/admin/sync-quota-check).
// Returns false when database_access is unset or "read_only" — reads should still
// work in those cases.
export function isDatabaseOff(): boolean {
  const state = getMaintenanceState();
  return state?.active === true && state.database_access === "off";
}

// Descriptor exposed to the browser. Hidden entirely when visible === false.
export function getPublicMaintenanceState(): PublicMaintenanceState | undefined {
  const state = getMaintenanceState();
  if (!state || state.visible === false) {
    return undefined;
  }
  return PublicMaintenanceState.parse(state);
}
