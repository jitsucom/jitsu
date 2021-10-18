// @Libs
import { useCallback, useMemo } from 'react';
import { Form as AntdForm, Input, Row, Col, Select, FormProps } from 'antd';
// @Store
import { sourcesStore } from 'stores/sources';
// @Constants
import { COLLECTIONS_SCHEDULES } from 'constants/schedule';
// @Types
import { UpdateConfigurationFields } from './SourceEditor';
import { Rule as AntdFormItemValidationRule } from 'rc-field-form/lib/interface';
// @Services
import { useServices } from 'hooks/useServices';
import { observer } from 'mobx-react-lite';

type FormFields = {
  sourceId: string;
  schedule: string;
};

type Props = {
  initialValues: Optional<SourceData>;
  onChange: UpdateConfigurationFields;
};

const SourceEditorFormConfigurationStaticFields: React.FC<Props> = ({
  initialValues,
  onChange
}) => {
  const [form] = AntdForm.useForm<FormFields>();
  const services = useServices();
  const subscription = services.currentSubscription?.currentPlan;
  const sourcesList = sourcesStore.sources;

  const validateUniqueSourceId = (_, value: string) =>
    sourcesList?.find((source: SourceData) => source.sourceId === value)
      ? Promise.reject('Source ID must be unique!')
      : Promise.resolve();

  const sourceIdValidationRules = useMemo<AntdFormItemValidationRule[]>(
    () => [
      { required: true, message: 'Source ID is required field' },
      { validator: validateUniqueSourceId }
    ],
    []
  );

  const handleFormValuesChange = useCallback<
    FormProps<FormFields>['onValuesChange']
  >((_, allValues) => {
    onChange(allValues);
  }, []);

  return (
    <AntdForm
      name="source-config"
      form={form}
      autoComplete="off"
      onValuesChange={handleFormValuesChange}
    >
      <Row>
        <Col span={24}>
          <AntdForm.Item
            initialValue={initialValues.sourceId}
            // className={`form-field_fixed-label ${editorStyles.field}`}
            label={<span>SourceId</span>}
            name="sourceId"
            rules={sourceIdValidationRules}
            labelCol={{ span: 4 }}
            wrapperCol={{ span: 20 }}
          >
            <Input disabled autoComplete="off" />
          </AntdForm.Item>
        </Col>
      </Row>

      <Row>
        <Col span={24}>
          <AntdForm.Item
            initialValue={initialValues.schedule}
            name="schedule"
            // className={`form-field_fixed-label ${editorStyles.field}`}
            label="Schedule"
            labelCol={{ span: 4 }}
            wrapperCol={{ span: 20 }}
            rules={[{ required: true, message: 'You have to choose schedule' }]}
          >
            <Select>
              {COLLECTIONS_SCHEDULES.map((option) => {
                const available = subscription
                  ? subscription.quota.allowedSchedules.includes(option.id)
                  : true;
                return (
                  <Select.Option
                    value={option.value}
                    key={option.value}
                    disabled={!available}
                  >
                    {option.label}
                    {!available && ' - n/a, upgrade plan'}
                  </Select.Option>
                );
              })}
            </Select>
          </AntdForm.Item>
        </Col>
      </Row>
    </AntdForm>
  );
};

const Wrapped = observer(SourceEditorFormConfigurationStaticFields);

Wrapped.displayName = 'SourceEditorFormConfigurationStaticFields';

export { Wrapped as SourceEditorFormConfigurationStaticFields };
