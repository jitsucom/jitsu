// @Libs
import React, {memo, useCallback, useEffect, useMemo, useState} from 'react';
import { Form, FormInstance, Input } from 'antd';
import { set } from 'lodash';
import * as codemirror from "codemirror";
import { UnControlled as CodeMirror } from 'react-codemirror2'
// @Types
import { SourceFormConfigFieldProps as Props } from './SourceForm.types';
// @Components
import { LabelWithTooltip } from "../../../../../../lib/components/components";
// @Utils
import 'codemirror/mode/javascript/javascript';
// @Styles
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/material.css';

let _editor = null as codemirror.Editor;

const SourceFormConfigFieldComponent = ({ displayName, initialValue, required, id, type, documentation }: Props) => {
  const fieldName = useMemo(() => `config.${id}`, [id]);

  const [jsonValue, setJsonValue] = useState<any>();

  const options: codemirror.EditorConfiguration = {
      value: '',
      mode: 'string',
      theme: 'material',
      lineNumbers: false
  };

  const handleChange = useCallback(
    (getFieldsValue, setFieldsValue) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const formValues = getFieldsValue();
      const value = e.target.value.replace(/\D/g, '');

      set(formValues, fieldName, value);

      setFieldsValue(formValues);
    },
    [fieldName]
  );

  const formItemChild = useCallback(
    (getFieldsValue, setFieldsValue) => {
      switch (type) {
      case 'string':
      default:
        return <Input />;

      case 'json':
        return <CodeMirror
            options={options}
            editorDidMount={(editor: codemirror.Editor) => {
                _editor = editor;
                _editor.setValue('');
            }}
            onChange={(editor: codemirror.Editor, data: codemirror.EditorChange, value: string) => {
                console.log('editor: ', editor);
                console.log('data: ', data);
                console.log('value: ', value);
                console.log('_____________________________');
            }}
        />;
      case 'int':
        return <Input onChange={handleChange(getFieldsValue, setFieldsValue)} />;
      }
    },
    [type, handleChange]
  );

    useEffect(() => {
        _editor?.setValue('')
    }, [])

  return (
    <div className="test-test">
      <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues[fieldName] !== currentValues[fieldName]}>
        {({ getFieldsValue, setFieldsValue }: FormInstance) => (
          <Form.Item
            initialValue={initialValue}
            className="form-field_fixed-label"
            label={documentation ? <LabelWithTooltip documentation={documentation}>{displayName}</LabelWithTooltip> : <span className="field-label">{displayName}</span>}
            name={fieldName}
            rules={required ? [{ required, message: `${displayName} is required` }] : undefined}
          >
            {formItemChild(getFieldsValue, setFieldsValue)}
          </Form.Item>
        )}
      </Form.Item>
    </div>
  );
};

SourceFormConfigFieldComponent.displayName = 'SourceFormConfigField';

export const SourceFormConfigField = memo(SourceFormConfigFieldComponent);
