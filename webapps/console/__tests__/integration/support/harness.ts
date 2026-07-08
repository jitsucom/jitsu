import { randomId } from "juava";
import type { SessionUser } from "../../../lib/schema";
// Importing lib/server here is safe (and the whole point): setup.ts has already
// pointed env at this file's databases, so the prod singletons bind to them.
import { db } from "../../../lib/server/db";
import { clickhouse } from "../../../lib/server/clickhouse";

/** The real production singletons, bound to this test file's databases. */
export function deps() {
  return { prisma: db.prisma(), pgPool: db.pgPool(), clickhouse };
}

export type SeededWorkspace = {
  user: SessionUser;
  workspace: { id: string; name: string; slug: string | null };
};

/**
 * Create a userProfile + workspace + workspaceAccess and return them in the
 * shapes services expect. Each call creates a fresh, isolated workspace — tests
 * never share data. `admin: true` seeds a platform admin (no workspaceAccess
 * needed); `member: false` skips the workspaceAccess row (for negative access
 * tests).
 */
export async function seedWorkspace(
  opts: { admin?: boolean; member?: boolean; role?: "owner" | "editor" | "analyst" } = {}
): Promise<SeededWorkspace> {
  const prisma = db.prisma();
  const suffix = randomId(8).toLowerCase();
  const profile = await prisma.userProfile.create({
    data: {
      name: `Test User ${suffix}`,
      email: `test-${suffix}@example.com`,
      loginProvider: "credentials",
      externalId: `ext-${suffix}`,
      admin: opts.admin ?? false,
    },
  });
  const workspace = await prisma.workspace.create({
    data: { name: `ws-${suffix}`, slug: `ws-${suffix}` },
    select: { id: true, name: true, slug: true },
  });
  if (opts.member !== false) {
    await prisma.workspaceAccess.create({
      data: { userId: profile.id, workspaceId: workspace.id, ...(opts.role ? { role: opts.role } : {}) },
    });
  }
  const user: SessionUser = {
    internalId: profile.id,
    externalId: profile.externalId,
    externalUsername: profile.name,
    loginProvider: profile.loginProvider,
    email: profile.email,
    name: profile.name,
    authType: "bearer",
    tokenId: `tok-${suffix}`,
  };
  return { user, workspace };
}

export async function seedConfigObject(workspaceId: string, type: string, config: any, opts: { id?: string } = {}) {
  return db.prisma().configurationObject.create({
    data: { ...(opts.id ? { id: opts.id } : {}), workspaceId, type, config },
  });
}

export async function seedLink(
  workspaceId: string,
  fromId: string,
  toId: string,
  opts: { type?: string; data?: any; id?: string } = {}
) {
  return db.prisma().configurationObjectLink.create({
    data: {
      ...(opts.id ? { id: opts.id } : {}),
      workspaceId,
      fromId,
      toId,
      type: opts.type ?? "push",
      data: opts.data,
    },
  });
}

export async function seedProfileBuilder(workspaceId: string, name = "pb") {
  return db.prisma().profileBuilder.create({
    data: { workspaceId, name, intermediateStorageCredentials: {} },
  });
}

// ─── ClickHouse fixtures ─────────────────────────────────────────────────────
// Rows land in this file's per-file database via the prod clickhouse client.
// Timestamps: pass ClickHouse-format strings, e.g. "2026-07-08 10:00:00.000".

async function chInsert(table: string, values: any[]) {
  await clickhouse.insert({
    table,
    values,
    format: "JSONEachRow",
    clickhouse_settings: { wait_end_of_query: 1 },
  });
}

export async function insertEventsLog(
  rows: { timestamp: string; actorId: string; type: string; level: string; message: string }[]
) {
  await chInsert("events_log", rows);
}

export async function insertDeadLetter(
  rows: { timestamp: string; workspaceId: string; actorId: string; type: string; payload: string; error: string }[]
) {
  await chInsert("dead_letter", rows);
}

export async function insertTaskLog(
  rows: { task_id: string; sync_id: string; timestamp: string; level: string; logger: string; message: string }[]
) {
  await chInsert("task_log", rows);
}

/** Insert into the Null `metrics` table — rows materialize into mv_metrics through the MV, same path prod uses. */
export async function insertMetrics(
  rows: {
    timestamp: string;
    messageId: string;
    workspaceId: string;
    streamId: string;
    connectionId: string;
    functionId?: string;
    destinationId: string;
    status: string;
    events: number;
    eventIndex?: number;
  }[]
) {
  await chInsert(
    "metrics",
    rows.map(r => ({ functionId: "", eventIndex: 0, ...r }))
  );
}
