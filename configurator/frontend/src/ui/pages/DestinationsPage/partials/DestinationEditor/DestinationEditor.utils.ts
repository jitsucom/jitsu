import ApplicationServices from '@service/ApplicationServices';
import Marshal from '@./lib/commons/marshalling';
import { handleError } from '@./lib/components/components';
import { message } from 'antd';

const destinationEditorUtils = {
  testConnection: async(dst: DestinationData) => {
    try {
      await ApplicationServices.get().backendApiClient.post('/destinations/test', Marshal.toPureJson(dst));

      dst._connectionTestOk = true;

      message.success('Successfully connected!');
    } catch (error) {
      dst._connectionTestOk = false;
      dst._connectionErrorMessage = error.message ?? 'Failed to connect';

      handleError(error, 'Unable to test connection with filled data');
    }
  }
};

export { destinationEditorUtils };
