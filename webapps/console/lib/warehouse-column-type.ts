// Postgres and Redshift return numeric type IDs; other readers return names.
const postgresTypeNames: Record<string, string> = {
  "16": "boolean",
  "17": "bytea",
  "18": '"char"',
  "19": "name",
  "20": "bigint",
  "21": "smallint",
  "23": "integer",
  "25": "text",
  "26": "oid",
  "114": "json",
  "700": "real",
  "701": "double precision",
  "1042": "character",
  "1043": "varchar",
  "1082": "date",
  "1083": "time without time zone",
  "1114": "timestamp without time zone",
  "1184": "timestamp with time zone",
  "1186": "interval",
  "1266": "time with time zone",
  "1700": "numeric",
  "2950": "uuid",
  "3802": "jsonb",
};
const postgresArrayElementTypes: Record<string, string> = {
  "199": "114",
  "1000": "16",
  "1001": "17",
  "1002": "18",
  "1003": "19",
  "1005": "21",
  "1007": "23",
  "1009": "25",
  "1014": "1042",
  "1015": "1043",
  "1016": "20",
  "1021": "700",
  "1022": "701",
  "1028": "26",
  "1115": "1114",
  "1182": "1082",
  "1183": "1083",
  "1185": "1184",
  "1187": "1186",
  "1231": "1700",
  "1270": "1266",
  "2951": "2950",
  "3807": "3802",
};
/** A readable type name, or nothing for a numeric type ID we cannot name. */
export function displayColumnType(type: string): string {
  if (!/^\d+$/.test(type)) return type;
  const element = postgresTypeNames[postgresArrayElementTypes[type]];
  return postgresTypeNames[type] ?? (element ? `${element}[]` : "");
}
