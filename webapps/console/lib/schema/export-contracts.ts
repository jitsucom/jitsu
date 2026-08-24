import { z } from "zod";

// Consumer contracts for /api/admin/export rows (JITSU-181, postmortem
// JITSU-158 item 5). Every row is validated against its contract at the write
// site, before it reaches the response stream: a row that fails is skipped and
// logged with the "System error:" alerting marker instead of being shipped
// malformed to bulker / rotor / config-keeper.
//
// The schemas pin only what consumers rely on and use .passthrough()
// everywhere: the contract must never strip a field a consumer may understand.

const DateIsh = z.union([z.date(), z.string().min(1)]);
const AnyRecord = z.record(z.unknown());

// Post-jitsu#1441 a link row of a known destination type always materializes
// the destination schema's defaults, and the generic fallback only ships
// non-empty stored objects — so empty options can only mean options were lost
// between the database and serialization (the 2026-07-30 incident shape),
// never a legitimate row.
const NonEmptyRecord = AnyRecord.refine(r => Object.keys(r).length > 0, {
  message: "options must not be empty",
});

// bulker-connections: link rows, standalone destination rows and synthesized
// otlp rows all share this shape.
export const BulkerConnectionRow = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    type: z.string().min(1),
    options: NonEmptyRecord,
    updatedAt: DateIsh,
    credentials: AnyRecord,
  })
  .passthrough();

// Event-archive connections arrive prebuilt from ee-api; the console vouches
// only for their identity field.
export const BackupConnectionRow = z
  .object({
    id: z.string().min(1),
  })
  .passthrough();

const RotorRowBase = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  workspaceId: z.string().min(1),
  // deliberately allows "": prod carries at least one legacy link row whose
  // from.id is empty (checked 2026-08-24), and enforcing the contract must
  // not change what ships on day one — tighten once such rows are cleaned up
  streamId: z.string(),
  // ConfigurationObject.config.name is optional in storage; JSON.stringify
  // drops the undefined key.
  streamName: z.string().optional(),
  destinationId: z.string().min(1),
  usesBulker: z.boolean(),
  updatedAt: DateIsh,
  credentials: AnyRecord,
  credentialsHash: z.string().min(1),
});

// rotor-connections: link rows and profile-builder rows carry options and its
// hash (rotor rebuilds the function chain when optionsHash changes).
export const RotorConnectionRow = RotorRowBase.extend({
  options: NonEmptyRecord,
  optionsHash: z.string().min(1),
}).passthrough();

// rotor-connections: standalone destination rows deliberately carry no
// options — rotor derives behaviour from the destination type.
export const RotorDestinationRow = RotorRowBase.passthrough();
