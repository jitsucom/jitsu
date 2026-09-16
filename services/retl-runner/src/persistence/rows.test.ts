import { expectTypeOf, it } from "vitest";
import type { ControlRow, OperationRow, PgRow } from "./rows";

it("maps generated Prisma types to pg values without losing nullability", () => {
  expectTypeOf<ControlRow["next_sequence"]>().toEqualTypeOf<string>();
  expectTypeOf<ControlRow["finish_sequence"]>().toEqualTypeOf<string | null>();
  expectTypeOf<ControlRow["store"]>().toEqualTypeOf<Buffer | null>();
  expectTypeOf<OperationRow["effects"]>().toEqualTypeOf<Buffer>();
  expectTypeOf<OperationRow["accepted_at"]>().toEqualTypeOf<Date | null>();
  expectTypeOf<PgRow<{ count: number; sealed: boolean }>>().toEqualTypeOf<{ count: number; sealed: boolean }>();
  // The removed lease columns must not survive in the generated schema types.
  expectTypeOf<Extract<keyof ControlRow, "epoch" | "lease_until" | "task_id">>().toEqualTypeOf<never>();
});
