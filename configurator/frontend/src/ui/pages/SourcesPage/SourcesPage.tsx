// @Libs
import React, { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import { Route, Switch } from 'react-router-dom';
// @Routes
import { routes } from './routes';
// @Components
import { SourcesList } from './partials/SourcesList';
import { AddSource } from './partials/AddSource';
import { EditSource } from './partials/EditSource';
import { CenteredSpin } from '@./lib/components/components';
// @Services
import ApplicationServices from '@service/ApplicationServices';
// @Styles
import './SourcesPage.less';
import { PageProps } from '@./navigation';
// @Hocs
import { BreadcrumbsProps } from '@./ui/components/molecule/Breadcrumbs/Breadcrumbs.types';
import { getComponent } from '@hocs/getComponent';

export interface CollectionSourceData {
  sources: SourceData[];
  _lastUpdated?: string;
}

export interface CommonSourcePageProps {
  sources: SourceData[];
  projectId: string;
  setSources: Dispatch<SetStateAction<CollectionSourceData>>;
  setBreadcrumbs: (breadcrumbs: BreadcrumbsProps) => void;
}

const SourcesPage = (props: PageProps) => {
  const [sources, setSources] = useState<CollectionSourceData>();

  const services = useMemo(() => ApplicationServices.get(), []);

  useEffect(() => {
    services.storageService.get('sources', services.activeProject.id).then(({ _lastUpdated, ...response }) => {
      setSources(response);
    });
  }, [setSources, services, services.activeProject.id]);

  const additionalProps = useMemo(() => ({
    projectId: services.activeProject.id,
    sources: sources?.sources,
    setSources,
    setBreadcrumbs: props.setBreadcrumbs
  }), [sources?.sources, services.activeProject.id]);

  return <>
    {!sources ?
      <CenteredSpin />
      : (
        <Switch>
          <Route path={routes.root} exact render={getComponent<CommonSourcePageProps>(SourcesList, additionalProps)} />
          <Route path={[routes.add, routes.addExact]} strict={false} exact render={getComponent<CommonSourcePageProps>(AddSource, additionalProps)} />
          <Route path={[routes.edit, routes.editExact]} strict={false} exact render={getComponent<CommonSourcePageProps>(EditSource, additionalProps)} />
        </Switch>
      )}
  </>
};

SourcesPage.displayName = 'SourcesPage';

export { SourcesPage };
