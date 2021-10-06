import { Col, FormInstance, Row } from 'antd';
import { SourceConnector } from 'catalog/sources/types';
import { useLoaderAsObject } from 'hooks/useLoader';
import { ErrorCard } from 'lib/components/ErrorCard/ErrorCard';
import { LoadableFieldsLoadingMessageCard } from 'lib/components/LoadingFormCard/LoadingFormCard';
import ApplicationServices from 'lib/services/ApplicationServices';
import { cloneDeep } from 'lodash';
import { useEffect, useMemo, useRef } from 'react';
import { Poll } from 'utils/polling';
import { withQueryParams } from 'utils/queryParams';
import {
  assertIsArrayOfTypes,
  assertIsObject,
  assertIsString
} from 'utils/typeCheck';
import { SourceEditorStreamsAirbyteForm } from './SourceEditorStreamsAirbyteForm';
import { useSourceEditorSyncContext } from './SourceEditorSyncContext';

type Props = {
  form: FormInstance;
  initialValues: SourceData;
  connectorSource: SourceConnector;
  handleBringSourceData: () => Promise<SourceData>;
};

const services = ApplicationServices.get();

export const SourceEditorStreamsAirbyteLoader: React.FC<Props> = ({
  form,
  initialValues,
  connectorSource,
  handleBringSourceData
}) => {
  const pollingInstance = useRef<null | Poll>(null);
  const { isLoadingConfigParameters } = useSourceEditorSyncContext();

  const formLoadedForTheFirstTime: boolean = !initialValues.catalog?.streams;
  const previouslyCheckedStreams: AirbyteStreamData[] =
    initialValues.catalog?.streams ?? [];

  const {
    isLoading: isLoadingAirbyteStreams,
    data: airbyteStreamsLoadedData,
    error: airbyteStreamsLoadError
  } = useLoaderAsObject<AirbyteStreamData[]>(async () => {
    if (!connectorSource.staticStreamsConfigEndpoint)
      throw new Error(
        'Used SourceEditorStreamsAirbyteLoader component but endpoint for loading streams config not specified in Source Connector'
      );
    if (!isLoadingConfigParameters) {
      const data = (await handleBringSourceData()).config.config;
      const baseUrl = connectorSource.staticStreamsConfigEndpoint;
      const project_id = services.userService.getUser().projects[0].id;

      const poll = new Poll(
        (end, fail) => async () => {
          const response = await services.backendApiClient.post(
            withQueryParams(baseUrl, { project_id }),
            data,
            { proxy: true }
          );
          if (response.status !== 'pending') end(response);
          if (response.message) fail(new Error(response.message));
        },
        2000
      );

      pollingInstance.current = poll;

      poll.start();
      const response = await poll.wait();

      assertIsObject(response);
      assertIsObject(response.catalog);
      assertIsArrayOfTypes(response.catalog.streams, {});

      const rawAirbyteStreams: UnknownObject[] = response.catalog.streams;

      const streams: AirbyteStreamData[] = rawAirbyteStreams.map((stream) => {
        assertIsString(stream.name);
        assertIsString(stream.namespace, { allowUndefined: true });
        assertIsObject(stream.json_schema);
        assertIsArrayOfTypes(stream.supported_sync_modes, '');

        const previouslyCheckedStreamData = previouslyCheckedStreams.find(
          (checkedStream) =>
            checkedStream.stream.name === stream.name &&
            checkedStream.stream.namespace === stream.namespace
        );

        if (previouslyCheckedStreamData) return previouslyCheckedStreamData;

        return {
          sync_mode: stream.supported_sync_modes[0],
          destination_sync_mode: 'overwrite',
          stream: {
            name: stream.name,
            namespace: stream.namespace,
            json_schema: stream.json_schema,
            supported_sync_modes: stream.supported_sync_modes,
            ...stream
          }
        };
      });

      return streams;
    }
  }, [isLoadingConfigParameters]);

  useEffect(
    () => () => {
      pollingInstance.current?.cancel();
    },
    []
  );

  return airbyteStreamsLoadError ? (
    <Row>
      <Col span={24}>
        <ErrorCard
          title={`Source configuration validation failed`}
          description={`Invalid configuration. See more details in the error stack.`}
          stackTrace={airbyteStreamsLoadError.stack}
          className={'form-fields-card'}
        />
      </Col>
    </Row>
  ) : isLoadingAirbyteStreams ? (
    <Row>
      <Col span={24}>
        <LoadableFieldsLoadingMessageCard
          title="Validating the source configuration"
          longLoadingMessage="This operation may take up to 3 minutes if you are configuring streams of this source type for the first time."
          showLongLoadingMessageAfterMs={10000}
        />
      </Col>
    </Row>
  ) : (
    <SourceEditorStreamsAirbyteForm
      form={form}
      allStreams={airbyteStreamsLoadedData}
      initiallySelectedStreams={previouslyCheckedStreams}
      selectAllFieldsByDefault={formLoadedForTheFirstTime}
    />
  );
};

/**
 * Deletes previously saved streams (aka collections) if they are not in the new list
 * of static streams.
 *
 * Note: The list of static streams depends on the Connection Parameters config; The
 * list is updated every time user changes the config.
 *
 * @param initialData
 * @returns
 */
const applyNewAirbyteStreamsToInitialValues = (
  initialValues: SourceData,
  newStaticStreams: StreamWithRawData[]
): SourceData => {
  if (initialValues.collections) {
    const allowedNames = new Set(newStaticStreams.map((stream) => stream.name));
    const collections = initialValues.collections.filter((stream) =>
      allowedNames.has(stream.name)
    );

    const updatedInitialValues = cloneDeep(initialValues);
    updatedInitialValues.collections = newStaticStreams;
    // updatedInitialValues.collections = collections;

    return updatedInitialValues;
  }

  return initialValues;
};
