// @Libs
import { clone, cloneDeep, merge } from 'lodash';
// @Store
import { sourcesStore } from 'stores/sources';
// @Utils
import { sourcePageUtils } from 'ui/pages/SourcesPage/SourcePage.utils';
// @Types
import { SourceEditorState } from './SourceEditor';
import { SourceConnector } from 'catalog/sources/types';

export const sourceEditorUtils = {
  getSourceDataFromState: (
    sourceEditorState: SourceEditorState,
    sourceCatalogData: SourceConnector,
    sourceInitialData?: SourceData
  ): SourceData => {
    const { configuration, streams, connections } = sourceEditorState;
    const { sourceId, sourceName, schedule, ...config } = configuration.config;

    const updatedSourceData = {
      sourceId: `${sourceId}`,
      sourceName: `${sourceName ?? sourceId}`,
      schedule: `${schedule}`,
      config: {
        config
      },
      collections: streams as any,
      destinations: connections as any
    } as const;

    const initialSourceData = sourceInitialData
      ? cloneDeep(sourceInitialData)
      : ({
          sourceType: sourcePageUtils.getSourceType(sourceCatalogData),
          sourceProtoType:
            sourcePageUtils.getSourcePrototype(sourceCatalogData),
          connected: false,
          connectedErrorMessage: ''
        } as const);

    return merge(initialSourceData, updatedSourceData);
  },

  getInitialState: (
    sourceId: string,
    sourceInitialData?: SourceData
  ): SourceEditorState => {
    const uniqueSourceId = sourcePageUtils.getSourceId(
      sourceId,
      sourcesStore.sources.map((src) => src.sourceId)
    );

    const initialConfig: SourceEditorState['configuration']['config'] = {
      sourceId: sourceInitialData?.sourceId ?? uniqueSourceId,
      sourceName: sourceInitialData?.sourceName ?? sourceId,
      schedule: sourceInitialData?.schedule ?? '@daily',
      ...(sourceInitialData.config?.config ?? {})
    };

    return {
      configuration: { config: initialConfig, errorsCount: 0 },
      streams: { streams: [], errorsCount: 0 },
      connections: { destinations: [], errorsCount: 0 },
      stateChanged: false
    };
  }
};
