// @Libs
import React, { memo, useCallback, useMemo } from 'react';
import { Col, Form, FormInstance, Input, Row, Select } from 'antd';
import { set } from 'lodash';
import * as monacoEditor from 'monaco-editor';
import MonacoEditor from 'react-monaco-editor';
// @Types
import { SourceFormConfigFieldProps as Props } from './SourceForm.types';
// @Components
import { LabelWithTooltip } from '@./lib/components/components';

const SourceFormConfigFieldComponent = ({ displayName, initialValue, required, id, type, documentation, typeOptions, preselectedTypeOption }: Props) => {
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

  return (
    <Row>
      <Col span={16}>
        <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues[fieldName] !== currentValues[fieldName]}>
          {({ getFieldsValue, setFieldsValue }: FormInstance) => (
            <Form.Item
              initialValue={preselectedTypeOption ?? initialValue}
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
