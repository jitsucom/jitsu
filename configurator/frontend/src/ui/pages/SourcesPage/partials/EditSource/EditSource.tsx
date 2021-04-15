// @Libs
import React, { useMemo } from 'react';
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

const EditSource = ({ projectId, sources, setSources, setHeader }: CommonSourcePageProps) => {
  const params = useParams<{ sourceId: string }>();

  const sourceData = useMemo(() => sources.find((source: SourceData) => source.sourceId === params.sourceId), [sources, params.sourceId]);

  const connectorSource = useMemo<SourceConnector>(
    () => allSources.find((source: SourceConnector) => snakeCase(source.id) === sourceData?.sourceProtoType) ?? {} as SourceConnector,
    [sourceData?.sourceProtoType]
  );

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
        setHeader={setHeader}
      />
    </>
  );
};

EditSource.displayName = 'EditSource';

export { EditSource };
