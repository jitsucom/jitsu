// @Libs
import snakeCase from 'lodash/snakeCase';
// @Types
import { SourceConnector } from '@catalog/sources/types';
// @Utils
import { getUniqueAutoIncId } from '@util/numbers';
import { closeableMessage, handleError } from '@./lib/components/components';
// @Services
import ApplicationServices from '@service/ApplicationServices';
import Marshal from '@./lib/commons/marshalling';
// @Components
import { ListItemTitle } from '@component/ListItem/ListItemTitle';
import { Tab } from '@component/Tabs/TabsConfigurator';
import { validateTabForm } from '@util/forms/validateTabForm';
import { makeObjectFromFieldsValues } from '@util/forms/marshalling';
import { SourceTabKey } from '@page/SourcesPage/partials/SourceEditor/SourceEditor';

const sourcePageUtils = {
  getSourceType: (sourceConnector: SourceConnector) => sourceConnector?.isSingerType
    ? 'singer'
    : snakeCase(sourceConnector?.id),
  getSourceId: (sourceProtoType: string, sourcesIds: string[]) => {
    const isUniqueSourceId = !sourcesIds.find(id => id === sourceProtoType);

    if (isUniqueSourceId) {
      return sourceProtoType;
    }

    return getUniqueAutoIncId(sourceProtoType, sourcesIds);
  },

  getTitle: (src: SourceData) => {
    return <ListItemTitle
      render={src.sourceId}
      error={!src.connected}
      errorMessage={
        <>Last connection test failed with <b><i>'{src.connectedErrorMessage}'</i></b>. Source might be unavailable. Please, go to editor and fix the connection settings</>
      }
    />
  },
  getPromptMessage: (tabs: Tab[]) => () => tabs.some(tab => tab.touched) ? 'You have unsaved changes. Are you sure you want to leave the page?': undefined,

  bringSourceData: ({ sourcesTabs, sourceData, forceUpdate }: { sourcesTabs: Tab<SourceTabKey>[]; sourceData: any; forceUpdate: any; }) => {
    return Promise
      .all(sourcesTabs.map((tab: Tab) => validateTabForm(tab, { forceUpdate, beforeValidate: () => tab.errorsCount = 0, errorCb: errors => tab.errorsCount = errors.errorFields?.length  })))
      .then((allValues: [{ [key: string]: string; }, CollectionSource[], string[]]) => {
        const enrichedData = {
          ...sourceData,
          ...allValues.reduce((result: any, current: any) => {
            return {
              ...result,
              ...makeObjectFromFieldsValues(current)
            };
          }, {})
        };

        if (enrichedData.collections) {
          enrichedData.collections = enrichedData.collections.map((collection: CollectionSource) => {
            if (!collection.parameters) {
              collection.parameters = {} as Array<{ [key: string]: string[]; }>;
            }

            return collection;
          });
        }

        return enrichedData;
      });
  },
  testConnection: async(src: SourceData, hideMessage?: boolean) => {
    try {
      await ApplicationServices.get().backendApiClient.post('/sources/test', Marshal.toPureJson(src));

      if (!hideMessage) {
        closeableMessage.info('Successfully connected!');
      }

      return {
        connected: true,
        connectedErrorMessage: undefined
      };
    } catch(error) {
      if (!hideMessage) {
        handleError(error, 'Unable to test connection with filled data');
      }

      return {
        connected: false,
        connectedErrorMessage: error.message ?? 'Failed to connect'
      };
    }
  }
};

export { sourcePageUtils };
