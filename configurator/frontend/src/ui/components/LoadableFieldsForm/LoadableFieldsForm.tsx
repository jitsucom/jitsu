// @Libs
import { useEffect, useState, FC } from 'react';
import { Card, Col, Row, Spin } from 'antd';
// @Types
import { Parameter, SourceConnector } from 'catalog/sources/types';
// @Services
import { useServices } from 'hooks/useServices';
// @Styles
import editorStyles from 'ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm.module.less';
import { ConfigurableFieldsForm } from '../ConfigurableFieldsForm/ConfigurableFieldsForm';
import { ErrorCard } from 'lib/components/ErrorCard/ErrorCard';
import { FormInstance } from 'antd/es';
import { mapAirbyteSpecToSourceConnectorConfig } from 'catalog/sources/lib/airbyte.helper';
import { Poll } from 'utils/polling';

type Props = {
  sourceReference: SourceConnector;
  form: FormInstance;
  initialValues: SourceData;
  handleTouchAnyField: (...args: any) => void;
  disableFormControls?: VoidFunction;
  enableFormControls?: VoidFunction;
};

export const LoadableFieldsForm = ({
  sourceReference,
  form,
  initialValues,
  handleTouchAnyField,
  disableFormControls,
  enableFormControls
}: Props) => {
  const services = useServices();
  const [_fieldsParameters, setFieldsParameters] = useState<null | Parameter[]>(
    null
  );
  const [_isLoadingParameters, setIsLoadingParameters] =
    useState<boolean>(true);
  const [_loadingParametersError, setLoadableParametersError] =
    useState<null | Error>(null);

  /**
   * fetches or polls the loadable config parameters fields spec
   * for now it is limited to the airbyte sources only
   */
  useEffect(() => {
    const fetchSpec = (): Promise<unknown> => {
      return services.backendApiClient.get(
        `/airbyte/${sourceReference.id.replace(
          'airbyte-',
          ''
        )}/spec?project_id=${services.activeProject.id}`,
        { proxy: true }
      );
    };

    let needPolling = false;

    const pullAirbyteSpecOnce = async (
      resolve?: (result: any) => void,
      reject?: (error?: Error) => void
    ): Promise<void> => {
      let response;
      try {
        response = await fetchSpec();
      } catch (error) {
        setLoadableParametersError(error);
        setIsLoadingParameters(false);
        if (reject) reject(error);
      }

      if (response?.['message']) {
        // when server fails to return spec it returns a message
        const error = new Error(`${response['message']}`);
        setLoadableParametersError(error);
        if (reject) reject(error);
        return;
      }

      if (response?.['status'] && response?.['status'] !== 'pending') {
        const parsedData = mapAirbyteSpecToSourceConnectorConfig(
          response?.['spec']?.['spec']?.['connectionSpecification'],
          sourceReference.displayName,
          {
            nodeName: 'config',
            parentNode: { id: 'config' }
          }
        );
        setFieldsParameters(parsedData);
        setIsLoadingParameters(false);
        if (resolve) resolve(parsedData);
        if (enableFormControls) enableFormControls();
        return;
      }

      needPolling = true;
    };

    let poll: Poll | undefined;

    /**
     * fetches or polls and maps the airbyte spec
     */
    const pullParametersFields = async (): Promise<void> => {
      if (disableFormControls) disableFormControls();
      setIsLoadingParameters(true);
      await pullAirbyteSpecOnce();

      if (needPolling) {
        poll = new Poll((end, fail) => () => pullAirbyteSpecOnce(end, fail));
        poll.start();
        await poll.wait();
      }
    };

    pullParametersFields();

    return () => {
      if (poll) poll.cancel();
    };
  }, []);

  return _loadingParametersError ? (
    <Row>
      <Col span={4} />
      <Col span={20} className={editorStyles.field}>
        <ErrorCard
          title={`Failed to load the ${sourceReference.displayName} source spec`}
          descriptionWithContacts={null}
          stackTrace={_loadingParametersError.stack}
          className={'form-fields-card'}
        />
      </Col>
    </Row>
  ) : _isLoadingParameters ? (
    <Row>
      <Col span={4} />
      <Col span={20} className={editorStyles.field}>
        <LoadableFieldsLoadingMessageCard />
      </Col>
    </Row>
  ) : (
    <ConfigurableFieldsForm
      fieldsParamsList={_fieldsParameters || []}
      form={form}
      initialValues={initialValues}
      handleTouchAnyField={handleTouchAnyField}
    />
  );
};

const LoadableFieldsLoadingMessageCard: FC = () => {
  const INITIAL_DESCRIPTION = null;
  const LONG_LOADING_DESCRIPTION =
    'Loading the configuration spec takes longer than usual. This might happen if you are configuring such source for the first time - Jitsu will need some time to pull a docker image with the connector code';
  const [description, setDescription] = useState<null | string>(
    INITIAL_DESCRIPTION
  );

  useEffect(() => {
    const SHOW_LONG_LOADING_DESCRIPTION_AFTER_MS = 3000;
    const timeout = setTimeout(
      () => setDescription(LONG_LOADING_DESCRIPTION),
      SHOW_LONG_LOADING_DESCRIPTION_AFTER_MS
    );

    return () => {
      clearTimeout(timeout);
    };
  }, []);

  return (
    <Card className={'form-fields-card'}>
      <Card.Meta
        avatar={<Spin />}
        title="Loading the source config"
        description={description}
      />
    </Card>
  );
};
