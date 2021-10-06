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
import { useSourceEditorSyncContext } from 'ui/pages/SourcesPage/partials/SourceEditor/SourceEditorSyncContext';
import { LoadableFieldsLoadingMessageCard } from 'lib/components/LoadingFormCard/LoadingFormCard';
import { toTitleCase } from 'utils/strings';

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
  const { setIsLoadingConfigParameters } = useSourceEditorSyncContext();
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
          response?.['spec']?.['spec']?.['connectionSpecification']
        ).map<Parameter>((parameter) => ({
          ...parameter,
          displayName: toTitleCase(parameter.displayName, { separator: '_' })
        }));

        setFieldsParameters(parsedData);
        setIsLoadingParameters(false);

        resolve?.(parsedData);
        enableFormControls?.();

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

      setIsLoadingConfigParameters(false);
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
        <LoadableFieldsLoadingMessageCard
          title="Loading the source config"
          longLoadingMessage="Loading the configuration spec takes longer than usual. This might happen if you are configuring such source for the first time - Jitsu will need some time to pull a docker image with the connector code"
          showLongLoadingMessageAfterMs={5000}
        />
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
