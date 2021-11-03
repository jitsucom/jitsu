// @Libs
import { merge } from 'lodash';
// @Utils
import { sourcePageUtils } from 'ui/pages/SourcesPage/SourcePage.utils';
// @Types
import { SourceEditorState } from './SourceEditor';
import { SourceConnector } from 'catalog/sources/types';
import { makeObjectFromFieldsValues } from 'utils/forms/marshalling';
import { sourcesStore } from 'stores/sources';
import { COLLECTIONS_SCHEDULES } from 'constants/schedule';

export const sourceEditorUtils = {
  getSourceDataFromState: (
    sourceEditorState: SourceEditorState,
    sourceCatalogData: SourceConnector,
    initialSourceData: Partial<SourceData>
  ): SourceData => {
    const { configuration, streams, connections } = sourceEditorState ?? {}

    let updatedSourceData: SourceData = merge(
      makeObjectFromFieldsValues(merge({}, ...Object.values(configuration.config))),
      makeObjectFromFieldsValues(streams.streams),
      makeObjectFromFieldsValues(connections.connections)
    )

    const catalogSourceData: Pick<SourceData, "sourceType" | "sourceProtoType"> = {
      sourceType: sourcePageUtils.getSourceType(sourceCatalogData),
      sourceProtoType: sourcePageUtils.getSourcePrototype(sourceCatalogData),
    }

    updatedSourceData = { ...(initialSourceData ?? {}), ...catalogSourceData, ...updatedSourceData }
    if (!updatedSourceData?.config?.catalog && initialSourceData?.config?.catalog) {
      updatedSourceData["config"]["catalog"] = initialSourceData.config.catalog
    }

    return updatedSourceData
  },
}

export const createInitialSourceData = (sourceCatalogData: SourceConnector) =>
  ({
    sourceId: sourcePageUtils.getSourceId(
      sourceCatalogData.id,
      sourcesStore.sources.map((source) => source.sourceId)
    ),
    schedule: COLLECTIONS_SCHEDULES[0].value,
    connected: false,
    connectedErrorMessage: ''
  } as const);
