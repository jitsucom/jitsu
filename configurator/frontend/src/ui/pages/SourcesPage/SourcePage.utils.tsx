// @Libs
import { snakeCase } from 'lodash';
// @Types
import { SourceConnector } from '@catalog/sources/types';
// @Utils
import { getUniqueAutoIncId } from '@util/numbers';
import { handleError } from '@./lib/components/components';
// @Services
import ApplicationServices from '@service/ApplicationServices';
import Marshal from '@./lib/commons/marshalling';
import { message, Tooltip } from 'antd';
import { ListItemTitle } from '@atom/ListItemTitle';
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
import { ListItemDescription } from '@atom/ListItemDescription';

const sourcePageUtils = {
  getSourceType: (sourceConnector: SourceConnector) => sourceConnector.isSingerType
    ? 'singer'
    : snakeCase(sourceConnector.id),
  getSourceId: (sourceProtoType: string, sourcesIds: string[]) => {
    const isUniqueSourceId = !sourcesIds.find(id => id === sourceProtoType);

    if (isUniqueSourceId) {
      return sourceProtoType;
    }

    return getUniqueAutoIncId(sourceProtoType, sourcesIds);
  },
  testConnection: async(src: SourceData) => {
    try {
      await ApplicationServices.get().backendApiClient.post('/sources/test', Marshal.toPureJson(src));

      message.success('Successfully connected!');

      return {
        connected: true
      };
    } catch(error) {
      handleError(error, 'Unable to test connection with filled data');

      return {
        connected: false,
        connectedErrorMessage: error.message ?? 'Failed to connect'
      };
    }
  },
  getTitle: (src: SourceData) => {
    return <ListItemTitle
      render={src.sourceId}
      error={!src.connected}
      errorMessage={
        <>Last connection test failed with <b><i>'{src.connectedErrorMessage}'</i></b>. Source might be unavailable. Please, go to editor and fix the connection settings</>
      }
    />
  }
};

export { sourcePageUtils };
