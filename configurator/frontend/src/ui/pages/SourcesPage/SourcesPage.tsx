// @Libs
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Route, Switch } from 'react-router-dom';
// @Routes
import { routes } from './routes';
// @Components
import { SourcesList } from './partials/SourcesList';
import { AddSource } from './partials/AddSource';
import { EditSource } from './partials/EditSource';
import { CenteredSpin } from '../../../lib/components/components';
// @Services
import ApplicationServices from '../../../lib/services/ApplicationServices';
// @Styles
import './SourcesPage.less';

const SourcesPage = () => {
  const [sources, setSources] = useState();

  const services = useMemo(() => ApplicationServices.get(), []);

  const getComponent = useCallback(
    (Component: React.FC<any>) => (currentProps: any) => (
      <Component
        sources={sources}
        setSources={setSources}
        userUid={services.userService.getUser().uid}
        {...currentProps}
      />
    ),
    [services.userService, sources]
  );

  useEffect(() => {
    services.storageService
      .get('sources', services.userService.getUser().uid)
      .then(({ _lastUpdated, ...response }) => setSources(response));
  }, [services.storageService, services.userService]);

  return (
    <>
      {!sources ? (
        <CenteredSpin />
      ) : (
        <Switch>
          <Route path={routes.root} exact render={getComponent(SourcesList)} />
          <Route path={[routes.add, routes.addExact]} strict={false} exact render={getComponent(AddSource)} />
          <Route path={[routes.edit, routes.editExact]} strict={false} exact component={getComponent(EditSource)} />
        </Switch>
      )}
    </>
  );
};

export { SourcesPage };
