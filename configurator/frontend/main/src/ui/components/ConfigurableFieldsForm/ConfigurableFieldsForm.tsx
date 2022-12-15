// @Libs
import * as React from "react"
import { useCallback, useEffect, useState } from "react"
import { Button, Col, Form, FormItemProps, Input, InputNumber, Row, Select, Switch, Tooltip } from "antd"
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
import { Parameter, ParameterType, singleSelectionType } from "@jitsu/catalog"
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
import { useHistory, useLocation } from "react-router-dom"
import useProject from "../../../hooks/useProject"
import { allPermissions } from "../../../lib/services/permissions"
import { ProjectPermission } from "../../../generated/conf-openapi"

export const IMAGE_VERSION_FIELD_ID = "config.image_version"

/**
 * @param loading if `true` shows loader instead of the fields.
 * Accepts `ReactNode` to show it instead of the default loader.
 */
export interface Props {
  fieldsParamsList: readonly Parameter[]
  form: FormInstance
  extraForms?: FormInstance[]
  initialValues: any
  availableOauthBackendSecrets?: string[] | "all_from_config"
  hideFields?: string[]
  handleTouchAnyField?: (...args: any) => void
  setFormValues?: (values: PlainObjectWithPrimitiveValues) => void
  setInitialFormValues?: (values: PlainObjectWithPrimitiveValues) => void
}

export const FormItemName = {
  serialize: id => id,
}

const getFieldNameById = (id: string): string | undefined => id.split(".").slice(-1)[0]

const services = ApplicationServices.get()

const ConfigurableFieldsFormComponent = ({
  fieldsParamsList,
  form,
  extraForms,
  initialValues,
  availableOauthBackendSecrets,
  hideFields,
  handleTouchAnyField,
  setFormValues,
  setInitialFormValues,
}: Props) => {
  const [debugModalsStates, setDebugModalsStates] = useState<{ [id: string]: boolean }>({})
  const [debugModalsValues, setDebugModalsValues] = useState<{ [id: string]: string }>({})

  const forceUpdateAll = useForceUpdate()
  const { forceUpdatedTargets, forceUpdateTheTarget } = useForceUpdateTarget()

  const history = useHistory()
  const { search } = useLocation()

  const handleTouchField = debounce(handleTouchAnyField ?? (() => {}), 1000)

  const handleChangeIntInput = useCallback(
    (id: string) => (value: number) => {
      form.setFieldsValue({ [id]: value })
    },
    [form]
  )

  const project = useProject()
  const disableEdit = !(project.permissions || allPermissions).includes(ProjectPermission.MODIFY_CONFIG)

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
      handleTouchField()
    },
    [form, forceUpdateAll]
  )
  const handleOpenDebugger = useCallback(
    (id: string) => {
      const search = new URLSearchParams()
      search.append("debugger", id)
      const tab = id.indexOf("transform") == -1 ? "" : ""
      history.replace({ search: search.toString(), state: { disablePrompt: true } })
    },
    [form]
  )

  useEffect(() => {
    const query = new URLSearchParams(search)
    const debuggerId = query.get("debugger")
    if (debuggerId !== "false") {
      setDebugModalsValues({ ...debugModalsValues, [debuggerId]: form.getFieldValue(debuggerId) })
      setDebugModalsStates({ ...debugModalsStates, [debuggerId]: true })
    }
  }, [search])

  const handleJsonChange = (id: string) => (value: string) => {
    const values = {
      [id]: value ? value : "",
    }
    form.setFieldsValue(values)
    setFormValues?.(form.getFieldsValue())
    handleTouchField()
  }

  const getInitialValue = (id: string, defaultValue: any, constantValue: any, type: string) => {
    const initial = get(initialValues, id)
    if (typeof initial !== "undefined") {
      return initial
    }

    let calcValue: any
    if (typeof defaultValue !== "undefined" && defaultValue !== null) {
      calcValue = defaultValue
    } else if (typeof constantValue !== "undefined") {
      calcValue = constantValue
    } else if (type === "boolean") {
      calcValue = false
    } else if (type === "json") {
      calcValue = {}
    } else if (type === "javascript") {
      calcValue = "return {}"
    } else if (type === "html") {
      calcValue = "<script>\n</script>"
    } else if (type.indexOf("array/") === 0) {
      calcValue = []
    } else if (type === "string") {
      if (defaultValue === null) {
        calcValue = undefined
      } else {
        calcValue = ""
      }
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
    form.setFieldsValue({ ...form.getFieldsValue(), [id]: defaultValueToDisplay })

    const className = hideFields?.some(field => field === getFieldNameById(id)) ? "hidden" : ""

    const formItemWrapperProps: FormItemWrapperProps = {
      type,
      id,
      bigField,
      displayName,
      documentation,
      validationRules,
      className,
    }

    switch (type?.typeName) {
      case "password":
        return (
          <FormItemWrapper key={id} {...formItemWrapperProps}>
            <Input.Password
              autoComplete="off"
              iconRender={visible => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
            />
          </FormItemWrapper>
        )

      case "int": {
        return (
          <FormItemWrapper key={id} {...formItemWrapperProps}>
            <InputNumber autoComplete="off" inputMode="numeric" onChange={handleChangeIntInput(id)} />
          </FormItemWrapper>
        )
      }

      case "selection": {
        if (id === IMAGE_VERSION_FIELD_ID) {
          return (
            <VersionSelection
              key={`Stream Version Selection`}
              displayName={displayName}
              defaultValue={defaultValue}
              options={type.data.options.map(({ id }: Option) => {
                return id
              })}
            />
          )
        } else {
          return (
            <FormItemWrapper key={id} {...formItemWrapperProps}>
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
            </FormItemWrapper>
          )
        }
      }
      case "array/string":
        return (
          <FormItemWrapper key={id} {...formItemWrapperProps}>
            <EditableList initialValue={defaultValueToDisplay} />
          </FormItemWrapper>
        )
      case "javascript":
      case "html":
      case "json": {
        return (
          <FormItemWrapper key={id} {...formItemWrapperProps}>
            <CodeEditor
              readonly={disableEdit}
              initialValue={defaultValueToDisplay}
              className={styles.codeEditor}
              extraSuggestions={codeSuggestions}
              language={type?.typeName}
              handleChange={handleJsonChange(id)}
            />
            <span className="z-50">
              {jsDebugger && !disableEdit && (
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
          </FormItemWrapper>
        )
      }

      case "boolean":
        return (
          <FormItemWrapper key={id} {...formItemWrapperProps}>
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
          </FormItemWrapper>
        )

      case "file":
        return (
          <FormItemWrapper key={id} {...formItemWrapperProps}>
            <InputWithUpload onChange={handleChangeTextInput(id)} value={defaultValueToDisplay} />
          </FormItemWrapper>
        )

      case "description":
        return (
          <div key={id} className="ant-row ant-form-item form-field_fixed-label">
            <div className="ant-col ant-col-4 ant-form-item-label">
              <label>{displayName}:</label>
            </div>
            <div className="ant-col ant-col-20 ant-form-item-control pt-1.5">{defaultValue}</div>
          </div>
        )

      case "oauthSecret":
      case "string":
      default: {
        const backendSecretAvailable =
          type?.typeName === "oauthSecret" &&
          (availableOauthBackendSecrets === "all_from_config" ||
            availableOauthBackendSecrets?.some(name => getFieldNameById(id) === name))
        if (backendSecretAvailable) {
          formItemWrapperProps.validationRules = validationRules.filter(value => !value["required"])
        }
        const placeholder = backendSecretAvailable
          ? "Leave this field empty to use a value provided by Jitsu"
          : undefined
        return (
          <FormItemWrapper key={id} {...formItemWrapperProps}>
            <InputWithDebug
              id={id}
              placeholder={placeholder}
              jsDebugger={disableEdit ? null : jsDebugger}
              onButtonClick={() => handleOpenDebugger(id)}
            />
          </FormItemWrapper>
        )
      }
    }
  }

  const handleDebuggerRun = async (field: string, debuggerType: "object" | "string", values: DebuggerFormValues) => {
    let transform = {}
    if (field === "_transform") {
      transform = {
        _transform_enabled: true,
        _transform: values.code,
      }
    }
    const configForm = extraForms && extraForms[0]
    const mappingForm = extraForms && extraForms[1]

    const data = {
      reformat: debuggerType == "string",
      uid: `${services.activeProject.id}.${initialValues._uid}`,
      type: initialValues._type,
      field: field,
      expression: values.code,
      object: JSON.parse(values.object),
      config: makeObjectFromFieldsValues({
        ...initialValues,
        ...configForm?.getFieldsValue(),
        ...mappingForm?.getFieldsValue(),
        ...transform,
      }),
      template_variables: Object.entries((configForm || form).getFieldsValue())
        .filter(v => v[0].startsWith("_formData._"))
        .reduce((accumulator: any, currentValue: [string, unknown]) => {
          set(accumulator, currentValue[0].replace("_formData._", ""), currentValue[1])
          return accumulator
        }, {}),
    }

    return services.backendApiClient.post(`/destinations/evaluate?project_id=${services.activeProject.id}`, data)
  }

  const handleCloseDebugger = id => {
    history.replace({ search: null, state: { disablePrompt: true } })
    setDebugModalsStates({ ...debugModalsStates, [id]: false })
  }

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
      const initConfig = makeObjectFromFieldsValues(formValues)
      const fieldNeeded = !param.omitFieldRule?.(initConfig)
      const id = param.id

      const constantValue = typeof param.constant === "function" ? param.constant?.(initConfig) : param.constant
      const initialValue = getInitialValue(id, param.defaultValue, constantValue, param.type?.typeName)

      if (fieldNeeded) {
        formValues[id] = form.getFieldValue(id) || initialValue
        formFields.push({
          name: id,
          value: form.getFieldValue(id) || initialValue,
          touched: false,
        })
      }
    })

    form.setFields(formFields)

    /**
     * @reason
     * `formValues` holds correct values for dynamically rendered fields
     * @warning
     * Using `form.getFieldsValue()` instead of `formValues` is not recommended because
     * it needs form to re-render once to pick up values of dynamically rendered fields
     */
    setInitialFormValues?.(formValues)

    /**
     *
     * 2nd render: component removes/adds fields conditionally
     *  depending on the form values
     *
     */
    forceUpdateAll()
  }, [])

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
          constant,
          omitFieldRule,
          jsDebugger,
          bigField,
          codeSuggestions,
          validator,
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
            const isRequired = typeof required === "boolean" ? required : required?.(parsedFormValues)
            if (isRequired)
              validationRules.push({
                required: true,
                message: `${displayName} field is required.`,
              })
            if (type?.typeName === "isoUtcDate")
              validationRules.push(isoDateValidator(`${displayName} field is required.`))
          }
          if (validator) {
            validationRules.push({ validator: validator })
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
                  documentation,
                  validationRules
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

type FormItemWrapperProps = {
  type: ParameterType<any>
  id: string
  bigField?: boolean
  displayName?: string
  documentation?: React.ReactNode
  validationRules?: FormItemProps["rules"]
  className?: string
} & FormItemProps

export const FormItemWrapper: React.FC<FormItemWrapperProps> = ({
  type,
  id,
  bigField,
  displayName,
  documentation,
  validationRules,
  className,
  children,
  ...formItemProps
}) => {
  return (
    <Form.Item
      {...formItemProps}
      id={id}
      name={id}
      className={cn(
        "form-field_fixed-label",
        styles.field,
        (type?.typeName === "html" || type?.typeName === "json" || type?.typeName === "javascript") && styles.jsonField,
        (type?.typeName === "html" || type?.typeName === "json" || type?.typeName === "javascript") &&
          bigField &&
          styles.bigField,
        className
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
    </Form.Item>
  )
}

type VersionSelectionProps = {
  displayName: string
  defaultValue?: string
  options: string[]
}

const VersionSelection: React.FC<VersionSelectionProps> = ({ displayName, defaultValue, options }) => {
  const [selectedVersion, setSelectedVersion] = useState<string>(defaultValue || options[0])
  const isLatestVersionSelected = selectedVersion === options[0]
  const handleChange = useCallback<(value: string) => void>(version => {
    setSelectedVersion(version)
  }, [])
  return (
    <FormItemWrapper
      id={IMAGE_VERSION_FIELD_ID}
      name={IMAGE_VERSION_FIELD_ID}
      displayName={displayName}
      type={singleSelectionType(options)}
      required={true}
      initialValue={selectedVersion}
      // help={!isLatestVersionSelected && <span className={`text-xs text-success`}>{"New version available!"}</span>}
    >
      <Select value={selectedVersion} onChange={handleChange}>
        {options.map(option => {
          return (
            <Select.Option value={option} key={option}>
              {option === selectedVersion && !isLatestVersionSelected ? (
                <span>
                  {option} <span className={`text-secondaryText`}>{"(New version available)"}</span>
                </span>
              ) : (
                option
              )}
            </Select.Option>
          )
        })}
      </Select>
    </FormItemWrapper>
  )
}
