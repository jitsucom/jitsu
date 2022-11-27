// @Libs
import { memo, useCallback, useEffect } from "react"
import { Form, FormProps } from "antd"
// @Types
import { Parameter } from "@jitsu/catalog"
import { ConfigurableFieldsForm } from "ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm"
// @Components
import { PatchConfig, SetFormReference, ValidateGetErrorsCount } from "./SourceEditorFormConfiguration"

type Props = {
  initialValues: Partial<SourceData>
  configParameters: Parameter[]
  disabled?: boolean
  availableOauthBackendSecrets?: string[]
  hideFields?: string[]
  patchConfig: PatchConfig
  setValidator: React.Dispatch<React.SetStateAction<(validator: ValidateGetErrorsCount) => void>>
  setFormReference: SetFormReference
}

const CONFIG_INTERNAL_STATE_KEY = "configurableParameters"
const CONFIG_FORM_KEY = `${CONFIG_INTERNAL_STATE_KEY}Form`

export const SourceEditorFormConfigurationConfigurableFields: React.FC<Props> = memo(
  ({
    disabled,
    initialValues,
    configParameters,
    availableOauthBackendSecrets,
    hideFields,
    patchConfig,
    setValidator,
    setFormReference,
  }) => {
    const [form] = Form.useForm()

    // get form fields from source connector

    const handleFormValuesChange = useCallback<(values: PlainObjectWithPrimitiveValues) => void>(values => {
      patchConfig(CONFIG_INTERNAL_STATE_KEY, values, { resetErrorsCount: true })
    }, [])

    const handleFormValuesChangeForm: FormProps<PlainObjectWithPrimitiveValues>["onValuesChange"] = (_, values) => {
      patchConfig(CONFIG_INTERNAL_STATE_KEY, values, { resetErrorsCount: true })
    }

    const handleSetInitialFormValues = useCallback<(values: PlainObjectWithPrimitiveValues) => void>(values => {
      patchConfig(CONFIG_INTERNAL_STATE_KEY, values, { doNotSetStateChanged: true })
    }, [])

    /**
     * set validator and form reference on first render
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

      setValidator(() => validateGetErrorsCount)
      setFormReference(CONFIG_FORM_KEY, form, handleFormValuesChange)
    }, [])

    return (
      <Form
        id={"SourceEditorFormConfigurationConfigurableFields"}
        form={form}
        disabled={disabled}
        onValuesChange={handleFormValuesChangeForm}
      >
        <ConfigurableFieldsForm
          form={form}
          initialValues={initialValues}
          fieldsParamsList={configParameters}
          availableOauthBackendSecrets={availableOauthBackendSecrets}
          hideFields={hideFields}
          setFormValues={handleFormValuesChange}
          setInitialFormValues={handleSetInitialFormValues}
        />
      </Form>
    )
  }
)
