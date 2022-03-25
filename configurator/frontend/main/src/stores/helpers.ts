import { without } from "lodash"
import { EntitiesStore, EntityData } from "stores/entitiesStore"
import { ApiKeysStore, apiKeysStore } from "stores/apiKeys"
import { sourcesStore, SourcesStore } from "stores/sources"
import { destinationsStore, DestinationsStore } from "stores/destinations"
import { flowResult } from "mobx"

class ConnectionsHelper {
  private readonly sourcesStore: SourcesStore
  private readonly destinationsStore: DestinationsStore
  private readonly apiKeysStore: ApiKeysStore

  constructor(stores: { sources: SourcesStore; destinations: DestinationsStore; apiKeysStore: ApiKeysStore }) {
    this.sourcesStore = stores.sources
    this.destinationsStore = stores.destinations
    this.apiKeysStore = stores.apiKeysStore
  }

  public async unconnectDeletedApiKey(apiKeyId: string) {
    await this.updateDestinationsConnectionsToApiKey(apiKeyId, [])
  }

  public async unconnectDeletedSource(sourceId: string) {
    await this.updateDestinationsConnectionsToSource(sourceId, [])
  }

  public async unconnectDeletedDestination(destinationId: string) {
    await this.updateSourcesConnectionsToDestination(destinationId, [])
  }

  public async updateSourcesConnectionsToDestination(destinationId: string, connectedSourcesIds: string[]) {
    await this.updateEntitiesConnections(destinationId, connectedSourcesIds, {
      store: this.sourcesStore,
      idField: "sourceId",
      connectedEntitiesIdsField: "destinations",
    })
  }

  public async updateDestinationsConnectionsToSource(sourceId: string, connectedDestinationsIds: string[]) {
    await this.updateEntitiesConnections(sourceId, connectedDestinationsIds, {
      store: this.destinationsStore,
      idField: "_uid",
      connectedEntitiesIdsField: "_sources",
    })
  }

  public async updateDestinationsConnectionsToApiKey(apiKeyId: string, connectedDestinationsIds: string[]) {
    await this.updateEntitiesConnections(apiKeyId, connectedDestinationsIds, {
      store: this.destinationsStore,
      idField: "_uid",
      connectedEntitiesIdsField: "_onlyKeys",
    })
  }

  /**
   * Finds and unconnects non-existent entities that may exist due
   * to connections management errors in UI
   */
  public async healConnections() {
    if ([this.sourcesStore, this.destinationsStore, this.apiKeysStore].some(store => !store.isInitialized)) {
      return
    }

    const destinations = this.destinationsStore.listIncludeHidden
    const sources = this.sourcesStore.listIncludeHidden
    const apiKeys = this.apiKeysStore.listIncludeHidden

    const nonExistentApiKeys: string[] = []
    const nonExistentSources: string[] = []
    const existingApiKeys = apiKeys.map(key => key.uid)
    const existingSources = sources.map(src => src.sourceId)
    destinations.forEach(destination => {
      destination._onlyKeys?.forEach(key => {
        if (!existingApiKeys.includes(key)) nonExistentApiKeys.push(key)
      })
      destination._sources?.forEach(src => {
        if (!existingSources.includes(src)) nonExistentSources.push(src)
      })
    })

    const nonExistentDestinations: string[] = []
    const existingDestinations = destinations.map(key => key._uid)
    sources.forEach(source => {
      source.destinations.forEach(dst => {
        if (!existingDestinations.includes(dst)) nonExistentDestinations.push(dst)
      })
    })

    await Promise.all([
      ...nonExistentApiKeys.map(nonExistentKey => this.unconnectDeletedApiKey(nonExistentKey)),
      ...nonExistentSources.map(nonExistentSrc => this.unconnectDeletedSource(nonExistentSrc)),
      ...nonExistentDestinations.map(nonExistentKey => this.unconnectDeletedDestination(nonExistentKey)),
    ])
  }

  /**
   * Updates entities specified in `connectedEntitiesIds` by an entity to the other entities in the list (if not already connected) or disconnects
   * this entity from all entities that are not in the list (if there are ones that connected)
   * @param entityId - entity that will be connected to the every entity in the following list
   * @param connectedEntitiesIds - list of entities that will be connected to the entity specified as the first parameter
   * @param connectedEntitiesSchema - schema of the entities in the list
   *
   * @example
   *
   * // will disconnect all connected destinations from source with `sourceId`
   * await this.updateEntitiesConnections(sourceId, [], {
   *   store: this.destinationsStore,
   *   idField: "_uid",
   *   connectedEntitiesIdsField: "_sources",
   * })
   *
   * // will connect source with id `sourceId` to all destination with `connectedDestinationsIds` and will de
   * // will disconnect all non-listed destinations in `connectedDestinationsIds` from source with `sourceId`
   * await this.updateEntitiesConnections(sourceId, connectedDestinationsIds, {
   *   store: this.destinationsStore,
   *   idField: "_uid",
   *   connectedEntitiesIdsField: "_sources",
   * })
   */
  private async updateEntitiesConnections<T extends EntityData>(
    entityId: string,
    connectedEntitiesIds: string[],
    connectedEntitiesSchema: { store: EntitiesStore<T>; idField: string; connectedEntitiesIdsField: string }
  ): Promise<void> {
    const patches: { [id: string]: Partial<T> } = {}
    const { connectedEntitiesIdsField } = connectedEntitiesSchema
    connectedEntitiesSchema.store.list.forEach(entity => {
      const entityShouldBeConnected = connectedEntitiesIds.includes(entity[connectedEntitiesSchema.idField])
      const entityIsConnected = !!entity[connectedEntitiesIdsField]?.includes(entityId)
      if (entityIsConnected === entityShouldBeConnected) return

      if (entityShouldBeConnected) {
        patches[entity[connectedEntitiesSchema.idField]] = {
          [connectedEntitiesIdsField]: [...(entity[connectedEntitiesIdsField] ?? []), entityId],
        } as any
      } else {
        patches[entity[connectedEntitiesSchema.idField]] = {
          [connectedEntitiesIdsField]: without(entity[connectedEntitiesIdsField] ?? [], entityId),
        } as any
      }
    })

    await Promise.all(
      Object.entries(patches).map(([entityId, patch]) => {
        return flowResult(connectedEntitiesSchema.store.patch(entityId, patch))
      })
    )
  }
}

export const connectionsHelper = new ConnectionsHelper({
  sources: sourcesStore,
  destinations: destinationsStore,
  apiKeysStore: apiKeysStore,
})
