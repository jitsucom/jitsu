/** Exact core-owned reasons only. Never expose arbitrary SDK/SQL messages or causes. */
const failures = new Map<string, string>([
  [
    "Async batches require distinct member identities",
    "Multiple source rows identify the same audience member. Update the model to return one row per normalized audience identity (for example, email or phone), then retry.",
  ],
  ...[
    "Audience is exclusively managed by a mirror sync",
    "Audience already belongs to another mirror sync",
    "Audience already belongs to another mirror or upsert sync",
  ].map(
    reason =>
      [
        reason,
        "This audience is reserved by another sync. Choose a different audience or ask your Jitsu administrator to review and release the previous sync's ownership.",
      ] as [string, string]
  ),
  [
    "Source row failed destination validation",
    "A source row has invalid identifiers or consent. Check the model output, field mappings and raw versus hashed identifier settings, then retry.",
  ],
  [
    "Destination rejected a row; the run stopped without skipping it",
    "The destination rejected a row, so the sync stopped. Check identifier mappings and consent. Some other rows may already have been accepted.",
  ],
  [
    "Batch delivery is uncertain; reconcile its journal before retrying",
    "The destination did not confirm a submitted batch. Some changes may have been accepted. Contact support or your Jitsu administrator before retrying; do not reset sync state.",
  ],
  [
    "Reverse ETL artifact upload failed; no delivery is authorized",
    "Sync progress could not be saved to object storage. Ask your Jitsu administrator to check storage connectivity and permissions before retrying. Earlier batches may already have been submitted.",
  ],
  [
    "Reverse ETL recovery artifact is missing or corrupt; delivery blocked",
    "Saved sync data is missing or unreadable, so delivery was stopped. Contact support or your Jitsu administrator; do not reset sync state.",
  ],
  [
    "Target/config changes require controlled reset",
    "This configuration is incompatible with the saved sync state. Revert the configuration change or contact your Jitsu administrator before resetting state.",
  ],
  [
    "Previous logical run requires recovery",
    "A previous run still has unresolved work. Contact support or your Jitsu administrator to finish that run before starting another; do not reset sync state.",
  ],
]);

export function reverseEtlFailure(error: unknown): { reason: string; message: string } | undefined {
  if (!(error instanceof Error)) return;
  const message = failures.get(error.message);
  if (message) return { reason: error.message, message };
}
