// @Libs
import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Col, Form, Input, Row, Select, Spin, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import debounce from 'lodash/debounce';
import cn from 'classnames';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { Parameter, SourceConnector } from 'catalog/sources/types';
import { Rule, RuleObject } from 'rc-field-form/lib/interface';
// @Components
import { ConfigurableFieldsForm } from 'ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm';
import { COLLECTIONS_SCHEDULES } from 'constants/schedule';
import { ErrorCard } from 'lib/components/ErrorCard/ErrorCard';
// @Services
import { useServices } from 'hooks/useServices';
// @Hooks
import { usePolling } from 'hooks/usePolling';
// @Styles
import editorStyles from 'ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm.module.less';
import useLoader from 'hooks/useLoader';
import { sourcesStore } from 'stores/sources';
import { mapAirbyteSpecToSourceConnectorConfig } from 'catalog/sources/lib/helper';

export interface Props {
  form: FormInstance;
  sourceReference: SourceConnector;
  isCreateForm: boolean;
  sources: SourceData[];
  initialValues: SourceData;
  handleTouchAnyField: (...args: any) => void;
}

const SourceEditorConfigComponent = ({
  form,
  sourceReference,
  isCreateForm,
  sources,
  initialValues = {} as SourceData,
  handleTouchAnyField
}: Props) => {
  const services = useServices();
  const {
    error: loadableParametersError,
    data: loadableParameters,
    isLoading: loadingParameters
  } = usePolling<unknown>(
    async () => {
      const response = await services.backendApiClient.get(
        `/airbyte/${sourceReference.id}/spec`,
        { proxy: true }
      );
      return response?.['data'] as unknown;
    },
    (response) => response?.['status'] !== 'pending'
  );

  const validateUniqueSourceId = useCallback(
    (rule: RuleObject, value: string) =>
      sources?.find((source: SourceData) => source.sourceId === value)
        ? Promise.reject('Source ID must be unique!')
        : Promise.resolve(),
    [sources]
  );

  const handleChange = debounce(handleTouchAnyField, 500);

  const sourceIdValidators = useMemo(() => {
    const rules: Rule[] = [
      { required: true, message: 'Source ID is required field' }
    ];

    if (isCreateForm) {
      rules.push({
        validator: validateUniqueSourceId
      });
    }

    return rules;
  }, [validateUniqueSourceId, isCreateForm]);

  const initialSchedule = useMemo(() => {
    if (initialValues.schedule) {
      return initialValues.schedule;
    }

    return COLLECTIONS_SCHEDULES[0].value;
  }, [initialValues]);

  const sourceConfigurationParameters = useMemo<Parameter[]>(() => {
    if (sourceReference.configParameters === 'loadable')
      return mapAirbyteSpecToSourceConnectorConfig(
        loadableParameters,
        sourceReference.id
      );
    return sourceReference.configParameters;
  }, [loadableParameters]);

  return (
    <Form
      name="source-config"
      form={form}
      autoComplete="off"
      onChange={handleChange}
    >
      <Row>
        <Col span={24}>
          <Form.Item
            initialValue={initialValues.sourceId}
            className={cn('form-field_fixed-label', editorStyles.field)}
            label={<span>SourceId:</span>}
            name="sourceId"
            rules={sourceIdValidators}
            labelCol={{ span: 4 }}
            wrapperCol={{ span: 20 }}
          >
            <Input autoComplete="off" disabled={!isCreateForm} />
          </Form.Item>
        </Col>
      </Row>

      {sourceReference.isSingerType && (
        <Row>
          <Col span={24}>
            <Form.Item
              initialValue={initialSchedule}
              name="schedule"
              className={cn('form-field_fixed-label', editorStyles.field)}
              label="Schedule:"
              labelCol={{ span: 4 }}
              wrapperCol={{ span: 20 }}
              rules={[
                { required: true, message: 'You have to choose schedule' }
              ]}
            >
              <Select>
                {COLLECTIONS_SCHEDULES.map((option) => (
                  <Select.Option value={option.value} key={option.value}>
                    {option.label}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>
      )}

      {loadableParametersError ? (
        <ErrorCard
          title={`Failed to load the configuration spec for the ${sourceReference.displayName} source`}
        />
      ) : loadingParameters ? (
        <LoadableFieldsLoadingMessageCard />
      ) : (
        <ConfigurableFieldsForm
          handleTouchAnyField={handleTouchAnyField}
          initialValues={initialValues}
          fieldsParamsList={sourceConfigurationParameters}
          form={form}
        />
      )}
    </Form>
  );
};

const SourceEditorConfig = observer(SourceEditorConfigComponent);

SourceEditorConfig.displayName = 'SourceEditorConfig';

export { SourceEditorConfig };

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
    <Card>
      <Card.Meta
        avatar={<Spin />}
        title="Loading the source config"
        description={description}
      />
    </Card>
  );
};
