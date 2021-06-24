import ApplicationServices from '@service/ApplicationServices';
import Marshal from '@./lib/commons/marshalling';
import { closeableMessage, handleError } from '@./lib/components/components';
import { message } from 'antd';
import { firstToLower } from '@./lib/commons/utils';
import { Tab } from '@component/Tabs/TabsConfigurator';

const destinationEditorUtils = {
  testConnection: async(dst: DestinationData, hideMessage?: boolean) => {
    try {
      await ApplicationServices.get().backendApiClient.post('/destinations/test', Marshal.toPureJson(dst));

      dst._connectionTestOk = true;

      if (!hideMessage) {
        closeableMessage.info('Successfully connected!');
      }
    } catch (error) {
      dst._connectionTestOk = false;
      dst._connectionErrorMessage = error.message ?? 'Failed to connect';

      if (!hideMessage) {
        handleError(error, 'Unable to test connection with filled data');
      }
    }
  },
  getCheckedSources: (sources: SourceData[], data: DestinationData) => {
    return sources?.reduce((accumulator: string[], current: SourceData) => {
      if (current.destinations?.find((uid: string) => data._uid === uid)) {
        accumulator.push(current.sourceId);
      }

      return accumulator;
    }, []);
  },
  updateSources: (sources: SourceData[], data: DestinationData, projectId: string) => {
    const result = sources.reduce((accumulator: SourceData[], current: SourceData) => {
      if (data._sources?.includes(current.sourceId)) {
        if (!current.destinations) current = { ...current, destinations: [] };
        current = {
          ...current,
          destinations: current?.destinations?.find((dst: string) => !data._sources?.includes(data._uid))
            ? current?.destinations
            : [...current?.destinations, data._uid]
        };
      } else {
        current = {
          ...current,
          destinations: current?.destinations?.filter((dst: string) => dst !== data._uid)
        };
      }
      return [
        ...accumulator,
        current
      ];
    }, []);

    try {
      ApplicationServices.get().storageService.save('sources', { sources: result }, projectId);

      return result;
    } catch (error) {
      message.warn(
        `Destination will be saved, but connected sources will not by the reason: '${firstToLower(
          error.message ?? 'Failed to save connected sources data'
        )}'. Data will not be piped to this destination`,
        10
      );
    }
  },
  getPromptMessage: (tabs: Tab[]) => () => tabs.some(tab => tab.touched)
    ? 'You have unsaved changes. Are you sure you want to leave the page?'
    : undefined
};

export { destinationEditorUtils };
