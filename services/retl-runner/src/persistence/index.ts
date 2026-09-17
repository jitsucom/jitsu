import type { DeliveryJournal } from "@jitsu/protocols/reverse-etl";
import { Database } from "./database";
import { Journal } from "./journal";
import { openRun } from "./run-state";
import type { Project, RunInput } from "./types";
import { ObjectJournal } from "../artifacts/journal";
import { ensure, PersistenceResetRequiredError } from "./types";

export { Database } from "./database";
export { prune } from "./maintenance";
export type { RunInput, Scope, Identity, Effect, Limits, Project } from "./types";

export async function openPersistence(db: Database, input: RunInput, project: Project) {
  input = { ...input };
  await db.transaction(async client => {
    const old = (
      await client.query("SELECT phase,artifact_head FROM reverse_sync_control WHERE workspace_id=$1 AND sync_id=$2", [
        input.workspaceId,
        input.syncId,
      ])
    ).rows[0];
    if (old?.artifact_head)
      ensure(db.objectStorage, "Object storage is required for this sync; no PostgreSQL fallback");
    if (db.objectStorage && old && !old.artifact_head) {
      const legacy = await client.query(
        `SELECT 1 FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2
        UNION ALL SELECT 1 FROM reverse_sync_generation WHERE workspace_id=$1 AND sync_id=$2
        UNION ALL SELECT 1 FROM reverse_sync_membership WHERE workspace_id=$1 AND sync_id=$2 LIMIT 1`,
        [input.workspaceId, input.syncId]
      );
      if (old.phase !== "new" || legacy.rowCount) throw new PersistenceResetRequiredError();
    }
  });
  const { scope, recovery } = await openRun(db, input);
  const core: Journal = db.objectStorage
    ? await ObjectJournal.open(db, scope, project, recovery)
    : new Journal(db, scope, project, recovery);
  // Deliberately return a narrow facade: no database client/snapshot access
  // on the object passed to trusted providers as ctx.delivery.
  const delivery: DeliveryJournal = Object.freeze({
    assertReady: core.assertReady.bind(core),
    prepareInit: core.prepareInit.bind(core),
    acknowledgeInit: core.acknowledgeInit.bind(core),
    prepareAbort: core.prepareAbort.bind(core),
    acknowledgeAbort: core.acknowledgeAbort.bind(core),
    prepare: core.prepare.bind(core),
    acknowledge: core.acknowledge.bind(core),
    markUnknown: core.markUnknown.bind(core),
    saveProviderState: core.saveProviderState.bind(core),
    sealExtraction: core.sealExtraction.bind(core),
    prepareFinish: core.prepareFinish.bind(core),
    acknowledgeFinish: core.acknowledgeFinish.bind(core),
    commitCheckpoint: core.commitCheckpoint.bind(core),
  });
  return { scope, delivery, core, snapshots: core.snapshots, recovery };
}
