// @Libs
import React, { Dispatch, SetStateAction, useMemo } from 'react';
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
// @Types
import { PageProps } from '@./navigation';
import { BreadcrumbsProps } from '@component/Breadcrumbs/Breadcrumbs.types';

export interface CollectionDestinationData {
  destinations: DestinationData[];
  _lastUpdated?: string;
}

export interface CommonDestinationPageProps {
  setBreadcrumbs: (breadcrumbs: BreadcrumbsProps) => void;
  destinations: DestinationData[];
  updateDestinations: Dispatch<SetStateAction<any>>;
  editorMode?: 'edit' | 'add';
  sources: SourceData[];
  sourcesError: any;
  updateSources: Dispatch<SetStateAction<any>>;
}

export const DestinationsPage = (props: PageProps) => {
  const services = ApplicationServices.get();

  const [sourcesError, sourcesData, updateSources] = useLoader(async() => await services.storageService.get('sources', services.activeProject.id));
  const [error, destinations, updateDestinations] = useLoader(async() => await services.storageService.get('destinations', services.activeProject.id));

  const additionalProps = useMemo(() => ({
    setBreadcrumbs: props.setBreadcrumbs,
    destinations: destinations?.destinations ?? [],
    updateDestinations,
    sources: sourcesData?.sources ?? [],
    sourcesError,
    updateSources
  }), [props.setBreadcrumbs, destinations, updateDestinations, sourcesData, sourcesError, updateSources]);

  if (error) {
    return <CenteredError error={error} />;
  } else if (!destinations || (!sourcesData && !sourcesError)) {
    return <CenteredSpin />;
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
        render={getComponent<CommonDestinationPageProps>(DestinationEditor, { ...additionalProps, editorMode: 'add' })}
      />
      <Route
        path={destinationPageRoutes.editDestination}
        strict={false}
        exact
        render={getComponent<CommonDestinationPageProps>(DestinationEditor, { ...additionalProps, editorMode: 'edit' })}
      />
    </Switch>
  );
};

export default DestinationsPage;
