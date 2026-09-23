import type { reverse_sync_control, reverse_sync_target_owner, source_state } from "@prisma/client";

// Prisma is the schema/type source only. pg's default decoders return int8 as
// strings and bytea as Buffer, unlike Prisma's bigint and Uint8Array values.
type PgValue<T> = T extends bigint ? string : T extends Uint8Array ? Buffer : T;
export type PgRow<T> = { [K in keyof T]: PgValue<T[K]> };

export type ControlRow = PgRow<reverse_sync_control>;
export type TargetOwnerRow = PgRow<reverse_sync_target_owner>;
export type StateRow = PgRow<source_state>;
