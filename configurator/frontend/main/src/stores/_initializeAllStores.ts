import { flowResult } from "mobx"
import { apiKeysStore } from "./apiKeys"
import { destinationsStore } from "./destinations"
import { connectionsHelper } from "./helpers"
import { sourcesStore } from "./sources"

export const initializeAllStores = async (): Promise<void> => {
  await initalizeStoresData()
  await connectionsHelper.healConnections()
}

const initalizeStoresData = (): Promise<
  [PromiseSettledResult<void>, PromiseSettledResult<void>, PromiseSettledResult<void>]
> =>
  Promise.allSettled([
    flowResult(apiKeysStore.pullAll({ showGlobalLoader: true })),
    flowResult(destinationsStore.pullAll({ showGlobalLoader: true })),
    flowResult(sourcesStore.pullAll({ showGlobalLoader: true })),
  ])
