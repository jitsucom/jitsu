import AnalyticsService from "lib/services/analytics"
import { flowResult } from "mobx"
import { apiKeysStore } from "./apiKeys"
import { destinationsStore } from "./destinations"
import { connectionsHelper } from "./helpers"
import { sourcesStore } from "./sources"

export const initializeAllStores = async (analyticsService: AnalyticsService): Promise<void> => {
  await initalizeStoresData()
  try {
    await connectionsHelper.healConnections()
  } catch (error) {
    analyticsService.onGlobalError(new Error(`Failed to heal connections after stores initialization: ${error}`))
  }
}

const initalizeStoresData = (): Promise<
  [PromiseSettledResult<void>, PromiseSettledResult<void>, PromiseSettledResult<void>]
> =>
  Promise.allSettled([
    flowResult(apiKeysStore.pullAll({ showGlobalLoader: true })),
    flowResult(destinationsStore.pullAll({ showGlobalLoader: true })),
    flowResult(sourcesStore.pullAll({ showGlobalLoader: true })),
  ])
