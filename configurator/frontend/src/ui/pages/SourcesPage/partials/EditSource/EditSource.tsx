// @Libs
import React, { useEffect, useMemo } from 'react';
import { Redirect, useParams } from 'react-router-dom';
import { snakeCase } from 'lodash';
// @Components
import { SourceFormWrap } from '@page/SourcesPage/partials/_common/SourceForm/SourceFormWrap';
import { PageHeader } from '@atom/PageHeader';
// @Types
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage';
import { SourceConnector } from '@catalog/sources/types';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
// @Sources
import { allSources } from '@catalog/sources/lib';
// @Routes
import { routes } from '@page/SourcesPage/routes';

const EditSource = ({ projectId, sources, updateSources, setBreadcrumbs }: CommonSourcePageProps) => {
  const params = useParams<{ sourceId: string }>();

  const sourceData = useMemo(() => sources.find((source: SourceData) => source.sourceId === params.sourceId), [sources, params.sourceId]);

  const connectorSource = useMemo<SourceConnector>(
    () => allSources.find((source: SourceConnector) => snakeCase(source.id) === sourceData?.sourceProtoType) ?? {} as SourceConnector,
    [sourceData?.sourceProtoType]
  );

  useEffect(() => {
    setBreadcrumbs(withHome({
      elements: [
        { title: 'Sources', link: routes.root },
        {
          title: <PageHeader title={connectorSource.displayName} icon={connectorSource.pic} mode="edit" />
        }
      ]
    }));
  }, [connectorSource, setBreadcrumbs])

  if (!Object.keys(connectorSource).length) {
    return <Redirect to={routes.root} />;
  }

  return (
    <>
      <SourceFormWrap
        formMode="edit"
        sourceData={sourceData}
        connectorSource={connectorSource}
        projectId={projectId}
        sources={sources}
        updateSources={updateSources}
        setBreadcrumbs={setBreadcrumbs}
      />
    </>
  );
};

EditSource.displayName = 'EditSource';

export { EditSource };
