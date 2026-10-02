import type { PoolClient } from "pg";
import type { Database } from "./database";
import type { ControlRow } from "./rows";
import { ensure, type Scope } from "./types";

interface Entry {
  tail: Promise<void>;
  row?: ControlRow;
}
// Recovery and maintenance share the same per-sync queue/cache within a runner.
const entries = new WeakMap<Database, Map<string, Entry>>();

export function controlFor(db: Database, scope: Scope): ControlCache {
  let syncs = entries.get(db);
  if (!syncs) entries.set(db, (syncs = new Map()));
  const key = JSON.stringify([scope.workspaceId, scope.syncId, scope.logicalRunId]);
  let entry = syncs.get(key);
  if (!entry) syncs.set(key, (entry = { tail: Promise.resolve() }));
  return new ControlCache(db, scope, entry);
}

/** Process-local optimization, not worker ownership. Kubernetes admission remains required. */
export class ControlCache {
  private pending?: ControlRow;
  constructor(private readonly db: Database, private readonly scope: Scope, private readonly entry: Entry) {}

  transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.pending = this.entry.row;
      try {
        const value = await this.db.transaction(work);
        // Publish only after COMMIT is acknowledged, never from uncommitted state.
        this.entry.row = this.pending;
        return value;
      } catch (error) {
        // A lost COMMIT response is ambiguous too: the next access reloads durable state.
        this.entry.row = undefined;
        throw error;
      } finally {
        this.pending = undefined;
      }
    });
  }

  /** Pure state/status observations need no database round trip on a cache hit. */
  observe<T>(project: (row: ControlRow) => T): Promise<T> {
    return this.enqueue(async () => {
      try {
        if (!this.entry.row || this.entry.row.run_id !== this.scope.logicalRunId)
          this.entry.row = await this.db.transaction(client => readControl(client, this.scope));
        return project(this.entry.row);
      } catch (error) {
        this.entry.row = undefined;
        throw error;
      }
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.entry.tail.then(work);
    this.entry.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async read(client: PoolClient): Promise<ControlRow> {
    if (!this.pending || this.pending.run_id !== this.scope.logicalRunId)
      this.pending = await readControl(client, this.scope);
    return this.pending;
  }

  /** Complex mutations refresh under a lock and invalidate rather than duplicate SQL bookkeeping. */
  lock(client: PoolClient): Promise<ControlRow> {
    this.invalidate();
    return lockControl(client, this.scope);
  }

  invalidate() {
    this.pending = undefined;
  }

  /** A complete row returned by the current transaction's SQL write. */
  remember(row: ControlRow) {
    ensure(
      row.workspace_id === this.scope.workspaceId &&
        row.sync_id === this.scope.syncId &&
        row.run_id === this.scope.logicalRunId,
      "Run state missing or changed"
    );
    this.pending = row;
  }
}

/** Observe lifecycle state without locking it; mutations validate their own preconditions. */
export function readControl(client: PoolClient, scope: Scope) {
  return selectControl(client, scope, false);
}

/** Serialize multi-statement lifecycle mutations, not worker ownership. */
export function lockControl(client: PoolClient, scope: Scope) {
  return selectControl(client, scope, true);
}

async function selectControl(client: PoolClient, scope: Scope, forUpdate: boolean) {
  const { rows } = await client.query<ControlRow>(
    `SELECT * FROM reverse_sync_control WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3${
      forUpdate ? " FOR UPDATE" : ""
    }`,
    [scope.workspaceId, scope.syncId, scope.logicalRunId]
  );
  ensure(rows[0], "Run state missing or changed");
  return rows[0];
}
