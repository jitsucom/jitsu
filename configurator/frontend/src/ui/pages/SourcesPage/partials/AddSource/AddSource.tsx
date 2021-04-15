// @Libs
import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { snakeCase } from 'lodash';
// @Components
import { ConnectorsCatalog } from '../_common/ConnectorsCatalog';
import { SourceFormWrap } from '../_common/SourceForm/SourceFormWrap';
// @Types
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';
import { SourceConnector } from '@catalog/sources/types';
// @Sources
import { allSources } from '@catalog/sources/lib';

const AddSource = ({ projectId, sources, setSources, setHeader }: CommonSourcePageProps) => {
  const params = useParams<{ source: string }>();

  const connectorSource = useMemo<SourceConnector>(
    () =>
      allSources.find((source: SourceConnector) => snakeCase(source.id) === snakeCase(params.source)) ??
      {} as SourceConnector,
    [params.source]
  );

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
        setHeader={setHeader}
        projectId={projectId}
        sources={sources}
        setSources={setSources}
      />
    </>
  );
};

AddSource.displayName = 'AddSource';

export { AddSource };
