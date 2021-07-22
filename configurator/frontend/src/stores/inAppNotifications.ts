// @Libs
import { makeAutoObservable } from 'mobx';
import React from 'react';
// @Reference
import { destinationsReferenceMap } from 'catalog/destinations/lib';
import { allSources } from 'catalog/sources/lib';
// @Routes
import { destinationPageRoutes } from 'ui/pages/DestinationsPage/DestinationsPage.routes';
import { sourcesPageRoutes } from 'ui/pages/SourcesPage/SourcesPage.routes';
// @Stores
import { destinationsStore } from './destinations';
import { sourcesStore } from './sources';

export type NotificationData = {
  id: string;
  title?: string | React.ReactNode;
  message: string;
  type: 'danger' | 'error' | 'warning' | 'info';
  icon?: React.ReactNode;
  editEntityRoute: string;
};

interface IInAppNotificationsStore {
  notifications: NotificationData[];
  hasNotifications: boolean;
}

class InAppNotificationsStore implements IInAppNotificationsStore {
  private _destinationsStore = destinationsStore;
  private _sourcesStore = sourcesStore;

  constructor() {
    makeAutoObservable(this);
  }

  private get orphanDestinations(): DestinationData[] {
    return this._destinationsStore.destinations.filter(
      ({ _onlyKeys, _sources }) => !_onlyKeys?.length && !_sources?.length
    );
  }

  private get orphanConnectors(): SourceData[] {
    return this._sourcesStore.sources.filter(
      ({ destinations }) => !destinations?.length
    );
  }

  public get notifications(): NotificationData[] {
    return [
      ...this.orphanDestinations.map(({ _id, _type }) => ({
        id: _id,
        title: _id,
        message: `The destination does not have any linked Connectors or API keys and thus will not recieve data.`,
        type: 'danger' as const,
        icon: destinationsReferenceMap[_type].ui.icon,
        editEntityRoute: `${destinationPageRoutes.edit}/${_id}`
      })),
      ...this.orphanConnectors.map(({ sourceId, sourceType }) => ({
        id: sourceId,
        title: sourceId,
        message: `The source does not have any linked destinations to send events to. Data sync is stopped.`,
        type: 'danger' as const,
        icon: allSources.find(({ id }) => id === sourceType)?.pic,
        editEntityRoute: `${sourcesPageRoutes.edit}/${sourceId}`
      }))
    ];
  }

  public get hasNotifications(): boolean {
    return !!this.notifications.length;
  }
}

export const inAppNotificationsStore = new InAppNotificationsStore();
