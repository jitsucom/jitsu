// @Libs
import { useCallback, useEffect, useMemo, useState } from "react"
import { Col, Form, Input, Row, Select } from "antd"
import { observer } from "mobx-react-lite"
import debounce from "lodash/debounce"
// @Types
import { FormInstance } from "antd/lib/form/hooks/useForm"
import { SourceConnector } from "catalog/sources/types"
import { Rule, RuleObject } from "rc-field-form/lib/interface"
// @Components
import { ConfigurableFieldsForm } from "ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm"
import { COLLECTIONS_SCHEDULES } from "constants/schedule"
// @Styles
import editorStyles from "ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm.module.less"
import { LoadableFieldsForm } from "ui/components/LoadableFieldsForm/LoadableFieldsForm"
import { useServices } from "../../../../../../hooks/useServices"
import { useLoaderAsObject } from "hooks/useLoader"
import { SourceEditorOauthButtons } from "../Common/SourceEditorOauthButtons/SourceEditorOauthButtons"
import { OAUTH_FIELDS_NAMES } from "constants/oauth"
import { useUniqueKeyState } from "hooks/useUniqueKeyState"
import { sourcePageUtils } from "ui/pages/SourcesPage/SourcePage.utils"
import { FormSkeleton } from "ui/components/FormSkeleton/FormSkeleton"

export interface Props {
  editorMode: "add" | "edit"
  form: FormInstance
  sourceReference: SourceConnector
  isCreateForm: boolean
  sources: SourceData[]
  initialValues: SourceData
  handleTouchAnyField: (...args: any) => void
  disableFormControls?: (reason?: string) => void
  enableFormControls?: VoidFunction
}

const SourceEditorConfigComponent = ({
  editorMode,
  form,
  sourceReference,
  isCreateForm,
  sources,
  initialValues = {} as SourceData,
  handleTouchAnyField,
  disableFormControls,
  enableFormControls,
}: Props) => {
  const services = useServices()
  const subscription = services.currentSubscription?.currentPlan

  const [fillAuthDataManually, setFillAuthDataManually] = useState<boolean>(true)
  const [isOauthStatusReady, setIsOauthStatusReady] = useState<boolean>(false)
  const [isOauthFlowCompleted, setIsOauthFlowCompleted] = useState<boolean>(false)
  const [key, resetFormUi] = useUniqueKeyState() // pass a key to a component, then re-mount component by calling `resetFormUi`

  const { data: availableOauthBackendSecrets } = useLoaderAsObject<string[]>(
    async () => {
      return await services.oauthService.getAvailableBackendSecrets(sourceReference?.id, services.activeProject.id)
    },
    [],
    { initialValue: [] }
  )

  const validateUniqueSourceId = useCallback(
    (rule: RuleObject, value: string) =>
      sources?.find((source: SourceData) => source.sourceId === value)
        ? Promise.reject("SourceId must be unique!")
        : Promise.resolve(),
    [sources]
  )

  const validateSourceIdNoSpaces = useCallback(
    (rule: RuleObject, value: string) => {
      const re = /^[A-Za-z0-9_]*$/
      if (!re.test(value)) {
        return Promise.reject("SourceId must contain only letters, numbers, or the underscore character")
      } else {
        return Promise.resolve()
      }
    },
    [sources]
  )

  const handleChange = debounce(handleTouchAnyField, 500)

  const sourceIdValidators = useMemo(() => {
    const rules: Rule[] = [{ required: true, message: "SourceId is required field" }]

    if (isCreateForm) {
      rules.push({ validator: validateUniqueSourceId })
      rules.push({ validator: validateSourceIdNoSpaces })
    }

    return rules
  }, [validateUniqueSourceId, isCreateForm])

  const initialSchedule = useMemo(() => {
    if (initialValues.schedule) {
      return initialValues.schedule
    }

    return COLLECTIONS_SCHEDULES[0].value
  }, [initialValues])

  const hideFields = useMemo<string[]>(() => {
    return fillAuthDataManually ? [] : [...OAUTH_FIELDS_NAMES, ...availableOauthBackendSecrets]
  }, [isOauthStatusReady, fillAuthDataManually, availableOauthBackendSecrets])

  const handleOauthSupportedStatusChange = useCallback((oauthSupported: boolean) => {
    setIsOauthStatusReady(true)
    setFillAuthDataManually(!oauthSupported)
  }, [])

  const handleFillOuthDataManuallyChange = (fillManually: boolean) => {
    setFillAuthDataManually(fillManually)
    if (!fillManually) resetFormUi()
  }

  const setOauthSecretsToForms = useCallback<(secrets: PlainObjectWithPrimitiveValues) => void>(
    secrets => {
      const successful = sourcePageUtils.applyOauthValuesToAntdForms({ "config-form": { form } }, secrets)
      successful && setIsOauthFlowCompleted(true)
    },
    [form]
  )

  const isLoadingOauth = !isOauthStatusReady

  useEffect(() => {
    if (isLoadingOauth) disableFormControls()
    else if (fillAuthDataManually) enableFormControls()
    else if (editorMode === "edit") enableFormControls()
    else if (!isOauthFlowCompleted)
      disableFormControls("Please, either grant Jitsu access or fill auth credentials manually")
    else enableFormControls()
  }, [isLoadingOauth, fillAuthDataManually, isOauthFlowCompleted])

  return (
    <Form name="source-config" form={form} autoComplete="off" onChange={handleChange}>
      <div className={`flex justify-center items-start w-full h-full ${isLoadingOauth ? "" : "hidden"}`}>
        <FormSkeleton />
      </div>
      <div className={`${isLoadingOauth ? "hidden" : ""}`}>
        <SourceEditorOauthButtons
          key={"oauth-buttons"}
          sourceDataFromCatalog={sourceReference}
          onIsOauthSupportedCheckSuccess={handleOauthSupportedStatusChange}
          onFillAuthDataManuallyChange={handleFillOuthDataManuallyChange}
          setOauthSecretsToForms={setOauthSecretsToForms}
        />
        <div key={key}>
          <Row key="id">
            <Col span={24}>
              <Form.Item
                initialValue={initialValues.sourceId}
                className={`form-field_fixed-label ${editorStyles.field}`}
                label={<span>SourceId:</span>}
                name="sourceId"
                rules={sourceIdValidators}
                labelCol={{ span: 4 }}
                wrapperCol={{ span: 20 }}
              >
                <Input autoComplete="off" disabled={!isCreateForm} />
              </Form.Item>
            </Col>
          </Row>

          <Row key="schedule">
            <Col span={24}>
              <Form.Item
                initialValue={initialSchedule}
                name="schedule"
                className={`form-field_fixed-label ${editorStyles.field}`}
                label="Schedule:"
                labelCol={{ span: 4 }}
                wrapperCol={{ span: 20 }}
                rules={[{ required: true, message: "You have to choose schedule" }]}
              >
                <Select>
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
              </Form.Item>
            </Col>
          </Row>

          <ConfigurableFieldsForm
            key="configurable-form"
            initialValues={initialValues}
            fieldsParamsList={sourceReference.configParameters}
            form={form}
            hideFields={hideFields}
            handleTouchAnyField={handleTouchAnyField}
            availableOauthBackendSecrets={availableOauthBackendSecrets}
          />

          {sourceReference.hasLoadableConfigParameters && (
            <LoadableFieldsForm
              key="configurable-form-loadable"
              sourceReference={sourceReference}
              initialValues={initialValues}
              form={form}
              handleTouchAnyField={handleTouchAnyField}
              disableFormControls={disableFormControls}
              enableFormControls={enableFormControls}
            />
          )}
        </div>
      </div>
    </Form>
  )
}

const SourceEditorConfig = observer(SourceEditorConfigComponent)

SourceEditorConfig.displayName = "SourceEditorConfig"

export { SourceEditorConfig }
