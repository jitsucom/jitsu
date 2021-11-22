// @Libs
import * as React from "react"
import { ReactNode, useCallback, useEffect, useState } from "react"
import { Button, Col, Form, FormItemProps, Input, InputNumber, Row, Select, Spin, Switch, Tooltip } from "antd"
import debounce from "lodash/debounce"
import get from "lodash/get"
import cn from "classnames"
// @Components
import { LabelWithTooltip } from "ui/components/LabelWithTooltip/LabelWithTooltip"
import { EditableList } from "lib/components/EditableList/EditableList"
import { CodeEditor } from "ui/components/CodeEditor/CodeEditor"
import { FormValues as DebuggerFormValues } from "ui/components/CodeDebugger/CodeDebugger"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Types
import { Parameter, ParameterType } from "catalog/sources/types"
import { FormInstance } from "antd/lib/form/hooks/useForm"
// @Utils
import { makeObjectFromFieldsValues } from "utils/forms/marshalling"
import { isoDateValidator } from "utils/validation/validators"
// @Hooks
import { useForceUpdate, useForceUpdateTarget } from "hooks/useForceUpdate"
// @Icons
import BugIcon from "icons/bug"
import { CodeOutlined, EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons"
// @Styles
import styles from "./ConfigurableFieldsForm.module.less"
import { CodeDebuggerModal } from "../CodeDebuggerModal/CodeDebuggerModal"
import { InputWithDebug } from "./InputWithDebug"
import { SwitchWithLabel } from "./SwitchWithLabel"
import set from "lodash/set"
import { InputWithUpload } from "./InputWithUpload"
import { InputOauthSecret } from "lib/components/InputOauthSecret/InputOauthSecret"

/**
 * @param loading if `true` shows loader instead of the fields.
 * Accepts `ReactNode` to show it instead of the default loader.
 */
export interface Props {
  fieldsParamsList: readonly Parameter[]
  form: FormInstance
  configForm?: FormInstance
  initialValues: any
  loading?: boolean | ReactNode
  oauthStatus?: "loading" | "secrets_set" | "secrets_not_set"
  handleTouchAnyField?: (...args: any) => void
  setFormValues?: (values: PlainObjectWithPrimitiveValues) => void
  setInitialFormValues?: (values: PlainObjectWithPrimitiveValues) => void
}

export const FormItemName = {
  serialize: id => {
    return id
  },
}

const services = ApplicationServices.get()

const ConfigurableFieldsFormComponent = ({
  fieldsParamsList,
  form,
  configForm,
  initialValues,
  loading,
  oauthStatus,
  handleTouchAnyField,
  setFormValues,
  setInitialFormValues,
}: Props) => {
  const [debugModalsStates, setDebugModalsStates] = useState<{ [id: string]: boolean }>({})
  const [debugModalsValues, setDebugModalsValues] = useState<{ [id: string]: string }>({})

  const forceUpdateAll = useForceUpdate()
  const { forceUpdatedTargets, forceUpdateTheTarget } = useForceUpdateTarget()

  const handleTouchField = debounce(handleTouchAnyField ?? (() => {}), 1000)

  const handleChangeIntInput = useCallback(
    (id: string) => (value: number) => {
      form.setFieldsValue({ [id]: value })
    },
    [form]
  )

  const handleChangeTextInput = useCallback(
    (id: string) => (value: string) => {
      form.setFieldsValue({ [id]: value })
    },
    [form]
  )

  const handleChangeSwitch = useCallback(
    (id: string) => (value: boolean) => {
      form.setFieldsValue({ [id]: value })
      handleTouchAnyField?.()
      forceUpdateAll()
    },
    [form, forceUpdateAll]
  )
  const handleOpenDebugger = useCallback(
    (id: string) => {
      setDebugModalsValues({ ...debugModalsValues, [id]: form.getFieldValue(id) })
      setDebugModalsStates({ ...debugModalsStates, [id]: true })
    },
    [form]
  )

  const handleJsonChange = (id: string) => (value: string) => {
    const values = {
      [id]: value ? value : "",
    }
    setFormValues?.(values)
    form.setFieldsValue(values)
    handleTouchField()
  }

  const getInitialValue = (id: string, defaultValue: any, constantValue: any, type: string) => {
    const initial = get(initialValues, id)
    if (typeof initial !== "undefined") {
      return initial
    }

    let calcValue: any
    if (typeof defaultValue !== "undefined") {
      calcValue = defaultValue
    } else if (typeof constantValue !== "undefined") {
      calcValue = constantValue
    } else if (type === "json") {
      calcValue = {}
    } else if (type === "javascript") {
      calcValue = "return {}"
    } else if (type.indexOf("array/") === 0) {
      calcValue = []
    } else {
      calcValue = ""
    }

    return type === "json" ? JSON.stringify(calcValue) : calcValue
  }

  const getFieldComponent = (
    type: ParameterType<any>,
    id: string,
    defaultValue?: any,
    constantValue?: any,
    jsDebugger?: "object" | "string" | null,
    bigField?: boolean,
    displayName?: string,
    codeSuggestions?: string,
    documentation?: React.ReactNode,
    validationRules?: FormItemProps["rules"]
  ) => {
    const defaultValueToDisplay =
      form.getFieldValue(id) ?? getInitialValue(id, defaultValue, constantValue, type?.typeName)
    form.setFieldsValue({ id: defaultValueToDisplay })

    const FormItemWoStylesTuned: React.FC = ({ children }) => {
      return <FormItemWrapperWoStyles id={id}>{children}</FormItemWrapperWoStyles>
    }

    const FormItemWrapperTuned: React.FC = ({ children }) => {
      return (
        <FormItemWrapper
          type={type}
          id={id}
          displayName={displayName}
          documentation={documentation}
          validationRules={validationRules}
        >
          {children}
        </FormItemWrapper>
      )
    }

    const NonFormItemWrapperTuned: React.FC = ({ children }) => {
      return (
        <NonFormItemWrapper
          id={id}
          displayName={displayName}
          documentation={documentation}
          validationRules={validationRules}
        >
          {children}
        </NonFormItemWrapper>
      )
    }

    switch (type?.typeName) {
      case "password":
        return (
          <FormItemWrapperTuned>
            <Input.Password
              autoComplete="off"
              iconRender={visible => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
            />
          </FormItemWrapperTuned>
        )

      case "int": {
        return (
          <FormItemWrapperTuned>
            <InputNumber autoComplete="off" inputMode="numeric" onChange={handleChangeIntInput(id)} />
          </FormItemWrapperTuned>
        )
      }
      // ToDo: check if it can be <select> in some cases
      case "selection": {
        return (
          <FormItemWrapperTuned>
            <Select
              allowClear
              mode={type.data.maxOptions > 1 ? "multiple" : undefined}
              onChange={() => forceUpdateTheTarget("select")}
            >
              {type.data.options.map(({ id, displayName }: Option) => {
                return (
                  <Select.Option value={id} key={id}>
                    {displayName}
                  </Select.Option>
                )
              })}
            </Select>
          </FormItemWrapperTuned>
        )
      }
      case "array/string":
        return <EditableList initialValue={defaultValueToDisplay} />
      case "javascript":
      case "json": {
        return (
          <FormItemWrapperTuned>
            <CodeEditor
              initialValue={defaultValueToDisplay}
              className={styles.codeEditor}
              extraSuggestions={codeSuggestions}
              language={type?.typeName}
              handleChange={handleJsonChange(id)}
            />
            <span className="z-50">
              {jsDebugger && (
                <>
                  {bigField ? (
                    <Button
                      size="large"
                      className="absolute mr-0 mt-0 top-0 right-0"
                      type="text"
                      onClick={() => handleOpenDebugger(id)}
                      icon={<CodeOutlined />}
                    >
                      Open Debugger
                    </Button>
                  ) : (
                    <Tooltip title="Debug expression">
                      <span className="absolute top-1.5 right-3">
                        <BugIcon onClick={() => handleOpenDebugger(id)} className={styles.bugIcon} />
                      </span>
                    </Tooltip>
                  )}
                </>
              )}
            </span>
          </FormItemWrapperTuned>
        )
      }

      case "boolean":
        return (
          <FormItemWrapperTuned>
            {bigField ? (
              <SwitchWithLabel
                label={displayName}
                id={id}
                onChange={handleChangeSwitch(id)}
                defaultChecked={!!defaultValueToDisplay}
              />
            ) : (
              <Switch className={"mb-0.5"} onChange={handleChangeSwitch(id)} defaultChecked={!!defaultValueToDisplay} />
            )}
          </FormItemWrapperTuned>
        )

      case "file":
        return (
          <FormItemWrapperTuned>
            <InputWithUpload onChange={handleChangeTextInput(id)} value={defaultValueToDisplay} />
          </FormItemWrapperTuned>
        )

      case "oauthSecret":
        return (
          <NonFormItemWrapperTuned>
            <InputOauthSecret status={oauthStatus ?? "secrets_not_set"} inputWrapper={FormItemWoStylesTuned} />
          </NonFormItemWrapperTuned>
        )

      case "description":
        return (
          <div className="ant-row ant-form-item form-field_fixed-label">
            <div className="ant-col ant-col-4 ant-form-item-label">
              <label>{displayName}:</label>
            </div>
            <div className="ant-col ant-col-20 ant-form-item-control pt-1.5">{defaultValue}</div>
          </div>
        )

      case "string":
      default: {
        return (
          <FormItemWrapperTuned>
            <InputWithDebug id={id} jsDebugger={jsDebugger} onButtonClick={() => handleOpenDebugger(id)} />
          </FormItemWrapperTuned>
        )
      }
    }
  }

  const handleDebuggerRun = async (field: string, debuggerType: "object" | "string", values: DebuggerFormValues) => {
    const data = {
      reformat: debuggerType == "string",
      uid: initialValues._uid,
      type: initialValues._type,
      field: field,
      expression: values.code,
      object: JSON.parse(values.object),
      template_variables: Object.entries((configForm || form).getFieldsValue())
        .filter(v => v[0].startsWith("_formData._"))
        .reduce((accumulator: any, currentValue: [string, unknown]) => {
          set(accumulator, currentValue[0].replace("_formData._", ""), currentValue[1])
          return accumulator
        }, {}),
    }

    return services.backendApiClient.post(`/templates/evaluate?project_id=${services.activeProject.id}`, data, {
      proxy: true,
    })
  }

  const handleCloseDebugger = id => setDebugModalsStates({ ...debugModalsStates, [id]: false })

  const handleSaveDebugger = (id, value: string) => {
    form.setFieldsValue({ [id]: value })
    handleCloseDebugger(id)
  }

  /**
   * Runs after every re-render caused by `Select` field change
   * to pick up the values of conditionally rendered fields.
   */
  useEffect(() => {
    const isInitialRender = !forceUpdatedTargets["select"]
    if (!isInitialRender) setFormValues?.(form.getFieldsValue())
  }, [forceUpdatedTargets["select"]])

  useEffect(() => {
    /**
     *
     * 1st render:
     * component creates fields, fills them with values,
     * lets the `form` instance to pick them
     *
     */
    let formValues = {}
    const formFields: Parameters<typeof form.setFields>[0] = []
    fieldsParamsList.forEach((param: Parameter) => {
      let constantValue: any
      const initConfig = makeObjectFromFieldsValues(formValues)
      const fieldNeeded = !param.omitFieldRule?.(initConfig)
      const id = param.id

      if (fieldNeeded) {
        const constantValue = typeof param.constant === "function" ? param.constant?.(initConfig) : param.constant

        const initialValue = getInitialValue(param.id, param.defaultValue, constantValue, param.type?.typeName)

        formValues[param.id] = initialValue

        formFields.push({
          name: param.id,
          value: initialValue,
          touched: false,
        })
      }
    })

    setInitialFormValues?.(formValues)
    form.setFields(formFields)

    /**
     *
     * 2nd render: component removes/adds fields conditionally
     *  depending on the form values
     *
     */
    forceUpdateAll()
  }, [])

  return loading ? (
    typeof loading === "boolean" ? (
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
          bigField,
          codeSuggestions,
        }: Parameter) => {
          const currentFormValues = form.getFieldsValue() ?? {}
          const defaultFormValues = fieldsParamsList.reduce(
            (result, { id, defaultValue }) => ({
              ...result,
              [id]: defaultValue,
            }),
            {}
          )
          const formItemName = id
          const formValues = {
            ...defaultFormValues,
            ...currentFormValues,
          }
          const parsedFormValues = makeObjectFromFieldsValues(formValues)
          const constantValue = typeof constant === "function" ? constant?.(parsedFormValues) : constant
          const isHidden = constantValue !== undefined
          const isOmitted = omitFieldRule ? omitFieldRule(parsedFormValues) : false

          const validationRules: FormItemProps["rules"] = []
          if (!isHidden) {
            const isReuqired = typeof required === "boolean" ? required : required?.(parsedFormValues)
            if (isReuqired)
              validationRules.push({
                required: true,
                message: `${displayName} field is required.`,
              })
            if (type?.typeName === "isoUtcDate")
              validationRules.push(isoDateValidator(`${displayName} field is required.`))

            /**
             * Currently `antd` built in validations do not work as expected,
             * therefore validations are currently omitted
             *
             */
            if (type?.typeName === "string") {
              // assertIsStringParameterType(type);
              // type.pattern &&
              //   validationRules.push({ pattern: new RegExp(type.pattern) });
            }
            if (type?.typeName === "int") {
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
            <Row key={id} className={cn(isHidden && "hidden")}>
              <Col span={24}>
                {jsDebugger ? (
                  <CodeDebuggerModal
                    visible={debugModalsStates[id]}
                    codeFieldLabelDebugger="Expression"
                    extraSuggestionsDebugger={codeSuggestions}
                    defaultCodeValueDebugger={debugModalsValues[id]}
                    handleCloseDebugger={() => handleCloseDebugger(id)}
                    runDebugger={values => handleDebuggerRun(id, jsDebugger, values)}
                    handleSaveCodeDebugger={value => handleSaveDebugger(id, value)}
                  />
                ) : null}
                {getFieldComponent(
                  type,
                  id,
                  defaultValue,
                  constantValue,
                  jsDebugger,
                  bigField,
                  displayName,
                  codeSuggestions,
                  documentation
                )}
              </Col>
            </Row>
          ) : (
            <Form.Item key={formItemName} name={formItemName} hidden={true} initialValue={constantValue} />
          )
        }
      )}
    </>
  )
}

const ConfigurableFieldsForm = ConfigurableFieldsFormComponent

export { ConfigurableFieldsForm }

type FormItemWrapperWoStylesProps = {
  id: string
} & FormItemProps

const FormItemWrapperWoStyles: React.FC<FormItemWrapperWoStylesProps> = ({ id, children, ...props }) => {
  return (
    <Form.Item key={id} name={id} {...props}>
      {children}
    </Form.Item>
  )
}

type FormItemWrapperProps = {
  type: ParameterType<any>
  id: string
  bigField?: boolean
  displayName?: string
  documentation?: React.ReactNode
  validationRules?: FormItemProps["rules"]
}

const FormItemWrapper: React.FC<FormItemWrapperProps> = ({
  type,
  id,
  bigField,
  displayName,
  documentation,
  validationRules,
  children,
}) => {
  return (
    <FormItemWrapperWoStyles
      id={id}
      className={cn(
        "form-field_fixed-label",
        styles.field,
        (type?.typeName === "json" || type?.typeName === "javascript") && styles.jsonField,
        (type?.typeName === "json" || type?.typeName === "javascript") && bigField && styles.bigField
      )}
      label={
        !bigField ? (
          documentation ? (
            <LabelWithTooltip documentation={documentation} render={displayName} />
          ) : (
            <span>{displayName}:</span>
          )
        ) : (
          <span></span>
        )
      }
      labelCol={{ span: bigField ? 0 : 4 }}
      wrapperCol={{ span: bigField ? 24 : 20 }}
      rules={validationRules}
    >
      {children}
    </FormItemWrapperWoStyles>
  )
}

type NonFormItemWrapperProps = {
  id: string
  bigField?: boolean
  displayName?: string
  documentation?: React.ReactNode
  validationRules?: FormItemProps["rules"]
}

const NonFormItemWrapper: React.FC<NonFormItemWrapperProps> = ({
  id,
  bigField,
  displayName,
  documentation,
  validationRules,
  children,
}) => {
  return (
    <Row key={id} className={cn("form-field_fixed-label", "ant-form-item", styles.field)}>
      <Col key="label-col" span={bigField ? 0 : 4} className={`ant-form-item-label`}>
        <label>
          {!bigField ? (
            documentation ? (
              <LabelWithTooltip documentation={documentation} render={displayName} />
            ) : (
              <span>{displayName}:</span>
            )
          ) : (
            <span></span>
          )}
        </label>
      </Col>
      <Col key="field-col" span={bigField ? 24 : 20} className={`ant-form-item-control`}>
        {children}
      </Col>
    </Row>
  )
}
