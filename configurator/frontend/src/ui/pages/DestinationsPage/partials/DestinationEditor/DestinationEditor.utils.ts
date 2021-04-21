import ApplicationServices from '@service/ApplicationServices';
import Marshal from '@./lib/commons/marshalling';
import { handleError } from '@./lib/components/components';

const destinationEditorUtils = {
  testConnection: async(dst: DestinationData) => {
    try {
      await ApplicationServices.get().backendApiClient.post('/destinations/test', Marshal.toPureJson(dst));

      dst._connectionTestOk = true;
    } catch(error) {
      dst._connectionTestOk = false;
      dst._connectionErrorMessage = error;

      handleError(error, 'Unable to test connection with filled data');
    }
  }
};

export { destinationEditorUtils };
