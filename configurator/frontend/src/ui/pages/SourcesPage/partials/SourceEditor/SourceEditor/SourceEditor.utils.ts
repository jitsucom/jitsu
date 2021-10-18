// @Libs
import { cloneDeep, merge } from 'lodash';
// @Utils
import { sourcePageUtils } from 'ui/pages/SourcesPage/SourcePage.utils';
// @Types
import { SourceEditorState } from './SourceEditor';
import { SourceConnector } from 'catalog/sources/types';
import { makeObjectFromFieldsValues } from 'utils/forms/marshalling';

export const sourceEditorUtils = {
  getSourceDataFromState: (
    sourceEditorState: SourceEditorState,
    sourceCatalogData: SourceConnector,
    sourceInitialData?: SourceData
  ): SourceData => {
    const { configuration, streams, connections } = sourceEditorState;

    const updatedSourceData = merge(
      makeObjectFromFieldsValues(configuration.config),
      makeObjectFromFieldsValues(streams.streams),
      makeObjectFromFieldsValues(connections.destinations)
    );

    const initialSourceData = sourceInitialData
      ? cloneDeep(sourceInitialData)
      : createInitialSourceData(sourceCatalogData);

    return merge(initialSourceData, updatedSourceData);
  }
};

const createInitialSourceData = (sourceCatalogData: SourceConnector) =>
  ({
    sourceType: sourcePageUtils.getSourceType(sourceCatalogData),
    sourceProtoType: sourcePageUtils.getSourcePrototype(sourceCatalogData),
    connected: false,
    connectedErrorMessage: ''
  } as const);
