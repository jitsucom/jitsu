// @Libs
import { flow, flowResult, makeObservable } from "mobx"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Stores
import { EntitiesStore } from "./entitiesStore"
import { apiKeysStore, ApiKeysStore } from "./apiKeys"
// @Catalog
import { destinationsReferenceMap, DestinationReference } from "@jitsu/catalog"
// @Utils
import { randomId } from "utils/numbers"
// @Types
import type { PgDatabaseCredentials } from "lib/services/model"

const services = ApplicationServices.get()
export class DestinationsStore extends EntitiesStore<DestinationData> {
  private readonly apiKeysStore: ApiKeysStore = apiKeysStore

  constructor() {
    super("destinations", {
      idField: "_uid",
      hideElements: dst => destinationsReferenceMap[dst._type]?.hidden,
    })
    makeObservable(this, {
      createFreeDatabase: flow,
    })
  }

  public getDestinationReferenceById(id: string): DestinationReference | null {
    const destination: DestinationData | null = this.get(id)
    return destination ? destinationsReferenceMap[destination._type] : null
  }

  public *createFreeDatabase() {
    const credentials: PgDatabaseCredentials = yield services.backendApiClient.post("/database", {
      projectId: services.activeProject.id,
    })
    const freeDatabaseDestination: DestinationData = {
      _type: "postgres",
      _comment:
        "We set up a test postgres database for you. It's hosted by us and has a 10,000 rows limitation. It's ok" +
        " to try with service with it. However, don't use it in production setup. To reveal credentials, click on the 'Edit' button",
      _id: "demo_postgres",
      _uid: randomId(),
      _mappings: null,
      _onlyKeys: [],
      _connectionTestOk: true,
      _sources: [],
      _formData: {
        pguser: credentials["User"],
        pgpassword: credentials["Password"],
        pghost: credentials["Host"],
        pgport: credentials["Port"],
        pgdatabase: credentials["Database"],
        mode: "stream",
      },
    }
    yield flowResult(this.apiKeysStore.generateAddInitialApiKeyIfNeeded())
    const linkedFreeDatabaseDestination: DestinationData = {
      ...freeDatabaseDestination,
      _onlyKeys: [this.apiKeysStore.list[0].uid],
    }
    yield flowResult(this.add(linkedFreeDatabaseDestination))
  }
}

export const destinationsStore = new DestinationsStore()
