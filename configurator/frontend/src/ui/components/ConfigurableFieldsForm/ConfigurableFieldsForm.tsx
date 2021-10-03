// @Libs
import React, {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import {
  Col,
  Form,
  Input,
  Row,
  Select,
  Switch,
  Tooltip,
  Spin,
  FormItemProps
} from 'antd';
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
import { CodeDebuggerModal } from '../CodeDebuggerModal/CodeDebuggerModal';

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

const debuggableFields = [
  '_formData.tableName',
  '_formData.body',
  '_formData.url',
  '_formData.dbtCause'
];
const isDebugSupported = function (id) {
  return debuggableFields.includes(id);
};

const services = ApplicationServices.get();

const ConfigurableFieldsForm = ({
  fieldsParamsList,
  form,
  initialValues,
  loading,
  handleTouchAnyField
}: Props) => {
  const debugModalsStates = {
    '_formData.tableName': useState<boolean>(false),
    '_formData.body': useState<boolean>(false),
    '_formData.url': useState<boolean>(false),
    '_formData.dbtCause': useState<boolean>(false)
  };
  const debugModalsValues = {
    '_formData.tableName': useRef<string>(),
    '_formData.body': useRef<string>(),
    '_formData.url': useRef<string>(),
    '_formData.dbtCause': useRef<string>()
  };
  const debugModalsReformat = {
    '_formData.tableName': true,
    '_formData.body': false,
    '_formData.url': false,
    '_formData.dbtCause': false
  };

  const handleTouchField = debounce(handleTouchAnyField, 1000);

  const forceUpdate = useForceUpdate();

  const handleChangeIntInput = useCallback(
    (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.replace(/\D/g, '');
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
    constantValue?: any
  ) => {
    const fieldsValue = form.getFieldsValue();
    const defaultValueToDisplay =
      form.getFieldValue(id) ||
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
              visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />
            }
          />
        );

      case 'int': {
        return (
          <Input
            defaultValue={defaultValueToDisplay}
            autoComplete="off"
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
            <span className="z-50 absolute top-2 right-3">
              {isDebugSupported(id) && (
                <Tooltip title="Debug expression">
                  <span onClick={() => debugModalsStates[id][1](true)}>
                    <BugIcon className={styles.bugIcon} />
                  </span>
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
        return (
          <Input
            defaultValue={defaultValueToDisplay}
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
    });
    form.setFieldsValue(formValues);

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
          omitFieldRule
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
                {isDebugSupported(id) ? (
                  <CodeDebuggerModal
                    visible={debugModalsStates[id][0]}
                    codeFieldLabelDebugger="Expression"
                    defaultCodeValueDebugger={get(initialValues, id)}
                    handleCloseDebugger={() => handleCloseDebugger(id)}
                    handleCodeChangeDebugger={(value) =>
                      handleCodeChange(id, value.toString())
                    }
                    runDebugger={(values) => handleDebuggerRun(id, values)}
                    handleSaveCodeDebugger={() => handleSaveDebugger(id)}
                  />
                ) : null}
                <Form.Item
                  className={cn(
                    'form-field_fixed-label',
                    styles.field,
                    (type?.typeName === 'json' ||
                      type?.typeName === 'javascript') &&
                      styles.jsonField
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
                  rules={validationRules}
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
