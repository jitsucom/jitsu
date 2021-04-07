// @Libs
import React, { useCallback, useMemo } from 'react';
import { Col, Form, Input, Row, Select } from 'antd';
import { get, snakeCase } from 'lodash';
// @Utils
import { SourceFormConfigField } from './SourceFormConfigField';
// @Types
import { Rule, RuleObject } from 'rc-field-form/lib/interface';
import { Parameter } from '@catalog/sources/types';
import { SourceFormConfigProps as Props } from './SourceForm.types';
// @Helper
import { sourceFormCleanFunctions } from './sourceFormCleanFunctions';
// @Constants
import { COLLECTIONS_SCHEDULES } from '@./constants/schedule';

// ToDo: initialValues should contain some values, to refuse initialValue for each field
const SourceFormConfig = ({ sources, connectorSource, initialValues, sourceIdMustBeUnique }: Props) => {

  const isUniqueSourceId = useCallback((sourceId: string) => !sources?.find((source: SourceData) => source.sourceId === sourceId), [
    sources
  ]);

  const initialSourceId = useMemo(() => {
    if (initialValues.sourceId) {
      return initialValues.sourceId;
    }

    const preparedBlank = snakeCase(connectorSource.displayName);

    if (isUniqueSourceId(preparedBlank)) {
      return preparedBlank;
    }

    const sourcesIds = sources?.reduce((accumulator: string[], current: SourceData) => {
      if (current.sourceId.includes(preparedBlank)) {
        accumulator.push(current.sourceId)
      }

      return accumulator;
    }, []);

    return sourceFormCleanFunctions.getUniqueAutoIncremented(sourcesIds, preparedBlank, '_');
  }, [sources, isUniqueSourceId, initialValues, connectorSource]);

  const initialSchedule = useMemo(() => {
    if (initialValues.schedule) {
      return initialValues.schedule;
    }

    return COLLECTIONS_SCHEDULES[0].value;
  }, [initialValues]);

  const validateUniqueSourceId = useCallback((rule: RuleObject, value: string) => sources?.find((source: SourceData) => source.sourceId === value)
    ? Promise.reject('Source ID must be unique!')
    : Promise.resolve(), [sources])

  const sourceIdValidators = useMemo(() => {
    const rules: Rule[] = [{ required: true, message: 'Source ID is required field' }];

    if (sourceIdMustBeUnique) {
      rules.push({
        validator: validateUniqueSourceId
      });
    }

    return rules;
  }, [validateUniqueSourceId, sourceIdMustBeUnique]);

  const getInitialValue = useCallback((id: string, defaultValue: any, type: any) => {
    const initial = get(initialValues, `config.${id}`);

    return initial
      ? initial
      : type === 'json'
        ? Object.keys(defaultValue ?? {}).length > 0
          ? JSON.stringify(defaultValue)
          : ''
        : defaultValue;
  }, [initialValues]);

  return (
    <>
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
            <Input autoComplete="off" />
          </Form.Item>
        </Col>
      </Row>

      {
        connectorSource.isSingerType && <Row>
          <Col span={16}>
            <Form.Item
              initialValue={initialSchedule}
              name="schedule"
              className="form-field_fixed-label"
              label="Schedule:"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
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

      {connectorSource.configParameters.map(({ id, displayName, required, type, documentation, constant, defaultValue }: Parameter) => {
        return (
          <SourceFormConfigField
            type={type.typeName}
            typeOptions={type.data}
            constant={constant}
            id={id}
            key={id}
            displayName={displayName}
            initialValue={getInitialValue(id, defaultValue || constant, type.typeName)}
            required={required}
            documentation={documentation}
          />
        );
      })}
    </>
  );
};

SourceFormConfig.displayName = 'SourceFormConfig';

export { SourceFormConfig };
