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
}

export const connectionsHelper = new ConnectionsHelper({ sources: sourcesStore, destinations: destinationsStore })
