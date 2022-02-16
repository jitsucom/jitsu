// @Libs
import { flowResult, makeAutoObservable } from "mobx"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Utils
import { union } from "lodash"
import { toArrayIfNot } from "utils/arrays"
import { destinationsReferenceMap, DestinationReference } from "@jitsu/catalog/destinations/lib"
import { EntitiesStore } from "./entitiesStore"
import { ApiKeysStore } from "./apiKeys"

const services = ApplicationServices.get()
class DestinationsStore extends EntitiesStore<DestinationData> {
  constructor() {
    super("destinations", {
      idField: "_uid",
      connectedEntitiesFields: { sources: "_sources", api_keys: "_only_keys" },
      hideElements: dst => destinationsReferenceMap[dst._type]?.hidden,
    })
    this.get = this.get.bind(this)
  }

  public getDestinationReferenceById(id: string): DestinationReference | null {
    const destination: DestinationData | null = this.get(id)
    return destination ? destinationsReferenceMap[destination._type] : null
  }

  public *createFreeDatabase() {
    const apiKeysStore = this._connectedStores.find(store => store.type === "api_keys") as any as ApiKeysStore
    if (!apiKeysStore) {
      console.error("Warning: destinations store is missing API keys store reference")
      return
    }
    const { destinations } = (yield services.initializeDefaultDestination()) as {
      destinations: DestinationData[]
    }
    const freeDatabaseDestination = destinations[0]
    yield flowResult(apiKeysStore.generateAddInitialApiKeyIfNeeded())
    const linkedFreeDatabaseDestination: DestinationData = {
      ...freeDatabaseDestination,
      _onlyKeys: [apiKeysStore.list[0].uid],
    }
    yield flowResult(this.add(linkedFreeDatabaseDestination))
  }

  /**
   * Either creates or removes destinations links to a specified API Key
   * A dedicated method is created because API Keys do not store UIDs of connected destinations
   **/
  public *updateDestinationsLinksToKey(apiKeyUid: string, _linkedDestinationsUids: string | string[]) {
    const linkedDestinationsUids = toArrayIfNot(_linkedDestinationsUids)
    const destinationsPatches: { [uid: string]: Partial<DestinationData> } = {}
    this._entities.forEach(destination => {
      const destinationIsLinkedToKey: boolean = destination._onlyKeys.includes(apiKeyUid)
      const destinationShouldBeLinked: boolean = linkedDestinationsUids.includes(destination._uid)

      if (destinationIsLinkedToKey === destinationShouldBeLinked) {
        return
      }

      if (destinationShouldBeLinked) {
        destinationsPatches[destination._uid] = {
          _onlyKeys: [...destination._onlyKeys, apiKeyUid],
        }
      } else {
        destinationsPatches[destination._uid] = {
          _onlyKeys: destination._onlyKeys.filter(uid => uid !== apiKeyUid),
        }
      }
    })

    yield Promise.all(
      Object.entries(destinationsPatches).map(([_uid, patch]) =>
        flowResult(this.patch(_uid, patch, { updateConnections: false }))
      )
    )
  }

  /**
   *
   *
   * TO DO: double check if this is a duplicate of the `updateDestinationsLinksToKey`
   *
   */
  public *linkApiKeysToDestinations(_apiKeysUids: string | string[], _destinationsUids: string | string[]) {
    const apiKeysUids = toArrayIfNot(_apiKeysUids)
    const destinations = toArrayIfNot(_destinationsUids).map(this.get)
    const destinationsPatches: { [destinationUid: string]: Partial<DestinationData> } = {}

    destinations.forEach(destination => {
      destinationsPatches[destination._uid] = {
        _onlyKeys: union(destination._onlyKeys, apiKeysUids),
      }
    })

    yield Promise.all(
      Object.entries(destinationsPatches).map(([destinationUid, patch]) =>
        flowResult(this.patch(destinationUid, patch, { updateConnections: false }))
      )
    )
  }
}

export const destinationsStore = new DestinationsStore()
