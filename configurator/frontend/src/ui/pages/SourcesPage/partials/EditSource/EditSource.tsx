// @Libs
import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
// @Components
import { SourceFormWrap } from '@page/SourcesPage/partials/_common/SourceForm/SourceFormWrap';
// @Types
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';
import { SourceConnector } from '@connectors/types';
// @Sources
import { allSources } from '@connectors/sources';

const EditSource = ({ projectId, sources }: CommonSourcePageProps) => {
  const params = useParams<{ sourceId: string }>();

  const sourceData = useMemo(() => sources[params.sourceId], [sources, params.sourceId]);

  const connectorSource = useMemo<SourceConnector>(
    () => allSources.find((source: SourceConnector) => source.id === sourceData.sourceType) ?? {} as SourceConnector,
    [sourceData.sourceType]
  );

  return (
    <div className="add-source">
      <SourceFormWrap
        formMode="edit"
        sourceData={sourceData}
        connectorSource={connectorSource}
        projectId={projectId}
        sources={sources}
      />
    </div>
  );
};

EditSource.displayName = 'EditSource';

export { EditSource };
