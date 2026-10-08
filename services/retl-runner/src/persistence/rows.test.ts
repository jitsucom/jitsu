import { expectTypeOf, it } from "vitest";
import type { ControlRow, PgRow } from "./rows";

it("maps generated Prisma types to pg values without losing nullability", () => {
  expectTypeOf<ControlRow["next_sequence"]>().toEqualTypeOf<string>();
  expectTypeOf<ControlRow["finish_sequence"]>().toEqualTypeOf<string | null>();
  expectTypeOf<ControlRow["store"]>().toEqualTypeOf<Buffer | null>();
  expectTypeOf<PgRow<{ count: number; sealed: boolean }>>().toEqualTypeOf<{ count: number; sealed: boolean }>();
  expectTypeOf<ControlRow["artifact_head"]>().toEqualTypeOf<Buffer | null>();
  expectTypeOf<
    Extract<
      keyof ControlRow,
      "membership_entries" | "membership_bytes" | "journal_bytes" | "reserved_entries" | "reserved_bytes"
    >
  >().toEqualTypeOf<never>();
  // The removed lease columns must not survive in the generated schema types.
  expectTypeOf<Extract<keyof ControlRow, "epoch" | "lease_until" | "task_id">>().toEqualTypeOf<never>();
});
