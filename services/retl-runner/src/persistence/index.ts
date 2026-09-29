import type { DeliveryJournal } from "@jitsu/protocols/reverse-etl";
import { Database } from "./database";
import { openRun } from "./run-state";
import type { Project, RunInput } from "./types";
import { ObjectJournal } from "../artifacts/journal";
import { Artifacts } from "../artifacts/store";
import { encodeJson } from "./serialization";

export { Database } from "./database";
export type { RunInput, Scope, Identity, Effect, Limits, Project } from "./types";

export async function openPersistence(db: Database, input: RunInput, project: Project) {
  input = { ...input };
  // Persist the empty manifest before admission, then insert its pointer atomically
  // with the new control row. Null heads are unambiguously legacy state.
  const artifacts = new Artifacts(db.objectStorage.store, input, db.objectStorage.signal);
  const initialHead = encodeJson(
    await artifacts.put({ version: 1, runId: input.logicalRunId, baseline: [], batches: [] })
  );
  const { scope, recovery } = await openRun(db, input, initialHead);
  const core = await ObjectJournal.open(db, scope, project, recovery);
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
