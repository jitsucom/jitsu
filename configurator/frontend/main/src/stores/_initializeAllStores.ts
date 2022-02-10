import { flowResult } from "mobx"
import { apiKeysStore } from "./apiKeys"
import { destinationsStore } from "./destinations"
import { sourcesStore } from "./sources"

export const initializeAllStores = async (): Promise<void> => {
  apiKeysStore.injectDestinationsStore(destinationsStore)
  destinationsStore.injectSourcesStore(sourcesStore)
  sourcesStore.injectDestinationsStore(destinationsStore)
  await initalizeStoresData()
}

const initalizeStoresData = (): Promise<
  [PromiseSettledResult<void>, PromiseSettledResult<void>, PromiseSettledResult<void>]
> =>
  Promise.allSettled([
    flowResult(apiKeysStore.pullApiKeys(true)),
    flowResult(destinationsStore.pullDestinations(true)),
    flowResult(sourcesStore.pullSources(true)),
  ])
