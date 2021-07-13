// @Libs
import { useEffect, useMemo } from 'react';
import { Route, Switch } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
// @Pages
import { DestinationsList } from './partials/DestinationsList/DestinationsList';
import { DestinationEditor } from './partials/DestinationEditor/DestinationEditor';
// @Store
import { destinationsStore, DestinationsStoreState } from 'stores/destinationsStore';
import { sourcesStore, SourcesStoreState} from 'stores/sourcesStore';
// @Routes
import { destinationPageRoutes } from './DestinationsPage.routes';
// @Components
import { CenteredError, CenteredSpin } from 'lib/components/components';
// @Types
import { PageProps } from 'navigation';
import { BreadcrumbsProps } from 'ui/components/Breadcrumbs/Breadcrumbs';

export interface CollectionDestinationData {
  destinations: DestinationData[];
  _lastUpdated?: string;
}

export interface CommonDestinationPageProps {
  setBreadcrumbs: (breadcrumbs: BreadcrumbsProps) => void;
  editorMode?: 'edit' | 'add';
}

const DestinationsPageComponent = ({setBreadcrumbs}: PageProps) => {

  if (destinationsStore.state === DestinationsStoreState.GLOBAL_ERROR) {
    return <CenteredError error={destinationsStore.error} />;
  } else if (
    destinationsStore.state === DestinationsStoreState.GLOBAL_LOADING || 
    sourcesStore.state === SourcesStoreState.GLOBAL_LOADING
  ) {
    return <CenteredSpin />;
  }

  return (
    <Switch>
      <Route
        path={destinationPageRoutes.root}
        exact
      >
        <DestinationsList {...{setBreadcrumbs}}/>
      </Route>
      <Route
        path={destinationPageRoutes.newDestination}
        strict={false}
        exact
      >
        <DestinationEditor {...{setBreadcrumbs, editorMode: 'add'}}/>
      </Route>
      <Route
        path={destinationPageRoutes.editDestination}
        strict={false}
        exact
      >
        <DestinationEditor {...{setBreadcrumbs, editorMode: 'edit'}}/>
      </Route>
    </Switch>
  );
};

const DestinationsPage = observer(DestinationsPageComponent);

export default DestinationsPage;
