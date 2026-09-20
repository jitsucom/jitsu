import { DatabaseSync } from "node:sqlite";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { ensure, type Effect } from "../persistence/types";

export interface Member {
  effect: Effect;
  acceptedAt: string;
}

/** Disposable per-worker indexes. Durable evidence lives exclusively in artifacts. */
export class LocalIndex {
  private constructor(private readonly dir: string, readonly sql: DatabaseSync) {}
  static async create() {
    const dir = await mkdtemp(join(tmpdir(), "jitsu-retl-"));
    try {
      const file = join(dir, "index.sqlite");
      const sql = new DatabaseSync(file);
      await chmod(file, 0o600);
      sql.exec(`PRAGMA journal_mode=MEMORY; PRAGMA temp_store=FILE; PRAGMA cache_size=-16384; PRAGMA max_page_count=262144;
        CREATE TABLE source_keys (key TEXT PRIMARY KEY);
        CREATE TABLE desired (identity TEXT PRIMARY KEY, payload TEXT NOT NULL, value TEXT NOT NULL);
        CREATE TABLE members (identity TEXT PRIMARY KEY, payload TEXT, value TEXT, accepted_at TEXT, sequence INTEGER NOT NULL);
        CREATE TABLE operations (id TEXT PRIMARY KEY, sequence INTEGER UNIQUE, status TEXT NOT NULL, batch TEXT NOT NULL);
        CREATE TABLE touched (identity TEXT PRIMARY KEY);
      `);
      return new LocalIndex(dir, sql);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }
  transaction<T>(work: () => T): T {
    this.sql.exec("BEGIN");
    try {
      const result = work();
      this.sql.exec("COMMIT");
      return result;
    } catch (error) {
      this.sql.exec("ROLLBACK");
      throw error;
    }
  }
  append(rows: { key: string; effects: Effect[] }[]) {
    const key = this.sql.prepare("INSERT OR IGNORE INTO source_keys VALUES (?)");
    const get = this.sql.prepare("SELECT value FROM desired WHERE identity=?");
    const put = this.sql.prepare("INSERT INTO desired VALUES (?,?,?)");
    this.transaction(() => {
      for (const row of rows) {
        ensure(key.run(row.key).changes === 1, "Duplicate snapshot source key");
        for (const effect of row.effects) {
          const value = canonicalJson(effect);
          const old = get.get(effect.identityHash);
          ensure(!old || old.value === value, "Conflicting payloads for shared identity");
          if (!old) put.run(effect.identityHash, effect.payloadHash, value);
        }
      }
    });
  }
  restoreDesired(values: Effect[]) {
    const put = this.sql.prepare("INSERT INTO desired VALUES (?,?,?)");
    this.transaction(() => {
      for (const effect of values) put.run(effect.identityHash, effect.payloadHash, canonicalJson(effect));
    });
  }
  restoreMembers(values: Member[]) {
    for (const { effect, acceptedAt } of values) this.apply(effect, "upsert", 0, acceptedAt);
  }
  apply(effect: Effect, action: "upsert" | "remove", sequence: number, acceptedAt: string) {
    // Keep tombstones until the next run, so late acceptance cannot resurrect an older write.
    this.sql
      .prepare(
        `INSERT INTO members VALUES (?,?,?,?,?) ON CONFLICT(identity) DO UPDATE SET
      payload=excluded.payload,value=excluded.value,accepted_at=excluded.accepted_at,sequence=excluded.sequence
      WHERE excluded.sequence>members.sequence`
      )
      .run(
        effect.identityHash,
        action === "upsert" ? effect.payloadHash : null,
        action === "upsert" ? canonicalJson(effect) : null,
        acceptedAt,
        sequence
      );
  }
  page(kind: "additions" | "removals", after: string, limit: number, refreshBefore: string | null): Effect[] {
    const query =
      kind === "additions"
        ? `SELECT d.value FROM desired d LEFT JOIN members m ON m.identity=d.identity WHERE d.identity>?
         AND (m.value IS NULL OR m.payload<>d.payload OR m.accepted_at<=?) ORDER BY d.identity LIMIT ?`
        : `SELECT m.value FROM members m WHERE m.value IS NOT NULL AND m.identity>?
         AND NOT EXISTS(SELECT 1 FROM desired d WHERE d.identity=m.identity) ORDER BY m.identity LIMIT ?`;
    const rows =
      kind === "additions"
        ? this.sql.prepare(query).all(after, refreshBefore, limit)
        : this.sql.prepare(query).all(after, limit);
    return rows.map(row => JSON.parse(String(row.value)));
  }
  /** One local join before delivery; never count later accepted effects as the original baseline. */
  comparison(refreshBefore: string | null) {
    const row = this.sql
      .prepare(
        `SELECT count(*) AS desired,
      coalesce(sum(m.value IS NULL),0) AS added,
      coalesce(sum(m.value IS NOT NULL AND m.payload<>d.payload),0) AS changed,
      coalesce(sum(m.value IS NOT NULL AND m.payload=d.payload AND m.accepted_at<=?),0) AS refresh
      FROM desired d LEFT JOIN members m ON m.identity=d.identity`
      )
      .get(refreshBefore)!;
    const previous = this.sql
      .prepare(
        `SELECT count(*) AS baseline,
      coalesce(sum(NOT EXISTS(SELECT 1 FROM desired d WHERE d.identity=m.identity)),0) AS removed
      FROM members m WHERE m.value IS NOT NULL`
      )
      .get()!;
    const uniqueMembers = Number(row.desired),
      newMembers = Number(row.added),
      changedMembers = Number(row.changed),
      refreshMembers = Number(row.refresh);
    return {
      baselineMembers: Number(previous.baseline),
      uniqueMembers,
      newMembers,
      changedMembers,
      refreshMembers,
      unchangedMembers: uniqueMembers - newMembers - changedMembers - refreshMembers,
      removals: Number(previous.removed),
    };
  }
  *desiredPages(size = 1000): Generator<Effect[]> {
    yield* this.artifactPages(
      this.sql.prepare("SELECT value FROM desired ORDER BY identity").iterate(),
      row => JSON.parse(String(row.value)),
      size
    );
  }
  *memberPages(size = 1000): Generator<Member[]> {
    yield* this.artifactPages(
      this.sql.prepare("SELECT value,accepted_at FROM members WHERE value IS NOT NULL ORDER BY identity").iterate(),
      row => ({ effect: JSON.parse(String(row.value)), acceptedAt: String(row.accepted_at) }),
      size
    );
  }
  private *artifactPages<T>(
    rows: Iterable<Record<string, unknown>>,
    decode: (row: Record<string, unknown>) => T,
    size: number
  ): Generator<T[]> {
    // Leave envelope overhead below the 16 MB artifact limit. Stream SQLite rows
    // so even a page of unusually large values cannot allocate an entire audience.
    const maxBytes = 15_000_000;
    let page: T[] = [],
      bytes = 2;
    for (const row of rows) {
      const value = decode(row),
        length = Buffer.byteLength(canonicalJson(value));
      ensure(length + 2 <= maxBytes, "Member exceeds artifact page limit");
      if (page.length && (page.length === size || bytes + length + 1 > maxBytes)) {
        yield page;
        page = [];
        bytes = 2;
      }
      bytes += length + (page.length ? 1 : 0);
      page.push(value);
    }
    if (page.length) yield page;
  }
  stats() {
    const row = this.sql
      .prepare(
        "SELECT count(*) AS entries,coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM members WHERE value IS NOT NULL"
      )
      .get()!;
    return { entries: Number(row.entries), bytes: Number(row.bytes) };
  }
  async close() {
    this.sql.close();
    await rm(this.dir, { recursive: true, force: true });
  }
}
