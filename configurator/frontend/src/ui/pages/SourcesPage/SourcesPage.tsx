// @Libs
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Route, RouteProps, Switch } from 'react-router-dom';
// @Routes
import { routes } from './routes';
// @Components
import { SourcesList } from './partials/SourcesList';
import { AddSource } from './partials/AddSource';
import { EditSource } from './partials/EditSource';
import { CenteredSpin } from '@./lib/components/components';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Types
import { CollectionSourceData, CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';
// @Styles
import './SourcesPage.less';

const SourcesPage = () => {
  const [sources, setSources] = useState<CollectionSourceData>();

  const services = useMemo(() => ApplicationServices.get(), []);

  const projectId = useMemo(() => services.activeProject.id, [services]);

  const getComponent = useCallback(
    (Component: React.FC<CommonSourcePageProps>) => (currentProps: RouteProps) =>
      <Component setSources={setSources} sources={sources?.sources} projectId={projectId} {...currentProps} />,
    [projectId, sources]
  );

  useEffect(() => {
    services.storageService.get('sources', projectId).then(({ _lastUpdated, ...response }) => setSources(response))
  }, [services, projectId]);

  return (
    <>
      {!sources ?
        <CenteredSpin />
        : (
          <Switch>
            <Route path={routes.root} exact render={getComponent(SourcesList)} />
            <Route path={[routes.add, routes.addExact]} strict={false} exact render={getComponent(AddSource)} />
            <Route path={[routes.edit, routes.editExact]} strict={false} exact component={getComponent(EditSource)} />
          </Switch>
        )}
    </>
  );
};

SourcesPage.displayName = 'SourcesPage';

export { SourcesPage };
