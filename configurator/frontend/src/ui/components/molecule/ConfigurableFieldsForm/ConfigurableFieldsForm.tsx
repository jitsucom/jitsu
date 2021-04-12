// @Libs
import React, { useCallback } from 'react';
import { Col, Form, Input, Radio, Row, Select, Switch } from 'antd';
import MonacoEditor from 'react-monaco-editor';
import { get } from 'lodash';
// @Components
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
import { EditableList } from '@./lib/components/EditableList/EditableList';
// @Types
import { Parameter, ParameterType } from '@catalog/sources/types';
import { Props } from './ConfigurableFieldsForm.types';
// @Utils
import { dsnValidator } from './configurableFieldsForm.utils';
// @Icons
import EyeTwoTone from '@ant-design/icons/lib/icons/EyeTwoTone';
import EyeInvisibleOutlined from '@ant-design/icons/lib/icons/EyeInvisibleOutlined';
import { makeObjectFromFieldsValues } from '@util/Form';
import { useForceUpdate } from '@hooks/useForceUpdate';

const ConfigurableFieldsForm = ({ fieldsParamsList, form }: Props) => {
  const forceUpdate = useForceUpdate();

  const handleRadioGroupChange = useCallback(() => forceUpdate(), [forceUpdate]);

  const handleChangeIntInput = useCallback((id: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');

    form.setFieldsValue({ [id]: value });
  }, [form]);

  const handleChangeSwitch = useCallback((id: string) => (value: boolean) => {
    form.setFieldsValue({ [id]: value });

    handleRadioGroupChange();
  }, [form, handleRadioGroupChange]);

  const getFieldComponent = useCallback((type: ParameterType<any>, id: string) => {
    const fieldsValue = form.getFieldsValue();

    switch (type?.typeName) {
    case 'password':
      return <Input.Password
        autoComplete="off"
        iconRender={visible => visible
          ? <EyeTwoTone />
          : <EyeInvisibleOutlined />}
      />;

    case 'int':
      return <Input autoComplete="off" onChange={handleChangeIntInput(id)} />;

      // ToDo: check if it can be <select> in some cases
    case 'selection':
      return type.data.options.length === 2
        ? <Radio.Group buttonStyle="solid" onChange={handleRadioGroupChange}>
          {
            type.data.options.map(({ id, displayName }: Option) =>
              <Radio.Button value={id} key={id}>{displayName}</Radio.Button>
            )
          }
        </Radio.Group>
        : <Select allowClear mode={type.data.maxOptions > 1
          ? 'multiple'
          : undefined}>
          {
            type.data.options.map(({ id, displayName }: Option) =>
              <Select.Option value={id} key={id}>{displayName}</Select.Option>
            )
          }
        </Select>;

    case 'array/string':
      return <EditableList newItemLabel="Add new server" validator={dsnValidator}/>;

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
      />;

    case 'boolean':
      return <Switch onChange={handleChangeSwitch(id)} checked={get(fieldsValue, id)} />

    case 'string':
    default:
      return <Input autoComplete="off" />;
    }
  }, [form, handleRadioGroupChange, handleChangeSwitch, handleChangeIntInput]);

  return (
    <>
      {
        fieldsParamsList.map((param: Parameter) => {
          const { id, documentation, displayName, defaultValue, type, required, constant } = param;

          const constantValue = typeof constant === 'function'
            ? constant?.(makeObjectFromFieldsValues(form.getFieldsValue() ?? {}))
            : constant;
          const isNull = constantValue !== undefined;

          return !isNull
            ? (
              <Row key={id}>
                <Col span={16}>
                  <Form.Item
                    className="form-field_fixed-label"
                    initialValue={defaultValue || constantValue}
                    name={id}
                    hidden={isNull}
                    label={
                      documentation ?
                        <LabelWithTooltip documentation={documentation} render={displayName} /> :
                        <span>{displayName}:</span>
                    }
                    labelCol={{ span: 6 }}
                    wrapperCol={{ span: 18 }}
                    rules={required
                      ? [{ required, message: `${displayName} field is required.` }]
                      : undefined}
                  >
                    {getFieldComponent(type, id)}
                  </Form.Item>
                </Col>
              </Row>
            )
            : null;
        })
      }
    </>
  );
};

ConfigurableFieldsForm.displayName = 'ConfigurableFieldsForm';

export { ConfigurableFieldsForm };
