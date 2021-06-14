// @Libs
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Col, Form, Input, Modal, Row, Select, Switch, Tooltip } from 'antd';
import debounce from 'lodash/debounce';
import get from 'lodash/get';
import set from 'lodash/set';
import cn from 'classnames';
// @Components
import { LabelWithTooltip } from '@component/LabelWithTooltip/LabelWithTooltip';
import { CodeDebugger, FormValues as DebuggerFormValues } from '@component/CodeDebugger/CodeDebugger';
import { EditableList } from '@./lib/components/EditableList/EditableList';
import { CodeEditor } from '@component/CodeEditor/CodeEditor';
// @Types
import { Parameter, ParameterType } from '@catalog/sources/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
// @Utils
import { makeObjectFromFieldsValues } from '@util/forms/marshalling';
import { isoDateValidator } from '@util/validation/validators';
// @Hooks
import { useForceUpdate } from '@hooks/useForceUpdate';
// @Icons
import EyeTwoTone from '@ant-design/icons/lib/icons/EyeTwoTone';
import EyeInvisibleOutlined from '@ant-design/icons/lib/icons/EyeInvisibleOutlined';
import BugIcon from '@./icons/bug';
// @Styles
import styles from './ConfigurableFieldsForm.module.less';
// @Services
import ApplicationServices from '@service/ApplicationServices';
import { random } from 'lodash-es';
import { randomId } from '@util/numbers';

export interface Props {
  fieldsParamsList: Parameter[];
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

const ConfigurableFieldsForm = ({ fieldsParamsList, form, initialValues, handleTouchAnyField }: Props) => {
  const services = ApplicationServices.get();

  const [tableNameModal, switchTableNameModal] = useState<boolean>(false);

  const codeValue = useRef<string>();

  const handleTouchField = debounce(handleTouchAnyField, 1000);

  const forceUpdate = useForceUpdate();

  const tableNameDetected = useMemo(() => fieldsParamsList.some(param => param.id === '_formData.tableName'), [fieldsParamsList]);

  const handleChangeIntInput = useCallback((id: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');

    form.setFieldsValue({ [id]: value });
  }, [form]);

  const handleChangeSwitch = useCallback((id: string) => (value: boolean) => {
    form.setFieldsValue({ [id]: value });

    forceUpdate();
  }, [form, forceUpdate]);

  const handleJsonChange = (id: string) => (value: string) => {
    form.setFieldsValue({
      [id]: value ?
        value :
        ''
    });

    handleTouchField();
  };

  const getInitialValue = (id: string, defaultValue: any, constantValue: any, type: string) => {
    const initial = get(initialValues, id);

    if (initial) {
      return initial;
    }

    const calcValue = typeof defaultValue !== 'undefined'
      ?
      defaultValue
      :
      typeof constantValue !== 'undefined'
        ?
        constantValue
        :
        type === 'json'
          ?
          {}
          :
          '';

    return type === 'json' ? JSON.stringify(calcValue) : calcValue
  };
  useEffect(() => {
    //First pass - fill fixed parameter (not const and not defined by function)
    let formValues = {}
    fieldsParamsList.forEach((param: Parameter) => {
      if (typeof param.constant !== 'function') {
        const initialValue = getInitialValue(param.id, param.defaultValue, param.constant, param.type?.typeName);
        formValues[param.id] = initialValue;
      }
    });
    //second pass - fill dynamic values
    fieldsParamsList.forEach((param: Parameter) => {
      if (typeof param.constant === 'function') {
        const constantVal = param.constant(makeObjectFromFieldsValues(formValues));
        const initialValue = getInitialValue(param.id, param.defaultValue, constantVal, param.type?.typeName);
        formValues[param.id] = initialValue;
      }
    });
    form.setFieldsValue(formValues);
  }, [fieldsParamsList, form, initialValues])

  const getFieldComponent = useCallback((type: ParameterType<any>, id: string, defaultValue?: any, constantValue?: any) => {
    const fieldsValue = form.getFieldsValue();

    switch (type?.typeName) {
    case 'password':
      return <Input.Password autoComplete="off" iconRender={visible => visible ? <EyeTwoTone/> : <EyeInvisibleOutlined/>}/>;

    case 'int':
      return <Input autoComplete="off" onChange={handleChangeIntInput(id)}/>;

      // ToDo: check if it can be <select> in some cases
    case 'selection':
      return <Select allowClear mode={type.data.maxOptions > 1 ?
        'multiple' :
        undefined} onChange={forceUpdate}>
        {type.data.options.map(({ id, displayName }: Option) =>
          <Select.Option value={id} key={id}>{displayName}</Select.Option>
        )}
      </Select>;

    case 'array/string':
      return <EditableList/>;

    case 'json': {
      const value = form.getFieldValue(id);
      return <CodeEditor handleChange={handleJsonChange(id)} initialValue={value ?
        value :
        getInitialValue(id, defaultValue, constantValue, type?.typeName)}/>;
    }

    case 'boolean':
      return <Switch onChange={handleChangeSwitch(id)} checked={get(fieldsValue, id)}/>

    case 'string':
    default:
      return <Input
        autoComplete="off"
        suffix={id === '_formData.tableName' && <Tooltip title="Debug expression">
          <span><BugIcon className={styles.bugIcon} onClick={() => switchTableNameModal(true)}/></span>
        </Tooltip>}
      />;
    }
  }, [handleJsonChange, form, handleChangeSwitch, handleChangeIntInput, forceUpdate]);

  const handleDebuggerRun = async(values: DebuggerFormValues) => {
    const data = {
      reformat: true,
      expression: values.code,
      object: JSON.parse(values.object)
    };

    return services.backendApiClient.post(`/templates/evaluate?project_id=${services.activeProject.id}`, data, { proxy: true });
  };

  const handleCodeChange = (value: string) => {
    codeValue.current = value.replace(/[\r\n]+/g, '');
  };

  const handleCloseDebugger = () => switchTableNameModal(false);

  const handleSaveTableName = () => {
    if (codeValue.current) {
      form.setFieldsValue({ '_formData.tableName': codeValue.current });
    }

    handleCloseDebugger();
  };

  return (
    <>
      {
        tableNameDetected && (
          <Modal
            className={styles.modal}
            closable={false}
            maskClosable={false}
            onCancel={handleCloseDebugger}
            onOk={handleSaveTableName}
            okText="Save table name template"
            visible={tableNameModal}
            wrapClassName={styles.modalWrap}
            width="80%"
          >
            <CodeDebugger
              className="pb-2"
              codeFieldLabel="Expression"
              defaultCodeValue={get(initialValues, '_formData.tableName')}
              handleClose={handleCloseDebugger}
              handleCodeChange={handleCodeChange}
              run={handleDebuggerRun}
            />
          </Modal>
        )
      }

      {
        fieldsParamsList.map((param: Parameter) => {
          const { id, documentation, displayName, type, defaultValue, required, constant } = param;

          const currentFormValues = makeObjectFromFieldsValues(form.getFieldsValue() ?? {});
          const constantValue = typeof param.constant === 'function' ?
            param.constant?.(currentFormValues) :
            param.constant;
          const isHidden = constantValue !== undefined;
          const formItemName = id;

          return !isHidden ?  <Row key={id} className={cn(isHidden && 'hidden')}>
            <Col span={24}>
              <Form.Item
                //key={formItemName}
                className={cn('form-field_fixed-label', styles.field, type?.typeName === 'json' && styles.jsonField)}
                //                initialValue={initialValue}
                name={formItemName}
                label={documentation ?
                  <LabelWithTooltip documentation={documentation} render={displayName}/> :
                  <span>{displayName}:</span>
                }
                labelCol={{ span: 4 }}
                wrapperCol={{ span: 20 }}
                rules={
                  type?.typeName === 'isoUtcDate' ?
                    [isoDateValidator(`${displayName} field is required.`)] :
                    [{
                      required: typeof required === 'boolean' ?
                        required :
                        required?.(currentFormValues), message: `${displayName} field is required.`
                    }]
                }
              >
                {getFieldComponent(type, id, defaultValue, constantValue)}
              </Form.Item>
            </Col>
          </Row> : <Form.Item
            key={formItemName}
            name={formItemName}
            hidden={true}
            initialValue={constantValue}
          />;
        })
      }
    </>
  );
};

ConfigurableFieldsForm.displayName = 'ConfigurableFieldsForm';

export { ConfigurableFieldsForm };
