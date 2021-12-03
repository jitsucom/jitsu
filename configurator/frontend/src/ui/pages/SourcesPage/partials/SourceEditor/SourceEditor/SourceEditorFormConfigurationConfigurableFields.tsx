// @Libs
import { memo, useEffect } from "react"
import { Form, FormProps } from "antd"
// @Types
import { Parameter } from "catalog/sources/types"
import { ConfigurableFieldsForm } from "ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm"
// @Components
import { PatchConfig, SetFormReference, ValidateGetErrorsCount } from "./SourceEditorFormConfiguration"

type Props = {
  initialValues: Partial<SourceData>
  configParameters: Parameter[]
  oauthBackendSecretsStatus: "loading" | "secrets_set" | "secrets_not_set"
  patchConfig: PatchConfig
  setValidator: React.Dispatch<React.SetStateAction<(validator: ValidateGetErrorsCount) => void>>
  setFormReference: SetFormReference
}

const CONFIG_INTERNAL_STATE_KEY = "configurableParameters"
const CONFIG_FORM_KEY = `${CONFIG_INTERNAL_STATE_KEY}Form`

export const SourceEditorFormConfigurationConfigurableFields: React.FC<Props> = memo(
  ({ initialValues, configParameters, oauthBackendSecretsStatus, patchConfig, setValidator, setFormReference }) => {
    const [form] = Form.useForm()

    // get form fields from source connector

    const handleFormValuesChange = (values: PlainObjectWithPrimitiveValues): void => {
      patchConfig(CONFIG_INTERNAL_STATE_KEY, values)
    }

    const handleFormValuesChangeForm: FormProps<PlainObjectWithPrimitiveValues>["onValuesChange"] = (_, values) => {
      patchConfig(CONFIG_INTERNAL_STATE_KEY, values)
    }

    const handleSetInitialFormValues = (values: PlainObjectWithPrimitiveValues): void => {
      patchConfig(CONFIG_INTERNAL_STATE_KEY, values, { doNotSetStateChanged: true })
    }

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
      setFormReference(CONFIG_FORM_KEY, form)
    }, [])

    return (
      <Form form={form} onValuesChange={handleFormValuesChangeForm}>
        <ConfigurableFieldsForm
          form={form}
          initialValues={initialValues}
          fieldsParamsList={configParameters}
          oauthBackendSecretsStatus={oauthBackendSecretsStatus}
          setFormValues={handleFormValuesChange}
          setInitialFormValues={handleSetInitialFormValues}
        />
      </Form>
    )
  }
)
