// @Libs
import React, { useMemo } from 'react';
import { Route, Switch } from 'react-router-dom';
// @Pages
import { DestinationsList } from './partials/DestinationsList';
import { DestinationEditor } from './partials/DestinationEditor';
// @Routes
import { destinationPageRoutes } from './DestinationsPage.routes';
// @Hooks
import useLoader from '@hooks/useLoader';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Hocs
import { getComponent } from '@hocs/getComponent';
// @Components
import { CenteredError, CenteredSpin } from '@./lib/components/components';
import { EmptyList } from '@molecule/EmptyList';
import { DropDownList } from '@molecule/DropDownList';
// @Utils
import { destinationsReferenceList, getGeneratedPath } from '@page/DestinationsPage/commons';
// @Types
import { PageProps } from '@./navigation';
import { BreadcrumbsProps } from '@molecule/Breadcrumbs/Breadcrumbs.types';

export interface CollectionDestinationData {
  destinations: DestinationData[];
  _lastUpdated?: string;
}

export interface CommonDestinationPageProps {
  destinations: DestinationData[];
  setBreadcrumbs: (breadcrumbs: BreadcrumbsProps) => void;
}

export const DestinationsPage = (props: PageProps) => {
  const services = useMemo(() => ApplicationServices.get(), []);

  const [error, destinations] = useLoader(
    async() => await services.storageService.get('destinations', services.activeProject.id)
  );

  const additionalProps = useMemo(() => ({
    destinations: destinations?.destinations,
    setBreadcrumbs: props.setBreadcrumbs
  }), [props.setBreadcrumbs, destinations]);

  if (error) {
    return <CenteredError error={error} />;
  } else if (!destinations) {
    return <CenteredSpin />;
  } else if (destinations.destinations.length === 0) {
    return <EmptyList
      list={
        <DropDownList
          getPath={getGeneratedPath}
          list={destinationsReferenceList}
          filterPlaceholder="Filter by destination name"
        />
      }
      title="Destinations list is still empty"
      unit="destination"
    />;
  }

  return (
    <Switch>
      <Route
        path={destinationPageRoutes.root}
        exact
        render={getComponent<CommonDestinationPageProps>(DestinationsList, additionalProps)}
      />
      <Route
        path={destinationPageRoutes.newDestination}
        strict={false}
        exact
        render={getComponent<CommonDestinationPageProps>(DestinationEditor, additionalProps)}
      />
      <Route
        path={destinationPageRoutes.editDestination}
        strict={false}
        exact
        render={getComponent<CommonDestinationPageProps>(DestinationEditor, additionalProps)}
      />
    </Switch>
  );
};

export default DestinationsPage;
