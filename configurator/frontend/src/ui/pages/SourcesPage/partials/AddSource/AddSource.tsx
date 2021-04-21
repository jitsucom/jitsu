// @Libs
import React, { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { snakeCase } from 'lodash';
// @Components
import { ConnectorsCatalog } from '../_common/ConnectorsCatalog';
import { SourceFormWrap } from '../_common/SourceForm/SourceFormWrap';
// @Types
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage';
import { SourceConnector } from '@catalog/sources/types';
// @Sources
import { allSources } from '@catalog/sources/lib';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
import { routes } from '@page/SourcesPage/routes';
import SourceFormHeader from '@page/SourcesPage/partials/_common/SourceForm/SourcesFormHeader';

const AddSource = ({ projectId, sources, setSources, setBreadcrumbs }: CommonSourcePageProps) => {
  const params = useParams<{ source: string }>();

  useEffect(() => {
    setBreadcrumbs(withHome({
      elements: [
        { title: 'Sources', link: routes.root },
        {
          title: 'Test (add new)'
        }
      ]
    }));
  }, [setBreadcrumbs])

  const connectorSource = useMemo<SourceConnector>(
    () =>
      allSources.find((source: SourceConnector) => snakeCase(source.id) === snakeCase(params.source)) ??
      {} as SourceConnector,
    [params.source]
  );

  useEffect(() => {
    setBreadcrumbs(withHome({
      elements: [
        { title: 'Sources', link: routes.root },
        {
          title: <SourceFormHeader connectorSource={connectorSource} mode="add" />
        }
      ]
    }));
  }, [connectorSource, setBreadcrumbs])

  if (!params.source) {
    return (
      <>
        <h3>You have to choose type of source that you want to add.</h3>
        <ConnectorsCatalog viewType="table" />
      </>
    );
  }

  if (!connectorSource.id) {
    return (
      <>
        <h3>It seems you open broken link, just choose source below.</h3>
        <ConnectorsCatalog viewType="table" />
      </>
    );
  }

  return (
    <>
      <SourceFormWrap
        connectorSource={connectorSource}
        setBreadcrumbs={setBreadcrumbs}
        projectId={projectId}
        sources={sources}
        setSources={setSources}
      />
    </>
  );
};

AddSource.displayName = 'AddSource';

export { AddSource };
