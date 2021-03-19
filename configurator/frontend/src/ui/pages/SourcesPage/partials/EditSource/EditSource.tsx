// @Libs
import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
// @Types
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';
// @Hardcoded data
import allSourcesList, { SourceConnector } from '../../../../../_temp';
import { SourceFormWrap } from '@page/SourcesPage/partials/_common/SourceForm/SourceFormWrap';

const EditSource = ({ userUid, sources }: CommonSourcePageProps) => {
  const params = useParams<{ sourceId: string }>();

  const sourceData = useMemo(() => sources[params.sourceId], [sources, params.sourceId]);

  const connectorSource = useMemo<SourceConnector>(
    () =>
      allSourcesList.find((source: SourceConnector) => source.id === sourceData.sourceType) ?? ({} as SourceConnector),
    [sourceData.sourceType]
  );

  return (
    <div className="add-source">
      <SourceFormWrap
        formMode="edit"
        sourceData={sourceData}
        connectorSource={connectorSource}
        userUid={userUid}
        sources={sources}
      />
    </div>
  );
};

export { EditSource };
