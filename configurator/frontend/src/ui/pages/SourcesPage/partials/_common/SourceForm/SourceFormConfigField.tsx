// @Libs
import React, { memo, useCallback, useMemo } from 'react';
import { Col, Form, FormInstance, Input, Row, Select } from 'antd';
import { set } from 'lodash';
import * as monacoEditor from 'monaco-editor';
import MonacoEditor from 'react-monaco-editor';
// @Types
import { SourceFormConfigFieldProps as Props } from './SourceForm.types';
// @Components
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
// @Utils
import { isValidFullIsoDate } from '@util/validation/date';

const SourceFormConfigFieldComponent = ({ displayName, initialValue, required, id, type, documentation, typeOptions, constant }: Props) => {
  const fieldName = useMemo(() => `config.${id}`, [id]);

  const handleChange = useCallback(
    (getFieldsValue, setFieldsValue) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const formValues = getFieldsValue();
      const value = e.target.value.replace(/\D/g, '');

      set(formValues, fieldName, value);

      setFieldsValue(formValues);
    },
    [fieldName]
  );

  const handleMonacoChange = useCallback((getFieldsValue, setFieldsValue) => (value: string, e: monacoEditor.editor.IModelContentChangedEvent) => {
    const formValues = getFieldsValue();

    set(formValues, fieldName, value);

    setFieldsValue(formValues);
  }, [fieldName]);

  const formItemChild = useCallback(
    (getFieldsValue, setFieldsValue) => {
      switch (type) {
      case 'string':
      default:
        return <Input autoComplete="off" />;

      case 'json':
        return <MonacoEditor
          height="300"
          language="json"
          theme="own-theme"
          options={{
            glyphMargin: false,
            folding: false,
            lineNumbers: 'off',
            lineDecorationsWidth: 11,
            lineNumbersMinChars: 0,
            minimap: {
              enabled: false
            },
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8
            },
            padding: {
              top: 4,
              bottom: 4
            },
            hideCursorInOverviewRuler: true,
            overviewRulerLanes: 0
          }}
          onChange={handleMonacoChange(getFieldsValue, setFieldsValue)}
        />;

      case 'int':
        return <Input autoComplete="off" onChange={handleChange(getFieldsValue, setFieldsValue)} />;

      case 'selection':
        return <Select disabled={id === 'tap'}>
          {typeOptions.options.map(option => <Select.Option key={option.id} value={option.id}>{option.displayName}</Select.Option>)}
        </Select>
      }
    },
    [id, type, typeOptions, handleChange, handleMonacoChange]
  );

  const validationRules = useMemo(() => {
    const validators = [];

    if (required) {
      validators.push({ required, message: `${displayName} is required` })
    }

    if (type === 'isoUtcDate') {
      validators.push({
        validator: (rule, value) => isValidFullIsoDate(value)
          ? Promise.resolve()
          : Promise.reject('Please, fill in correct ISO 8601 date, YYYY-MM-DDThh:mm:ss[.SSS]')
      });
    }

    return validators;
  }, [type, required, displayName]);

  return (
    <Row>
      <Col span={16}>
        <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues[fieldName] !== currentValues[fieldName]}>
          {({ getFieldsValue, setFieldsValue }: FormInstance) => (
            <Form.Item
              initialValue={initialValue}
              className="form-field_fixed-label"
              label={documentation
                ? <LabelWithTooltip documentation={documentation} render={`${displayName}:`} />
                : <span>{displayName}:</span>}
              name={fieldName}
              rules={validationRules}
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              hidden={!!constant}
            >
              {formItemChild(getFieldsValue, setFieldsValue)}
            </Form.Item>
          )}
        </Form.Item>
      </Col>
    </Row>
  );
};

SourceFormConfigFieldComponent.displayName = 'SourceFormConfigField';

export const SourceFormConfigField = memo(SourceFormConfigFieldComponent);
