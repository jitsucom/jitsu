import type { DeliveryJournal } from "@jitsu/protocols/reverse-etl";
import { Database } from "./database";
import { Journal } from "./journal";
import { openRun } from "./run-state";
import type { Project, RunInput } from "./types";

export { Database } from "./database";
export { prune } from "./maintenance";
export type { RunInput, Scope, Identity, Effect, Limits, Project } from "./types";

export async function openPersistence(db: Database, input: RunInput, project: Project) {
  const { scope, recovery } = await openRun(db, input);
  const core = new Journal(db, scope, project, recovery);
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
    prepareFinish: core.prepareFinish.bind(core),
    acknowledgeFinish: core.acknowledgeFinish.bind(core),
    commitCheckpoint: core.commitCheckpoint.bind(core),
  });
  return { scope, delivery, core, snapshots: core.snapshots, recovery };
}
