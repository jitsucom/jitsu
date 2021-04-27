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
import { message } from 'antd';

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

      return true;
    } catch(error) {
      handleError(error, 'Unable to test connection with filled data');
      return false;
    }
  }
};

export { sourcePageUtils };
