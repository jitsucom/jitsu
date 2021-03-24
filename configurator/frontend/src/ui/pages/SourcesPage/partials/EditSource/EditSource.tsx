// @Libs
import React, { useMemo } from 'react';
import { Redirect, useParams } from 'react-router-dom';
// @Components
import { SourceFormWrap } from '@page/SourcesPage/partials/_common/SourceForm/SourceFormWrap';
// @Types
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';
import { SourceConnector } from '@connectors/types';
// @Sources
import { allSources } from '@connectors/sources';
// @Routes
import { routes } from '@page/SourcesPage/routes';

const EditSource = ({ projectId, sources, setSources }: CommonSourcePageProps) => {
  const params = useParams<{ sourceId: string }>();

  const sourceData = useMemo(() => sources[params.sourceId], [sources, params.sourceId]);

  const connectorSource = useMemo<SourceConnector>(
    () => allSources.find((source: SourceConnector) => source.id === sourceData?.sourceType) ?? {} as SourceConnector,
    [sourceData?.sourceType]
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
      />
    </>
  );
};

EditSource.displayName = 'EditSource';

export { EditSource };
