// @Libs
import React, { useCallback, useMemo } from 'react';
import { Col, Form, Input, Row } from 'antd';
import { snakeCase } from 'lodash';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { SourceConnector } from '@catalog/sources/types';
import { Rule, RuleObject } from 'rc-field-form/lib/interface';
// @Components
import { ConfigurableFieldsForm } from '@molecule/ConfigurableFieldsForm';
// @Utils
import { getUniqueAutoIncId } from '@util/numbers';

export interface Props {
  form: FormInstance;
  sourceReference: SourceConnector;
  isCreateForm: boolean;
  sources: SourceData[];
  initialValues: SourceData;
}

const SourceEditorConfig = ({ form, sourceReference, isCreateForm, sources, initialValues = {} as SourceData }: Props) => {
  const validateUniqueSourceId = useCallback(
    (rule: RuleObject, value: string) => sources?.find((source: SourceData) => source.sourceId === value)
      ? Promise.reject('Source ID must be unique!')
      : Promise.resolve(),
    [sources]
  );

  const isUniqueSourceId = useCallback((sourceId: string) => !sources?.find((source: SourceData) => source.sourceId === sourceId), [
    sources
  ]);

  const initialSourceId = useMemo(() => {
    if (initialValues.sourceId) {
      return initialValues.sourceId;
    }

    const preparedBlank = snakeCase(sourceReference.displayName);

    if (isUniqueSourceId(preparedBlank)) {
      return preparedBlank;
    }

    const sourcesIds = sources?.reduce((accumulator: string[], current: SourceData) => {
      if (current.sourceId.includes(preparedBlank)) {
        accumulator.push(current.sourceId)
      }

      return accumulator;
    }, []);

    return getUniqueAutoIncId(preparedBlank, sourcesIds);
  }, [sources, isUniqueSourceId, initialValues, sourceReference]);

  const sourceIdValidators = useMemo(() => {
    const rules: Rule[] = [{ required: true, message: 'Source ID is required field' }];

    if (isCreateForm) {
      rules.push({
        validator: validateUniqueSourceId
      });
    }

    return rules;
  }, [validateUniqueSourceId, isCreateForm]);

  return (
    <Form
      name="source-config"
      form={form}
      autoComplete="off"
    >
      <Row>
        <Col span={16}>
          <Form.Item
            initialValue={initialSourceId}
            className="form-field_fixed-label"
            label={<span>SourceId:</span>}
            name="sourceId"
            rules={sourceIdValidators}
            labelCol={{ span: 6 }}
            wrapperCol={{ span: 18 }}
          >
            <Input autoComplete="off" disabled={!isCreateForm} />
          </Form.Item>
        </Col>
      </Row>
      <ConfigurableFieldsForm initialValues={undefined} fieldsParamsList={sourceReference.configParameters} form={form}/>
    </Form>
  );
};

SourceEditorConfig.displayName = 'SourceEditorConfig';

export { SourceEditorConfig };
