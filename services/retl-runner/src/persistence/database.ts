import { Pool, type PoolClient, type PoolConfig } from "pg";
import { defaultLimits, ensure, PersistenceError, type Limits } from "./types";

export class Database {
  readonly pool: Pool;
  readonly limits: Limits;
  readonly stateTable: string;
  private readonly searchPath: string;
  constructor(config: PoolConfig, options: { sourceSchema?: string; limits?: Partial<Limits> } = {}) {
    this.limits = { ...defaultLimits, ...options.limits };
    for (const [key, value] of Object.entries(this.limits))
      ensure(Number.isSafeInteger(value) && value > 0 && value <= defaultLimits[key], "Invalid storage limit");
    const schema =
      options.sourceSchema ??
      (config.connectionString ? new URL(config.connectionString).searchParams.get("schema") ?? "public" : "newjitsu");
    ensure(/^[a-z_][a-z0-9_]*$/.test(schema), "Invalid state schema");
    this.stateTable = `"${schema}".source_state`;
    // Every transaction uses the same validated config schema. Keep pg_catalog
    // first and pg_temp last so pooled session state/temp tables cannot shadow it.
    this.searchPath = `pg_catalog, "${schema}", pg_temp`;
    this.pool = new Pool({
      ...config,
      max: 4,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 10000,
      idle_in_transaction_session_timeout: 10000,
    });
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect().catch(() => {
      throw new PersistenceError("Reverse ETL database connection failed");
    });
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('search_path',$1,true)", [this.searchPath]);
      await client.query("SET LOCAL lock_timeout = '3s'");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof PersistenceError) throw error;
      // PostgreSQL error detail can include identifiers and sensitive payloads.
      throw new PersistenceError("Reverse ETL persistence transaction failed");
    } finally {
      client.release();
    }
  }
  close() {
    return this.pool.end();
  }
}
