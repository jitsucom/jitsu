// @Libs
import React, { memo, useCallback, useMemo } from 'react';
import { Col, Form, FormInstance, Input, Row } from 'antd';
import { set } from 'lodash';
import * as monacoEditor from 'monaco-editor';
import MonacoEditor from 'react-monaco-editor';
// @Types
import { SourceFormConfigFieldProps as Props } from './SourceForm.types';
// @Components
import { LabelWithTooltip } from '@./lib/components/components';

const SourceFormConfigFieldComponent = ({ displayName, initialValue, required, id, type, documentation }: Props) => {
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
            lineNumbers: 'off',
            minimap: {
              enabled: false
            },
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8
            }
          }}
          onChange={handleMonacoChange(getFieldsValue, setFieldsValue)}
        />;

      case 'int':
        return <Input autoComplete="off" onChange={handleChange(getFieldsValue, setFieldsValue)} />;
      }
    },
    [type, handleChange, handleMonacoChange]
  );

  return (
    <Row>
      <Col span={16}>
        <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues[fieldName] !== currentValues[fieldName]}>
          {({ getFieldsValue, setFieldsValue }: FormInstance) => (
            <Form.Item
              initialValue={initialValue}
              className="form-field_fixed-label"
              label={documentation
                ? <LabelWithTooltip documentation={documentation}>{displayName}:</LabelWithTooltip>
                : <span>{displayName}:</span>}
              name={fieldName}
              rules={required
                ? [{ required, message: `${displayName} is required` }]
                : undefined}
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
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
