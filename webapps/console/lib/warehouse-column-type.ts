// Postgres and Redshift return numeric type IDs; other readers return names.
const postgresTypeNames: Record<string, string> = {
  "16": "bool",
  "17": "bytea",
  "20": "int8",
  "21": "int2",
  "23": "int4",
  "25": "text",
  "114": "json",
  "700": "float4",
  "701": "float8",
  "1042": "char",
  "1043": "varchar",
  "1082": "date",
  "1083": "time",
  "1114": "timestamp",
  "1184": "timestamptz",
  "1186": "interval",
  "1700": "numeric",
  "2950": "uuid",
  "3802": "jsonb",
};
/** A readable type name, or nothing for a numeric type ID we cannot name. */
export function displayColumnType(type: string): string {
  return /^\d+$/.test(type) ? postgresTypeNames[type] ?? "" : type;
}
