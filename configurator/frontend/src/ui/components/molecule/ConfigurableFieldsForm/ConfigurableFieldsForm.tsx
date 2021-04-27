// @Libs
import React, { useCallback } from 'react';
import { Col, Form, Input, Row, Select, Switch } from 'antd';
import MonacoEditor from 'react-monaco-editor';
import { get } from 'lodash';
// @Components
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
import { EditableList } from '@./lib/components/EditableList/EditableList';
// @Types
import { Parameter, ParameterType } from '@catalog/sources/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
// @Utils
import { dsnValidator } from './configurableFieldsForm.utils';
import { makeObjectFromFieldsValues } from '@util/forms/marshalling';
import { validationChain } from '@util/validation/validationChain';
import { isoDateValidator, requiredValidator } from '@util/validation/validators';
// @Hooks
import { useForceUpdate } from '@hooks/useForceUpdate';
// @Icons
import EyeTwoTone from '@ant-design/icons/lib/icons/EyeTwoTone';
import EyeInvisibleOutlined from '@ant-design/icons/lib/icons/EyeInvisibleOutlined';

export interface Props {
  fieldsParamsList: Parameter[];
  form: FormInstance;
  initialValues: any;
  namePrefix?: string;
}

const ConfigurableFieldsForm = ({ fieldsParamsList, form, initialValues, namePrefix }: Props) => {
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
      return <Select allowClear mode={type.data.maxOptions > 1 ? 'multiple' : undefined}>
        {type.data.options.map(({ id, displayName }: Option) =>
          <Select.Option value={id} key={id}>{displayName}</Select.Option>
        )}
      </Select>;

    case 'array/string':
      return <EditableList newItemLabel="Add new server" validator={dsnValidator} />;

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
  }, [form, handleChangeSwitch, handleChangeIntInput]);

  const getInitialValue = useCallback((id: string, defaultValue: any, constantValue: any, type: string) => {
    const initial = get(initialValues, id);

    if (initial) {
      return initial;
    }

    const calcValue = (defaultValue || constantValue) ?? {};

    return type === 'json'
      ? Object.keys(calcValue).length > 0
        ? JSON.stringify(calcValue)
        : ''
      : (defaultValue || constantValue) ?? '';
  }, [initialValues]);

  return (
    <>
      {
        fieldsParamsList.map((param: Parameter) => {
          const { id, documentation, displayName, type, defaultValue, required, constant } = param;

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
                    initialValue={getInitialValue(id, defaultValue, constantValue, type.typeName)}
                    name={id}
                    hidden={isNull}
                    label={
                      documentation ?
                        <LabelWithTooltip documentation={documentation} render={displayName} /> :
                        <span>{displayName}:</span>
                    }
                    labelCol={{ span: 6 }}
                    wrapperCol={{ span: 18 }}
                    rules={
                      validationChain(
                        requiredValidator(required, displayName),
                        type.typeName === 'isoUtcDate' && isoDateValidator()
                      )
                    }
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
