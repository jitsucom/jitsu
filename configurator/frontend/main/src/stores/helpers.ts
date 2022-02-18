import { sourcesStore, SourcesStore } from "stores/sources"
import { destinationsStore, DestinationsStore } from "stores/destinations"
import { without } from "lodash"
import { EntitiesStore, EntityData } from "stores/entitiesStore"
import { flowResult } from "mobx"

class ConnectionsHelper {
  private readonly sourcesStore: SourcesStore
  private readonly destinationsStore: DestinationsStore

  constructor(stores: { sources: SourcesStore; destinations: DestinationsStore }) {
    this.sourcesStore = stores.sources
    this.destinationsStore = stores.destinations
  }

  private async updateEntitiesConnections<T extends EntityData>(
    entityId: string,
    connectedEntitiesIds: string[],
    connectedEntitiesSchema: { store: EntitiesStore<T>; idField: string; connectedEntitiesIdsField: string }
  ): Promise<void> {
    const patches: { [id: string]: Partial<T> } = {}
    const { connectedEntitiesIdsField } = connectedEntitiesSchema
    connectedEntitiesSchema.store.list.forEach(entity => {
      const entityShouldBeConnected = connectedEntitiesIds.includes(entity[connectedEntitiesSchema.idField])
      const entityIsConnected = entity[connectedEntitiesIdsField].includes(entityId)

      if (entityIsConnected === entityShouldBeConnected) return

      if (entityShouldBeConnected) {
        patches[entity[connectedEntitiesSchema.idField]] = {
          [connectedEntitiesIdsField]: [...entity[connectedEntitiesIdsField], entityId],
        } as any
      } else {
        patches[entity[connectedEntitiesSchema.idField]] = {
          [connectedEntitiesIdsField]: without(entity[connectedEntitiesIdsField], entityId),
        } as any
      }
    })

    await Promise.all(
      Object.entries(patches).map(([entityId, patch]) => {
        return flowResult(connectedEntitiesSchema.store.patch(entityId, patch))
      })
    )
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

  public unconnectDeletedApiKey(apiKeyId: string) {
    this.updateDestinationsConnectionsToApiKey(apiKeyId, [])
  }

  public unconnectDeletedSource(sourceId: string) {
    this.updateDestinationsConnectionsToSource(sourceId, [])
  }

  public unconnectDeletedDestination(destinationId: string) {
    this.updateSourcesConnectionsToDestination(destinationId, [])
  }

  /**
   *
   * Below is an older boilerplate implementation. It is here just for the future reference.
   * Feel free to remove this code if you find it otside the feature/785-migrate-ui-to-objects-api branch
   *
   */

  // public async updateSourcesConnectionsToDestination(destinationId: string, connectedSourcesIds: string[]) {
  //   const sourcesPatches: { [sourceId: string]: Partial<SourceData> } = {}
  //   this.sourcesStore.listIncludeHidden.forEach(source => {
  //     const sourceShouldBeConnected = connectedSourcesIds.includes(source.sourceId)
  //     const sourceIsConnected = source.destinations.includes(destinationId)

  //     if (sourceIsConnected === sourceShouldBeConnected) return

  //     if (sourceShouldBeConnected) {
  //       sourcesPatches[source.sourceId] = {
  //         destinations: [...source.destinations, destinationId],
  //       }
  //     } else {
  //       sourcesPatches[source.sourceId] = {
  //         destinations: without(source.destinations, destinationId),
  //       }
  //     }
  //   })
  // }

  // public async updateDestinationsConnectionsToSource(sourceId: string, connectedDestinationsIds: string[]) {
  //   const destinationsPatches: { [sourceId: string]: Partial<DestinationData> } = {}
  //   this.destinationsStore.listIncludeHidden.forEach(destination => {
  //     const destinationShouldBeConnected = connectedDestinationsIds.includes(destination._uid)
  //     const destinationIsConnected = destination._sources.includes(sourceId)

  //     if (destinationIsConnected === destinationShouldBeConnected) return

  //     if (destinationShouldBeConnected) {
  //       destinationsPatches[destination._uid] = {
  //         _sources: [...destination._sources, sourceId],
  //       }
  //     } else {
  //       destinationsPatches[destination._uid] = {
  //         _sources: without(destination._sources, sourceId),
  //       }
  //     }
  //   })
  // }

  // public async updateDestinationsConnectionsToApiKey(apiKeyId: string, connectedDestinationsIds: string[]) {
  //   const destinationsPatches: { [apiKeyId: string]: Partial<DestinationData> } = {}
  //   this.destinationsStore.listIncludeHidden.forEach(destination => {
  //     const destinationShouldBeConnected = connectedDestinationsIds.includes(destination._uid)
  //     const destinationIsConnected = destination._onlyKeys.includes(apiKeyId)

  //     if (destinationIsConnected === destinationShouldBeConnected) return

  //     if (destinationShouldBeConnected) {
  //       destinationsPatches[destination._uid] = {
  //         _onlyKeys: [...destination._onlyKeys, apiKeyId],
  //       }
  //     } else {
  //       destinationsPatches[destination._uid] = {
  //         _onlyKeys: without(destination._onlyKeys, apiKeyId),
  //       }
  //     }
  //   })
  // }
}

export const connectionsHelper = new ConnectionsHelper({ sources: sourcesStore, destinations: destinationsStore })
