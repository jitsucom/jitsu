import ApplicationServices from '@service/ApplicationServices';
import Marshal from '@./lib/commons/marshalling';

const destinationEditorUtils = {
  testConnection: config => ApplicationServices.get().backendApiClient.post('/destinations/test', Marshal.toPureJson(config))
};

export { destinationEditorUtils };
