// @Libs
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Col, Form, Input, Row, Select, Switch, Tooltip, Modal } from 'antd';
import debounce from 'lodash/debounce';
import get from 'lodash/get';
import cn from 'classnames';
// @Components
import { LabelWithTooltip } from 'ui/components/LabelWithTooltip/LabelWithTooltip';
import { EditableList } from 'lib/components/EditableList/EditableList';
import { CodeEditor } from 'ui/components/CodeEditor/CodeEditor';
import {
  CodeDebugger,
  FormValues as DebuggerFormValues
} from 'ui/components/CodeDebugger/CodeDebugger';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Types
import { Parameter, ParameterType } from 'catalog/sources/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
// @Utils
import { makeObjectFromFieldsValues } from 'utils/forms/marshalling';
import { isoDateValidator } from 'utils/validation/validators';
// @Hooks
import { useForceUpdate } from 'hooks/useForceUpdate';
// @Icons
import EyeTwoTone from '@ant-design/icons/lib/icons/EyeTwoTone';
import EyeInvisibleOutlined from '@ant-design/icons/lib/icons/EyeInvisibleOutlined';
import BugIcon from 'icons/bug';
// @Styles
import styles from './ConfigurableFieldsForm.module.less';

export interface Props {
  fieldsParamsList: readonly Parameter[];
  form: FormInstance;
  initialValues: any;
  namePrefix?: string;
  handleTouchAnyField: VoidFunc;
}

export const FormItemName = {
  serialize: (id) => {
    return id;
  }
}

const debuggableFields = ['_formData.tableName', '_formData.body', '_formData.url']
const isDebugSupported = function(id) {return debuggableFields.includes(id)}

const services = ApplicationServices.get();

const ConfigurableFieldsForm = ({
  fieldsParamsList,
  form,
  initialValues,
  handleTouchAnyField
}: Props) => {
  const debugModalsStates = {
    '_formData.tableName': useState<boolean>(false),
    '_formData.body': useState<boolean>(false),
    '_formData.url': useState<boolean>(false)
  };
  const debugModalsValues = {
    '_formData.tableName': useRef<string>(),
    '_formData.body': useRef<string>(),
    '_formData.url': useRef<string>()
  };
  const debugModalsReformat = {
    '_formData.tableName': true,
    '_formData.body': false,
    '_formData.url': false
  };

  const handleTouchField = debounce(handleTouchAnyField, 1000);

  const forceUpdate = useForceUpdate();

  const handleChangeIntInput = useCallback(
    (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.replace(/\D/g, '');
      form.setFieldsValue({ [id]: value });
      debugModalsValues[id].current = value;
    },
    [form]
  );

  const handleChangeSwitch = useCallback(
    (id: string) => (value: boolean) => {
      form.setFieldsValue({ [id]: value });
      forceUpdate();
    },
    [form, forceUpdate]
  );

  const handleJsonChange = (id: string) => (value: string) => {
    form.setFieldsValue({
      [id]: value ? value : ''
    });
    handleTouchField();
  };

  const getInitialValue = (
    id: string,
    defaultValue: any,
    constantValue: any,
    type: string
  ) => {
    const initial = get(initialValues, id);

    if (initial) {
      return initial;
    }

    let calcValue: any;
    if (typeof defaultValue !== 'undefined') {
      calcValue = defaultValue;
    } else if (typeof constantValue !== 'undefined') {
      calcValue = constantValue;
    } else if (type === 'json') {
      calcValue = {};
    } else if (type.indexOf('array/') === 0) {
      calcValue = [];
    } else {
      calcValue = '';
    }

    return type === 'json' ? JSON.stringify(calcValue) : calcValue;
  };
  useEffect(() => {
    //First pass - fill fixed parameter (not const and not defined by function)
    let formValues = {};
    fieldsParamsList.forEach((param: Parameter) => {
      if (typeof param.constant !== 'function') {
        const initialValue = getInitialValue(
          param.id,
          param.defaultValue,
          param.constant,
          param.type?.typeName
        );
        formValues[param.id] = initialValue;
      }
    });
    //second pass - fill dynamic values
    fieldsParamsList.forEach((param: Parameter) => {
      if (typeof param.constant === 'function') {
        const constantVal = param.constant(
          makeObjectFromFieldsValues(formValues)
        );
        const initialValue = getInitialValue(
          param.id,
          param.defaultValue,
          constantVal,
          param.type?.typeName
        );
        formValues[param.id] = initialValue;
      }
    });
    form.setFieldsValue(formValues);
  }, [fieldsParamsList, form, initialValues]);

  const getFieldComponent = (
      type: ParameterType<any>,
      id: string,
      defaultValue?: any,
      constantValue?: any
    ) => {
      const fieldsValue = form.getFieldsValue();

      switch (type?.typeName) {
        case 'password':
          return (
            <Input.Password
              autoComplete="off"
              iconRender={(visible) =>
                visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />
              }
            />
          );

        case 'int':
          return (
            <Input autoComplete="off" onChange={handleChangeIntInput(id)} />
          );

        // ToDo: check if it can be <select> in some cases
        case 'selection':
          return (
            <Select
              allowClear
              mode={type.data.maxOptions > 1 ? 'multiple' : undefined}
              onChange={forceUpdate}
            >
              {type.data.options.map(({ id, displayName }: Option) => {
                return (
                  <Select.Option value={id} key={id}>
                    {displayName}
                  </Select.Option>
                );
              })}
            </Select>
          );

        case 'array/string':
          const value = 
            form.getFieldValue(id) || 
            getInitialValue(
              id,
              defaultValue,
              constantValue,
              type?.typeName
            );
          return <EditableList initialValue={value} />;
        case 'json': {
          const value = 
            form.getFieldValue(id) || 
            getInitialValue(
              id,
              defaultValue,
              constantValue,
              type?.typeName
            );
          return (
            <div>
              <div>
                <CodeEditor
                  handleChange={handleJsonChange(id)}
                  initialValue={value}
                  language="javascript"
                />
              </div>
              <div
                style={{
                  textAlign: 'right',
                  zIndex: 1000,
                  position: 'relative',
                  paddingRight: 12,
                  paddingTop: 5
                }}
              >
                {isDebugSupported(id) && (
                  <Tooltip title="Debug expression">
                    <span onClick={() => debugModalsStates[id][1](true)}>
                      <BugIcon className={styles.bugIcon} />
                    </span>
                  </Tooltip>
                )}
              </div>
            </div>
          );
        }

        case 'boolean':
          return (
            <Switch
              onChange={handleChangeSwitch(id)}
              checked={get(fieldsValue, id)}
            />
          );

        case 'string':
        default:
          return (
            <Input
              autoComplete="off"
              suffix={
                isDebugSupported(id) && (
                  <Tooltip title="Debug expression">
                    <span>
                      <BugIcon
                        className={styles.bugIcon}
                        onClick={() => debugModalsStates[id][1](true)}
                      />
                    </span>
                  </Tooltip>
                )
              }
            />
          );
      }
    };

  const handleDebuggerRun = async (id: string, values: DebuggerFormValues) => {
    const data = {
      reformat: debugModalsReformat[id],
      expression: values.code,
      object: JSON.parse(values.object)
    };

    return services.backendApiClient.post(
      `/templates/evaluate?project_id=${services.activeProject.id}`,
      data,
      { proxy: true }
    );
  };

  const handleCodeChange = (id: string, value: string) => {
    debugModalsValues[id].current = value;
  };

  const handleCloseDebugger = (id) => debugModalsStates[id][1](false);

  const handleSaveDebugger = (id) => {
    if (debugModalsValues[id].current) {
      form.setFieldsValue({ [id]: debugModalsValues[id].current });
    }
    handleCloseDebugger(id);
  };

  return (
    <>
      {fieldsParamsList.map(
        ({
          id,
          documentation,
          displayName,
          type,
          defaultValue,
          required,
          constant
        }: Parameter) => {
          const currentFormValues = form.getFieldsValue() ?? {};
          const formIsEmpty: boolean = !Object.keys(currentFormValues).length; // will be true during the first render
          const formValuesToConsider = formIsEmpty 
            ? fieldsParamsList.reduce( 
              (result, {id, defaultValue}) => ({...result, [id]: defaultValue}), // so need to use default values instead
              {}
            ) : currentFormValues;
          const parsedFormValues = makeObjectFromFieldsValues(formValuesToConsider);
          const constantValue =
            typeof constant === 'function'
              ? constant?.(parsedFormValues)
              : constant;
          const isHidden = constantValue !== undefined;
          const formItemName = id;
          debugger;
          return !isHidden ? (
            <Row key={id} className={cn(isHidden && 'hidden')}>
              <Col span={24}>
                {isDebugSupported(id) ? (
                  <Modal
                    className={styles.modal}
                    closable={false}
                    maskClosable={false}
                    onCancel={() => handleCloseDebugger(id)}
                    onOk={() => handleSaveDebugger(id)}
                    okText={`Save ${displayName} template`}
                    visible={debugModalsStates[id][0]}
                    wrapClassName={styles.modalWrap}
                    width="80%"
                  >
                    <CodeDebugger
                      className="pb-2"
                      codeFieldLabel="Expression"
                      defaultCodeValue={get(initialValues, id)}
                      handleClose={() => handleCloseDebugger(id)}
                      handleCodeChange={(value) =>
                        handleCodeChange(id, value.toString())
                      }
                      run={(values) => handleDebuggerRun(id, values)}
                    />
                  </Modal>
                ) : null}
                <Form.Item
                  className={cn(
                    'form-field_fixed-label',
                    styles.field,
                    type?.typeName === 'json' && styles.jsonField
                  )}
                  name={formItemName}
                  label={
                    documentation ? (
                      <LabelWithTooltip
                        documentation={documentation}
                        render={displayName}
                      />
                    ) : (
                      <span>{displayName}:</span>
                    )
                  }
                  labelCol={{ span: 4 }}
                  wrapperCol={{ span: 20 }}
                  rules={
                    type?.typeName === 'isoUtcDate'
                      ? [isoDateValidator(`${displayName} field is required.`)]
                      : [
                          {
                            required:
                              typeof required === 'boolean'
                                ? required
                                : required?.(parsedFormValues),
                            message: `${displayName} field is required.`
                          }
                        ]
                  }
                >
                  {getFieldComponent(type, id, defaultValue, constantValue)}
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Form.Item
              key={formItemName}
              name={formItemName}
              hidden={true}
              initialValue={constantValue}
            />
          );
        }
      )}
    </>
  );
};


ConfigurableFieldsForm.displayName = 'ConfigurableFieldsForm';

export { ConfigurableFieldsForm };
