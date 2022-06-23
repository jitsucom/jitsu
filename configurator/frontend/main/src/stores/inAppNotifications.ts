// @Libs
import { makeAutoObservable } from "mobx"
import React from "react"
// @Reference
import { destinationsReferenceMap } from "@jitsu/catalog"
import { allSourcesMap } from "@jitsu/catalog"
// @Routes
import { destinationPageRoutes } from "ui/pages/DestinationsPage/DestinationsPage.routes"
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
// @Stores
import { destinationsStore } from "./destinations"
import { apiKeysStore } from "./apiKeys"
import { sourcesStore } from "./sources"
import { apiKeysReferenceMap } from "@jitsu/catalog"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { apiKeysRoutes } from "lib/components/ApiKeys/ApiKeysRouter"

export type NotificationData = {
  id: string
  title?: string | React.ReactNode
  message: string
  type: "danger" | "error" | "warning" | "info"
  icon?: React.ReactNode
  editEntityRoute: string
}

interface IInAppNotificationsStore {
  notifications: NotificationData[]
  hasNotifications: boolean
}

class InAppNotificationsStore implements IInAppNotificationsStore {
  private _destinationsStore = destinationsStore
  private _apiKeysStore = apiKeysStore
  private _connectorsStore = sourcesStore

  constructor() {
    makeAutoObservable(this)
  }

  private get orphanApiKeys(): ApiKey[] {
    return this._apiKeysStore.list.filter(({ uid }) => {
      const keyIsConnected = this._destinationsStore.list.reduce(
        (isConnected, destination) => isConnected || destination._onlyKeys.some(keyUid => keyUid === uid),
        false
      )
      return !keyIsConnected
    })
  }

  private get orphanDestinations(): DestinationData[] {
    return this._destinationsStore.list.filter(({ _onlyKeys, _sources }) => !_onlyKeys?.length && !_sources?.length)
  }

  private get orphanConnectors(): SourceData[] {
    return this._connectorsStore.list.filter(({ destinations }) => !destinations?.length)
  }

  public get notifications(): NotificationData[] {
    return [
      ...this.orphanDestinations.map(({ _id, _type }) => ({
        id: _id,
        title: _id,
        message: `The destination does not have any linked Connectors or API keys and thus will not recieve data.`,
        type: "danger" as const,
        icon: destinationsReferenceMap[_type].ui.icon,
        editEntityRoute: projectRoute(`${destinationPageRoutes.editExact}`, { id: _id }),
      })),
      ...this.orphanApiKeys.map(({ uid }) => ({
        id: uid,
        title: `API Key ${uid}`,
        message: `The API key is not linked to any destination. Events from pixels using this key will be lost.`,
        type: "danger" as const,
        icon: apiKeysReferenceMap.js.icon,
        editEntityRoute: projectRoute(apiKeysRoutes.editExact, { id: uid }),
      })),
      ...this.orphanConnectors.map(({ sourceId, sourceProtoType }) => ({
        id: sourceId,
        title: sourceId,
        message: `The source does not have a linked destination to send events to. Data sync is stopped.`,
        type: "danger" as const,
        icon: allSourcesMap[sourceProtoType]?.pic,
        editEntityRoute: projectRoute(`${sourcesPageRoutes.editExact}`, { sourceId }),
      })),
    ]
  }

  public get hasNotifications(): boolean {
    return !!this.notifications.length
  }
}

export const inAppNotificationsStore = new InAppNotificationsStore()
