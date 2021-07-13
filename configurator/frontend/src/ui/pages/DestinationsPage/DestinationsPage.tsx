// @Libs
import { Dispatch, SetStateAction, useEffect, useMemo } from 'react';
import { Route, Switch } from 'react-router-dom';
// @Pages
import { DestinationsList } from './partials/DestinationsList/DestinationsList';
import { DestinationEditor } from './partials/DestinationEditor/DestinationEditor';
// @Routes
import { destinationPageRoutes } from './DestinationsPage.routes';
// @Hooks
import useLoader from 'hooks/useLoader';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Components
import { CenteredError, CenteredSpin } from 'lib/components/components';
// @Types
import { PageProps } from 'navigation';
import { BreadcrumbsProps } from 'ui/components/Breadcrumbs/Breadcrumbs';
import { observer } from 'mobx-react-lite';
import { destinationsStore, DestinationsStoreState } from 'stores/destinationsStore';

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

const DestinationsPageComponent = (props: PageProps) => {
  const services = ApplicationServices.get();

  const [sourcesError, sourcesData, updateSources] = useLoader(async() => await services.storageService.get('sources', services.activeProject.id));

  const additionalProps = useMemo(() => ({
    setBreadcrumbs: props.setBreadcrumbs,
    destinations: destinationsStore.destinations,
    updateDestinations: () => {},
    sources: sourcesData?.sources ?? [],
    sourcesError,
    updateSources
  }), [props.setBreadcrumbs, sourcesData, sourcesError, updateSources]);

  useEffect(() => {
    destinationsStore.pullDestinations(true);
  }, []);

  if (destinationsStore.state === DestinationsStoreState.GLOBAL_ERROR) {
    return <CenteredError error={destinationsStore.error} />;
  } else if (destinationsStore.state === DestinationsStoreState.GLOBAL_LOADING || (!sourcesData && !sourcesError)) {
    return <CenteredSpin />;
  }

  return (
    <Switch>
      <Route
        path={destinationPageRoutes.root}
        exact
      >
        <DestinationsList {...additionalProps}/>
      </Route>
      <Route
        path={destinationPageRoutes.newDestination}
        strict={false}
        exact
      >
        <DestinationEditor {...{...additionalProps, editorMode: 'add'}}/>
      </Route>
      <Route
        path={destinationPageRoutes.editDestination}
        strict={false}
        exact
      >
        <DestinationEditor {...{...additionalProps, editorMode: 'edit'}}/>
      </Route>
    </Switch>
  );
};

const DestinationsPage = observer(DestinationsPageComponent);

export default DestinationsPage;
