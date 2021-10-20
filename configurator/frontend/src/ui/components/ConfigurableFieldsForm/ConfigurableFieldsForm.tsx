// @Libs
import React, {ReactNode, useCallback, useEffect, useState} from 'react';
import {Button, Col, Form, FormItemProps, Input, Row, Select, Spin, Switch, Tooltip} from 'antd';
import debounce from 'lodash/debounce';
import get from 'lodash/get';
import cn from 'classnames';
// @Components
import {LabelWithTooltip} from 'ui/components/LabelWithTooltip/LabelWithTooltip';
import {EditableList} from 'lib/components/EditableList/EditableList';
import {CodeEditor} from 'ui/components/CodeEditor/CodeEditor';
import {FormValues as DebuggerFormValues} from 'ui/components/CodeDebugger/CodeDebugger';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Types
import {Parameter, ParameterType} from 'catalog/sources/types';
import {FormInstance} from 'antd/lib/form/hooks/useForm';
// @Utils
import {makeObjectFromFieldsValues} from 'utils/forms/marshalling';
import {isoDateValidator} from 'utils/validation/validators';
// @Hooks
import {useForceUpdate} from 'hooks/useForceUpdate';
// @Icons
import BugIcon from 'icons/bug';
import {ApiOutlined, CodeOutlined, EyeInvisibleOutlined, EyeOutlined} from '@ant-design/icons';
// @Styles
import styles from './ConfigurableFieldsForm.module.less';
import {CodeDebuggerModal} from '../CodeDebuggerModal/CodeDebuggerModal';
import {InputWithDebug} from "./InputWithDebug";

/**
 * @param loading if `true` shows loader instead of the fields.
 * Accepts `ReactNode` to show it instead of the default loader.
 */
export interface Props {
  fieldsParamsList: readonly Parameter[];
  form: FormInstance;
  initialValues: any;
  namePrefix?: string;
  loading?: boolean | ReactNode;
  handleTouchAnyField: (...args: any) => void;
}

export const FormItemName = {
  serialize: (id) => {
    return id;
  }
};

const services = ApplicationServices.get();

const ConfigurableFieldsFormComponent = ({
  fieldsParamsList,
  form,
  initialValues,
  loading,
  handleTouchAnyField
}: Props) => {
  const [debugModalsStates, setDebugModalsStates] = useState<{ [id: string] : boolean; }>({})
  const [debugModalsValues, setDebugModalsValues] = useState<{ [id: string] : string; }>({})

  const forceUpdate = useForceUpdate();

  const handleTouchField = debounce(handleTouchAnyField, 1000);

  const handleChangeIntInput = useCallback(
    (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = +e.target.value.replace(/\D/g, '') || '';
      form.setFieldsValue({ [id]: value });
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
  const handleOpenDebugger = useCallback(
      (id: string)  => {
        setDebugModalsValues({...debugModalsValues, [id]: form.getFieldValue(id)});
        setDebugModalsStates({...debugModalsStates, [id]: true})
      },
      [form]
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
    } else if (type === 'javascript') {
      calcValue = 'return {}';
    } else if (type.indexOf('array/') === 0) {
      calcValue = [];
    } else {
      calcValue = '';
    }

    return type === 'json' ? JSON.stringify(calcValue) : calcValue;
  };

  const getFieldComponent = (
    type: ParameterType<any>,
    id: string,
    defaultValue?: any,
    constantValue?: any,
    jsDebugger?: "object" | "string" | null,
    bigField?: boolean
  ) => {
    const fieldsValue = form.getFieldsValue();
    const defaultValueToDisplay =
      form.getFieldValue(id) ??
      getInitialValue(id, defaultValue, constantValue, type?.typeName);

    form.setFieldsValue({ id: defaultValueToDisplay });

    switch (type?.typeName) {
      case 'description':
        return <div className="pt-1.5">{defaultValue}</div>;
      case 'password':
        return (
          <Input.Password
            defaultValue={defaultValueToDisplay}
            autoComplete="off"
            iconRender={(visible) =>
              visible ? <EyeOutlined /> : <EyeInvisibleOutlined />
            }
          />
        );

      case 'int': {
        return (
          <Input
            defaultValue={defaultValueToDisplay}
            autoComplete="off"
            inputMode="numeric"
            onChange={handleChangeIntInput(id)}
          />
        );
      }
      // ToDo: check if it can be <select> in some cases
      case 'selection': {
        return (
          <Select
            defaultValue={defaultValueToDisplay}
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
      }
      case 'array/string':
        return <EditableList initialValue={defaultValueToDisplay} />;
      case 'javascript':
      case 'json': {
        return (
          <>
            <CodeEditor
              initialValue={defaultValueToDisplay}
              className={styles.codeEditor}
              language={type?.typeName}
              handleChange={handleJsonChange(id)}
            />
            <span className="z-50">
              {jsDebugger && (
                <Tooltip title="Open Editor">
                    {bigField ?
                        <Button
                            size="large"
                            className="absolute mr-0 mt-0 top-0 right-0"
                            type="text"
                            onClick={() => handleOpenDebugger(id)}
                            icon={<CodeOutlined />}
                        >
                          Open Editor
                        </Button>
                        :
                        <span className="absolute top-1.5 right-3">
                          <BugIcon onClick={() => handleOpenDebugger(id)} className={styles.bugIcon}/>
                        </span>
                    }
                </Tooltip>
              )}
            </span>
          </>
        );
      }

      case 'boolean':
        return (
          <Switch
            onChange={handleChangeSwitch(id)}
            defaultChecked={getInitialValue(id, false, '', '')}
          />
        );

      case 'string':
      default: {
        return (<InputWithDebug id={id}
                                jsDebugger={jsDebugger}
                                onButtonClick={() => handleOpenDebugger(id)}/>);
      }
    }
  };

  const handleDebuggerRun = async (debuggerType: "object" | "string", values: DebuggerFormValues) => {
    const data = {
      reformat: debuggerType == "string",
      expression: values.code,
      object: JSON.parse(values.object)
    };

    return services.backendApiClient.post(
      `/templates/evaluate?project_id=${services.activeProject.id}`,
      data,
      { proxy: true }
    );
  };

  const handleCloseDebugger = (id) => setDebugModalsStates({...debugModalsStates, [id]: false});

  const handleSaveDebugger = (id, value: string) => {
      form.setFieldsValue({ [id]: value });
      handleCloseDebugger(id)
  };

  useEffect(() => {
    /**
     *
     * 1st render:
     * component creates fields, fills them with values,
     * lets the `form` instance to pick them
     *
     */
    let formValues = {};
    const formFields: Parameters<typeof form.setFields>[0] = [];
    fieldsParamsList.forEach((param: Parameter) => {
      let constantValue: any;
      if (typeof param.constant === 'function') {
        constantValue = param.constant(makeObjectFromFieldsValues(formValues));
      }

      constantValue = constantValue || param.constant;

      const initialValue = getInitialValue(
        param.id,
        param.defaultValue,
        constantValue,
        param.type?.typeName
      );

      formValues[param.id] = initialValue;

      formFields.push({
        name: param.id,
        value: initialValue,
        touched: false
      });
    });
    // form.setFieldsValue(formValues);
    form.setFields(formFields);

    /**
     *
     * 2nd render: component removes/adds fields conditionally
     *  depending on the form values
     *
     */
    forceUpdate();
  }, []);

  return loading ? (
    typeof loading === 'boolean' ? (
      <Spin />
    ) : (
      <>{loading}</>
    )
  ) : (
    <>
      {fieldsParamsList.map(
        ({
          id,
          documentation,
          displayName,
          type,
          defaultValue,
          required,
          constant,
          omitFieldRule,
           jsDebugger,
            bigField
        }: Parameter) => {
          const currentFormValues = form.getFieldsValue() ?? {};
          const defaultFormValues = fieldsParamsList.reduce(
            (result, { id, defaultValue }) => ({
              ...result,
              [id]: defaultValue
            }),
            {}
          );
          const formItemName = id;
          const formValues = {
            ...defaultFormValues,
            ...currentFormValues
          };
          const parsedFormValues = makeObjectFromFieldsValues(formValues);
          const constantValue =
            typeof constant === 'function'
              ? constant?.(parsedFormValues)
              : constant;
          const isHidden = constantValue !== undefined;
          const isOmitted = omitFieldRule
            ? omitFieldRule(parsedFormValues)
            : false;

          const validationRules: FormItemProps['rules'] = [];
          if (!isHidden) {
            const isReuqired =
              typeof required === 'boolean'
                ? required
                : required?.(parsedFormValues);
            if (isReuqired)
              validationRules.push({
                required: true,
                message: `${displayName} field is required.`
              });
            if (type?.typeName === 'isoUtcDate')
              validationRules.push(
                isoDateValidator(`${displayName} field is required.`)
              );

            /**
             * Currently `antd` built in validations do not work as expected,
             * therefore validations are currently omitted
             *
             */
            if (type?.typeName === 'string') {
              // assertIsStringParameterType(type);
              // type.pattern &&
              //   validationRules.push({ pattern: new RegExp(type.pattern) });
            }
            if (type?.typeName === 'int') {
              // assertIsIntParameterType(type);
              // (type.minimum || type.maximum) &&
              //   validationRules.push({
              //     validator: (_, value) => {
              //       if (type.minimum && value < type.minimum)
              //         return Promise.reject(
              //           new Error(`value can't be lower than ${type.minimum}`)
              //         );
              //       if (type.maximum && value > type.maximum)
              //         return Promise.reject(
              //           new Error(`value can't be greater than ${type.maximum}`)
              //         );
              //       return Promise.resolve();
              //     }
              //   });
            }
          }

          return isOmitted ? null : !isHidden ? (
            <Row key={id} className={cn(isHidden && 'hidden')}>
              <Col span={24}>
                {jsDebugger ? (
                  <CodeDebuggerModal
                    visible={debugModalsStates[id]}
                    codeFieldLabelDebugger="Expression"
                    defaultCodeValueDebugger={debugModalsValues[id]}
                    handleCloseDebugger={() => handleCloseDebugger(id)}
                    runDebugger={(values) => handleDebuggerRun(jsDebugger, values)}
                    handleSaveCodeDebugger={(value) => handleSaveDebugger(id, value)}
                  />
                ) : null}
                <Form.Item
                  className={cn(
                    'form-field_fixed-label',
                    styles.field,
                    (type?.typeName === 'json' ||
                      type?.typeName === 'javascript') &&
                      styles.jsonField,
                      bigField &&styles.bigField
                  )}
                  name={formItemName}
                  label={ !bigField ? (
                    documentation ? (
                      <LabelWithTooltip
                        documentation={documentation}
                        render={displayName}
                      />
                    ) : (
                      <span>{displayName}:</span>
                    )) : (<span></span>)
                  }
                  labelCol={{ span: bigField ? 0 : 4 }}
                  wrapperCol={{ span: bigField ? 24 : 20 }}
                  rules={validationRules}
                >
                  {getFieldComponent(type, id, defaultValue, constantValue, jsDebugger, bigField)}
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

const ConfigurableFieldsForm = ConfigurableFieldsFormComponent;

// const ConfigurableFieldsForm = React.memo(
//   ConfigurableFieldsFormComponent,
//   isEqual
// );

// ConfigurableFieldsForm.displayName = 'ConfigurableFieldsForm';

export { ConfigurableFieldsForm };
