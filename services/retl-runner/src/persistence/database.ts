import { Pool, type PoolClient, type PoolConfig } from "pg";
import { canonicalJson, contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { Cipher } from "./crypto";
import { defaultLimits, ensure, PersistenceError, type Limits, type Scope } from "./types";

export class Database {
  readonly pool: Pool;
  readonly limits: Limits;
  readonly stateTable: string;
  constructor(
    config: PoolConfig,
    readonly cipher: Cipher,
    options: { sourceSchema?: string; limits?: Partial<Limits> } = {}
  ) {
    this.limits = { ...defaultLimits, ...options.limits };
    for (const [key, value] of Object.entries(this.limits))
      ensure(Number.isSafeInteger(value) && value > 0 && value <= defaultLimits[key], "Invalid storage limit");
    const schema = options.sourceSchema ?? "newjitsu";
    ensure(/^[a-z_][a-z0-9_]*$/.test(schema), "Invalid state schema");
    this.stateTable = `"${schema}".source_state`;
    this.pool = new Pool({
      ...config,
      max: 4,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 10000,
      idle_in_transaction_session_timeout: 10000,
    });
  }
  aad(scope: Pick<Scope, "workspaceId" | "syncId">, kind: string): string {
    return canonicalJson([scope.workspaceId, scope.syncId, kind]);
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect().catch(() => {
      throw new PersistenceError("Reverse ETL database connection failed");
    });
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof PersistenceError) throw error;
      // PostgreSQL error detail can include identifiers and encrypted payloads.
      throw new PersistenceError("Reverse ETL persistence transaction failed");
    } finally {
      client.release();
    }
  }
  async owned<T>(scope: Scope, work: (client: PoolClient, control: any) => Promise<T>): Promise<T> {
    return this.transaction(async client => {
      const { rows } = await client.query(
        "SELECT * FROM retl.control WHERE workspace_id=$1 AND sync_id=$2 FOR UPDATE",
        [scope.workspaceId, scope.syncId]
      );
      const control = rows[0];
      ensure(control, "Run ownership lost");
      const valid = await client.query(
        "SELECT lease_until > clock_timestamp() AS valid FROM retl.control WHERE workspace_id=$1 AND sync_id=$2",
        [scope.workspaceId, scope.syncId]
      );
      ensure(
        control &&
          valid.rows[0]?.valid &&
          control.epoch === scope.fencingEpoch &&
          control.task_id === scope.taskId &&
          control.run_id === scope.logicalRunId &&
          control.revision === scope.configRevision &&
          control.target_hash === contentHash(scope.targetIdentity),
        "Run ownership lost"
      );
      const result = await work(client, control);
      // Check the original deadline too: renewal must not hide expiry during its transaction.
      const check = await client.query(
        "SELECT lease_until > clock_timestamp() AND $3::timestamptz > clock_timestamp() AS valid FROM retl.control WHERE workspace_id=$1 AND sync_id=$2",
        [scope.workspaceId, scope.syncId, control.lease_until]
      );
      ensure(check.rows[0]?.valid, "Run ownership lost");
      return result;
    });
  }
  close() {
    return this.pool.end();
  }
}
