import type { ModelDefinition, PreviewResult, WarehouseColumn } from "./schema";

export interface CompositeCursor {
  value: string;
  primaryKeyValues: string[];
}
export interface SourceRecord {
  row: Record<string, unknown>;
  deleted: boolean;
  checkpoint?: CompositeCursor;
}
export interface CompiledModelQuery {
  query: string;
  values: string[];
  queryParams: Record<string, string>;
}

/** Pure SQL policy/compiler. Does not open connections or execute queries. */
export interface WarehouseSqlDialect {
  /** Validate one supported read-only SELECT and remove its statement delimiter. */
  validateQuery(query: string): string;
  validateColumns(model: ModelDefinition, columns: WarehouseColumn[]): void;
  /** Type can represent a tombstone; actual values still need decodeDelete validation. */
  supportsDeleteType(warehouseType: string): boolean;
  /** Wrap the model with duplicate-key checks, ordering and bound checkpoint values. */
  compileModel(model: ModelDefinition, columns: WarehouseColumn[], after?: CompositeCursor): CompiledModelQuery;
}
export interface WarehouseReader {
  readonly sql: WarehouseSqlDialect;
  columns(query: string, signal?: AbortSignal): Promise<WarehouseColumn[]>;
  preview(query: string, signal?: AbortSignal): Promise<PreviewResult>;
  stream(model: ModelDefinition, after?: CompositeCursor, signal?: AbortSignal): AsyncIterable<SourceRecord>;
  close(): Promise<void>;
}
