// @Libs
import React, { useEffect, useMemo } from 'react';
import { Redirect, useParams } from 'react-router-dom';
import { snakeCase } from 'lodash';
// @Components
import { SourceFormWrap } from '@page/SourcesPage/partials/_common/SourceForm/SourceFormWrap';
// @Types
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';
import { SourceConnector } from '@catalog/sources/types';
// @Sources
import { allSources } from '@catalog/sources/lib';
// @Routes
import { routes } from '@page/SourcesPage/routes';
import { withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
import SourceFormHeader from '@page/SourcesPage/partials/_common/SourceForm/SourcesFormHeader';

const EditSource = ({ projectId, sources, setSources, setBreadcrumbs }: CommonSourcePageProps) => {
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
          title: <SourceFormHeader connectorSource={connectorSource} mode="edit" />
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
        setSources={setSources}
        setBreadcrumbs={setBreadcrumbs}
      />
    </>
  );
};

EditSource.displayName = 'EditSource';

export { EditSource };
