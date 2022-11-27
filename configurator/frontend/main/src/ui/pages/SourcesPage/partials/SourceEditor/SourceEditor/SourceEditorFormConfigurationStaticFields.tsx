// @Libs
import React, { useEffect, useMemo, useState } from "react"
import { Form as AntdForm, Input, Row, Col, Select, FormProps } from "antd"
// @Store
import { sourcesStore } from "stores/sources"
// @Constants
import { COLLECTIONS_SCHEDULES, DAILY_HOURS } from "constants/schedule"
// @Types
import { PatchConfig, SetFormReference, ValidateGetErrorsCount } from "./SourceEditorFormConfiguration"
import { Rule as AntdFormItemValidationRule } from "antd/lib/form"
// @Services
import { useServices } from "hooks/useServices"
import { observer } from "mobx-react-lite"
// @Styles
import editorStyles from "ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm.module.less"
import { useSourceEditorState } from "./SourceEditor.state"
import { SelectOutlined } from "@ant-design/icons"

type FormFields = {
  sourceId: string
  schedule: string
}

type Props = {
  editorMode: "add" | "edit"
  disabled?: boolean
  initialValues: Optional<Partial<SourceData>>
  patchConfig: PatchConfig
  setValidator: ReactSetState<(validator: ValidateGetErrorsCount) => void>
  setFormReference: SetFormReference
}

const CONFIG_INTERNAL_STATE_KEY = "staticParameters"
const CONFIG_FORM_KEY = `${CONFIG_INTERNAL_STATE_KEY}Form`

const SourceEditorFormConfigurationStaticFields: React.FC<Props> = ({
  editorMode,
  disabled,
  initialValues,
  patchConfig,
  setValidator,
  setFormReference,
}) => {
  const [form] = AntdForm.useForm<FormFields>()
  const [dailyMode, setDailyMode] = useState(initialValues?.schedule === "@daily")
  const services = useServices()
  const sourceEditorState = useSourceEditorState()
  const subscription = services.currentSubscription?.currentPlan
  const sourcesList = sourcesStore.list

  const validateUniqueSourceId = (_, value: string) =>
    editorMode === "add" && sourcesList?.find((source: SourceData) => source.sourceId === value)
      ? Promise.reject("SourceId must be unique!")
      : Promise.resolve()

  const validateSourceIdNoSpaces = (_, value: string) => {
    const re = /^[A-Za-z0-9_-]*$/
    if (!re.test(value)) {
      return Promise.reject("SourceId must contain only letters, numbers, hyphens or the underscore character")
    } else {
      return Promise.resolve()
    }
  }

  const sourceIdValidationRules = useMemo<AntdFormItemValidationRule[]>(
    () => [
      { required: true, message: "SourceId is required field" },
      { validator: validateUniqueSourceId },
      { validator: validateSourceIdNoSpaces },
    ],
    []
  )

  const handleFormValuesChange: FormProps<PlainObjectWithPrimitiveValues>["onValuesChange"] = (_, values) => {
    patchConfig(CONFIG_INTERNAL_STATE_KEY, values, { resetErrorsCount: true })
  }

  /**
   * set initial state, validator and form reference on first render
   */
  useEffect(() => {
    const validateGetErrorsCount: ValidateGetErrorsCount = async () => {
      let errorsCount = 0
      try {
        await form.validateFields()
      } catch (error) {
        errorsCount = +error?.errorFields?.length
      }
      return errorsCount
    }

    patchConfig(CONFIG_INTERNAL_STATE_KEY, form.getFieldsValue(), { doNotSetStateChanged: true })
    setValidator(() => validateGetErrorsCount)
    setFormReference(CONFIG_FORM_KEY, form)
  }, [])

  return (
    <AntdForm
      disabled={disabled}
      name="source-config"
      form={form}
      autoComplete="off"
      onValuesChange={handleFormValuesChange}
    >
      <Row key="sourceId">
        <Col span={24}>
          <AntdForm.Item
            initialValue={initialValues?.sourceId}
            className={`form-field_fixed-label ${editorStyles.field}`}
            label={<span className="w-full">SourceId</span>}
            name="sourceId"
            rules={sourceIdValidationRules}
            labelCol={{ span: 4 }}
            wrapperCol={{ span: 20 }}
          >
            <Input disabled={editorMode === "edit" || sourceEditorState.status.hasConfigSealed} autoComplete="off" />
          </AntdForm.Item>
        </Col>
      </Row>

      <Row key="schedule">
        <Col span={24}>
          <AntdForm.Item
            initialValue={initialValues?.schedule}
            name="schedule"
            className={`form-field_fixed-label ${editorStyles.field}`}
            label={<span className="w-full">Schedule</span>}
            labelCol={{ span: 4 }}
            wrapperCol={{ span: 20 }}
            rules={[{ required: true, message: "You have to choose schedule" }]}
          >
            <Select onChange={v => setDailyMode(v === "@daily")}>
              {COLLECTIONS_SCHEDULES.map(option => {
                const available = subscription ? subscription.quota.allowedSchedules.includes(option.id) : true
                return (
                  <Select.Option value={option.value} key={option.value} disabled={!available}>
                    {option.label}
                    {!available && " - n/a, upgrade plan"}
                  </Select.Option>
                )
              })}
            </Select>
          </AntdForm.Item>
        </Col>
      </Row>

      <Row key="scheduleTime">
        <Col span={24}>
          <AntdForm.Item
            hidden={!dailyMode}
            initialValue={initialValues?.scheduleTime}
            name="scheduleTime"
            className={`form-field_fixed-label ${editorStyles.field}`}
            label={<span className="w-full">Schedule Time (UTC)</span>}
            labelCol={{ span: 4 }}
            wrapperCol={{ span: 20 }}
          >
            <Select defaultValue={"0"}>
              {DAILY_HOURS.map(option => {
                return (
                  <Select.Option value={option.value} key={option.value}>
                    {option.label}
                  </Select.Option>
                )
              })}
            </Select>
          </AntdForm.Item>
        </Col>
      </Row>
    </AntdForm>
  )
}

const Wrapped = observer(SourceEditorFormConfigurationStaticFields)

Wrapped.displayName = "SourceEditorFormConfigurationStaticFields"

export { Wrapped as SourceEditorFormConfigurationStaticFields }
