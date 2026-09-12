import type { ModelDefinition } from "./schema";
import type { CompiledModelQuery, WarehouseSqlDialect } from "./types";

export const keyCountColumn = "__jitsu_retl_key_count";

interface SqlParameters extends Pick<CompiledModelQuery, "values" | "queryParams"> {
  bind(value: string, warehouseType: string, index: number): string;
}
/** Database-specific rules live alongside each warehouse reader. */
interface SqlDialectRules {
  parse(query: string): unknown;
  lineCommentPrefixes: string[];
  backslashEscapes(query: string, index: number): boolean;
  dollarQuote?(query: string, index: number): string | undefined;
  quoteColumn(name: string): string;
  supportsPrimaryKeyType(warehouseType: string): boolean;
  supportsDeleteType(warehouseType: string): boolean;
  supportsCursorType(cursorType: NonNullable<ModelDefinition["cursor"]>["type"], warehouseType: string): boolean;
  validateCheckpointType?(warehouseType: string): void;
  createParameters(): SqlParameters;
  lookbackPredicate(column: string, parameter: string, seconds: number): string;
}

/** Shared read-only AST policy; database permissions remain the execution boundary. */
function validateSelect(query: string, parse: SqlDialectRules["parse"]) {
  if (!query.trim() || query.length > 100_000 || query.includes("\0")) throw new Error("Invalid model query");
  let ast: any;
  try {
    ast = parse(query);
  } catch {
    throw new Error("Query must be a single supported read-only SELECT (including SELECT CTEs)");
  }
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1 || statements[0]?.type !== "select") throw new Error("Only one SELECT is allowed");
  function check(value: any) {
    if (!value || typeof value !== "object") return;
    if (
      ["insert", "update", "delete", "replace", "create", "drop", "alter", "call", "set", "execute", "into"].includes(
        value.type
      ) ||
      value.into?.position ||
      value.locking_read ||
      value.for_update
    ) {
      throw new Error("Query must be read-only");
    }
    for (const child of Object.values(value)) check(child);
  }
  check(statements[0]);
}

/** Remove only delimiters outside comments/literals; never reserialize the AST. */
function withoutDelimiter(query: string, rules: SqlDialectRules): string {
  let result = "";
  let start = 0;
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (rules.lineCommentPrefixes.some(prefix => query.startsWith(prefix, i))) {
      while (i < query.length && !["\n", "\r"].includes(query[i])) i++;
    } else if (query.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < query.length && depth) {
        if (query.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (query.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      i--;
    } else if (["'", '"', "`"].includes(c)) {
      const escapes = rules.backslashEscapes(query, i);
      for (i++; i < query.length; i++) {
        if (escapes && query[i] === "\\") i++;
        else if (query[i] === c) {
          if (query[i + 1] === c) i++;
          else break;
        }
      }
    } else if (rules.dollarQuote?.(query, i)) {
      const delimiter = rules.dollarQuote(query, i)!;
      const end = query.indexOf(delimiter, i + delimiter.length);
      if (end < 0) throw new Error("Unterminated SQL literal");
      i = end + delimiter.length - 1;
    } else if (c === ";") {
      result += query.slice(start, i);
      start = i + 1;
    }
  }
  return result + query.slice(start);
}

/** Compose a pure SQL dialect from warehouse rules and common model invariants. */
export function createSqlDialect(rules: SqlDialectRules): WarehouseSqlDialect {
  const dialect: WarehouseSqlDialect = {
    supportsDeleteType: rules.supportsDeleteType,
    validateQuery(query) {
      validateSelect(query, rules.parse);
      // Preserve spelling/case folding and SQL literals. Only remove delimiters.
      return withoutDelimiter(query, rules);
    },
    validateColumns(model, columns) {
      const names = columns.map(c => c.name);
      if (new Set(names).size !== names.length)
        throw new Error("Query returns duplicate column names; use unique aliases");
      if (names.includes(keyCountColumn)) throw new Error(`${keyCountColumn} is reserved`);
      for (const name of [...model.primaryKey, model.cursor?.column, model.deleteColumn].filter(Boolean) as string[]) {
        if (!names.includes(name)) throw new Error(`Query must project column '${name}'`);
      }
      // Every key must decode to a scalar, even when it is never bound in a
      // checkpoint (full-query models and timestamp lookback).
      for (const name of model.primaryKey) {
        const type = columns.find(c => c.name === name)!.type;
        if (!rules.supportsPrimaryKeyType(type))
          throw new Error(
            `Primary-key column '${name}' has unsupported warehouse type '${type}'; cast it to a supported scalar type`
          );
      }
      if (model.deleteColumn) {
        const type = columns.find(c => c.name === model.deleteColumn)!.type;
        if (!rules.supportsDeleteType(type))
          throw new Error(
            `Delete column '${model.deleteColumn}' has unsupported warehouse type '${type}'; use a boolean expression or a supported 0/1 column`
          );
      }

      if (model.cursor) {
        const type = columns.find(c => c.name === model.cursor!.column)!.type;
        if (!rules.supportsCursorType(model.cursor.type, type))
          throw new Error(`Cursor type '${model.cursor.type}' does not match warehouse type '${type}'`);
        // Validate before saving/reading, not only when a checkpoint is resumed.
        // Lookback binds only the cursor; other incremental queries also bind keys.
        for (const name of model.cursor.lookbackSeconds !== undefined
          ? [model.cursor.column]
          : [model.cursor.column, ...model.primaryKey]) {
          rules.validateCheckpointType?.(columns.find(c => c.name === name)!.type);
        }
      }
    },
    compileModel(model, columns, after) {
      const sql = dialect.validateQuery(model.query);
      dialect.validateColumns(model, columns);
      const parameters = rules.createParameters();
      const q = rules.quoteColumn;
      const keys = model.primaryKey.map(q).join(", ");
      let where = "";
      const order = model.cursor ? [model.cursor.column, ...model.primaryKey] : model.primaryKey;
      if (after) {
        if (!model.cursor || after.primaryKeyValues.length !== model.primaryKey.length)
          throw new Error("Checkpoint does not match model");
        const checkpointValues = [after.value, ...after.primaryKeyValues];
        const params = (model.cursor.lookbackSeconds !== undefined ? order.slice(0, 1) : order).map((name, i) => {
          const value = checkpointValues[i];
          if (typeof value !== "string") throw new Error("Checkpoint values must be lossless strings");
          return parameters.bind(value, columns.find(c => c.name === name)!.type, i);
        });
        if (model.cursor.lookbackSeconds !== undefined) {
          where = rules.lookbackPredicate(q(model.cursor.column), params[0], model.cursor.lookbackSeconds);
        } else {
          where = order
            .map(
              (name, i) =>
                `(${[...order.slice(0, i).map((n, j) => `${q(n)} = ${params[j]}`), `${q(name)} > ${params[i]}`].join(
                  " AND "
                )})`
            )
            .join(" OR ");
        }
      }
      // Count keys before the incremental filter so duplicate identities cannot hide
      // in different cursor windows. The database handles the working set, not Node.
      return {
        query: `SELECT * FROM (SELECT *, count(*) OVER (PARTITION BY ${keys}) AS ${q(
          keyCountColumn
        )} FROM (${sql}\n) AS model) AS checked_model${where ? ` WHERE ${where}` : ""} ORDER BY ${order
          .map(n => `${q(n)} ASC`)
          .join(", ")}`,
        values: parameters.values,
        queryParams: parameters.queryParams,
      };
    },
  };
  return dialect;
}

export function decodeDelete(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0" || value === null) return false;
  throw new Error("Delete column must contain booleans or numeric 0/1 values");
}
