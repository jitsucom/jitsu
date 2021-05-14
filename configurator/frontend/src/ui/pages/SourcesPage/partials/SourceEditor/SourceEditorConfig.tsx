// @Libs
import React, { useCallback, useMemo } from 'react';
import { Col, Form, Input, Row, Select } from 'antd';
import debounce from 'lodash/debounce';
import cn from 'classnames';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { SourceConnector } from '@catalog/sources/types';
import { Rule, RuleObject } from 'rc-field-form/lib/interface';
// @Components
import { ConfigurableFieldsForm } from '@molecule/ConfigurableFieldsForm';
import { COLLECTIONS_SCHEDULES } from '@./constants/schedule';
// @Styles
import styles from '@molecule/ConfigurableFieldsForm/ConfigurableFieldsForm.module.less';

export interface Props {
  form: FormInstance;
  sourceReference: SourceConnector;
  isCreateForm: boolean;
  sources: SourceData[];
  initialValues: SourceData;
  handleTouchAnyField: VoidFunc;
}

const SourceEditorConfig = ({ form, sourceReference, isCreateForm, sources, initialValues = {} as SourceData, handleTouchAnyField }: Props) => {
  const validateUniqueSourceId = useCallback(
    (rule: RuleObject, value: string) => sources?.find((source: SourceData) => source.sourceId === value)
      ? Promise.reject('Source ID must be unique!')
      : Promise.resolve(),
    [sources]
  );

  const handleChange = debounce(handleTouchAnyField, 500);

  const sourceIdValidators = useMemo(() => {
    const rules: Rule[] = [{ required: true, message: 'Source ID is required field' }];

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
            className={cn('form-field_fixed-label', styles.field)}
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

      {
        sourceReference.isSingerType && <Row>
          <Col span={24}>
            <Form.Item
              initialValue={initialSchedule}
              name="schedule"
              className={cn('form-field_fixed-label', styles.field)}
              label="Schedule:"
              labelCol={{ span: 4 }}
              wrapperCol={{ span: 20 }}
              rules={[{ required: true, message: 'You have to choose schedule' }]}
            >
              <Select>
                {
                  COLLECTIONS_SCHEDULES.map((option) =>
                    <Select.Option value={option.value} key={option.value}>{option.label}</Select.Option>
                  )
                }
              </Select>
            </Form.Item>
          </Col>
        </Row>
      }

      <ConfigurableFieldsForm
        handleTouchAnyField={handleTouchAnyField}
        initialValues={initialValues}
        fieldsParamsList={sourceReference.configParameters}
        form={form}
      />
    </Form>
  );
};

SourceEditorConfig.displayName = 'SourceEditorConfig';

export { SourceEditorConfig };
