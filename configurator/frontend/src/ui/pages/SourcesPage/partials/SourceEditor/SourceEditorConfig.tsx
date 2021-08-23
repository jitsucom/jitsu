// @Libs
import { useCallback, useMemo } from 'react';
import { Col, Form, Input, Row, Select } from 'antd';
import { observer } from 'mobx-react-lite';
import debounce from 'lodash/debounce';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { SourceConnector } from 'catalog/sources/types';
import { Rule, RuleObject } from 'rc-field-form/lib/interface';
// @Components
import { ConfigurableFieldsForm } from 'ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm';
import { COLLECTIONS_SCHEDULES } from 'constants/schedule';
// @Styles
import editorStyles from 'ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm.module.less';
import { LoadableFieldsForm } from 'ui/components/LoadableFieldsForm/LoadableFieldsForm';

export interface Props {
  form: FormInstance;
  sourceReference: SourceConnector;
  isCreateForm: boolean;
  sources: SourceData[];
  initialValues: SourceData;
  handleTouchAnyField: (...args: any) => void;
  disableFormControls?: VoidFunction;
  enableFormControls?: VoidFunction;
}

const SourceEditorConfigComponent = ({
  form,
  sourceReference,
  isCreateForm,
  sources,
  initialValues = {} as SourceData,
  handleTouchAnyField,
  disableFormControls,
  enableFormControls
}: Props) => {
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
            className={`form-field_fixed-label ${editorStyles.field}`}
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

      {sourceReference.protoType && (
        <Row>
          <Col span={24}>
            <Form.Item
              initialValue={initialSchedule}
              name="schedule"
              className={`form-field_fixed-label ${editorStyles.field}`}
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

      {sourceReference.hasLoadableParameters ? (
        <LoadableFieldsForm
          sourceReference={sourceReference}
          initialValues={initialValues}
          form={form}
          handleTouchAnyField={handleTouchAnyField}
          disableFormControls={disableFormControls}
          enableFormControls={enableFormControls}
        />
      ) : (
        <ConfigurableFieldsForm
          initialValues={initialValues}
          fieldsParamsList={sourceReference.configParameters}
          form={form}
          handleTouchAnyField={handleTouchAnyField}
        />
      )}
    </Form>
  );
};

const SourceEditorConfig = observer(SourceEditorConfigComponent);

SourceEditorConfig.displayName = 'SourceEditorConfig';

export { SourceEditorConfig };
