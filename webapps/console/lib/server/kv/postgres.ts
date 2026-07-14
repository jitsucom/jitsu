import { Prisma, type PrismaClient } from "@prisma/client";
import { getErrorMessage } from "juava";
import { getServerLog } from "../log";
import { type FireAndForget, detachedPromise, type KvStore, type SetOpts } from "./types";

const log = getServerLog("kv");

// Schema is defined by the Prisma `KvStoreEntry` model and created via
// `pnpm db:update-schema`. No runtime bootstrap.

function expireDate(ttlMs?: number): Date | null {
  if (!ttlMs || ttlMs <= 0) return null;
  return new Date(Date.now() + ttlMs);
}

// Probabilistic GC: roughly 5% of mutating ops fire-and-forget a bulk
// delete of expired rows. Keeps the table from growing unboundedly without
// needing a cron. The "lazy on read" filter still hides expired rows in
// the meantime.
function maybeGc(prisma: PrismaClient) {
  if (Math.random() < 0.05) {
    prisma.kvStoreEntry.deleteMany({ where: { expiresAt: { lte: new Date() } } }).catch(e => {
      log.atWarn().log(`KV GC sweep failed: ${getErrorMessage(e)}`);
    });
  }
}

export class PgKvStore implements KvStore {
  constructor(private readonly prisma: PrismaClient, private readonly schedule: FireAndForget = detachedPromise) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    maybeGc(this.prisma);
    const row = await this.prisma.kvStoreEntry.findUnique({ where: { key } });
    if (!row) return undefined;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      this.schedule(() => this.prisma.kvStoreEntry.deleteMany({ where: { key } }));
      return undefined;
    }
    return row.value as T;
  }

  async set(key: string, value: unknown, opts: SetOpts = {}): Promise<boolean> {
    maybeGc(this.prisma);
    const expiresAt = expireDate(opts.ttlMs);
    if (opts.ifNotExists) {
      // Atomicity comes from the unique constraint on `key`: a concurrent
      // create from another caller fails with P2002, so at most one
      // ifNotExists call wins for a given key.
      //
      // Caveat: an existing-but-expired row blocks the create (returns false).
      // For the current callers (OAuth codes — keys are random 48-char ids),
      // this is fine; the keyspace is large enough that collisions never
      // happen in practice. Callers that want overwrite-if-expired semantics
      // should `del` first.
      try {
        await this.prisma.kvStoreEntry.create({
          data: { key, value: value as never, expiresAt },
        });
        return true;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return false;
        }
        throw e;
      }
    }
    await this.prisma.kvStoreEntry.upsert({
      where: { key },
      create: { key, value: value as never, expiresAt },
      update: { value: value as never, expiresAt },
    });
    return true;
  }

  async del(key: string): Promise<boolean> {
    const r = await this.prisma.kvStoreEntry.deleteMany({ where: { key } });
    return r.count > 0;
  }

  async getDel<T = unknown>(key: string): Promise<T | undefined> {
    // Prisma's delete() compiles to a single DELETE ... RETURNING — atomic.
    // Two concurrent getDel calls on the same key: at most one sees a row.
    // This is the property OAuth code consumption relies on.
    try {
      const row = await this.prisma.kvStoreEntry.delete({ where: { key } });
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
        // Deleted an already-expired row — treat as absent.
        return undefined;
      }
      return row.value as T;
    } catch (e) {
      // P2025 = record not found. Anyone else racing us already consumed it
      // (or it expired). Either way: nothing for us to return.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return undefined;
      }
      throw e;
    }
  }

  async scanByPrefix<T = unknown>(
    prefix: string,
    opts: { limit?: number } = {}
  ): Promise<Array<{ key: string; value: T }>> {
    maybeGc(this.prisma);
    const rows = await this.prisma.kvStoreEntry.findMany({
      where: {
        key: { startsWith: prefix },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { key: "asc" },
      ...(opts.limit !== undefined ? { take: opts.limit } : {}),
    });
    return rows.map(r => ({ key: r.key, value: r.value as T }));
  }
}
