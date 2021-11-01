// @Libs
import { useEffect } from "react"
import { Form, FormProps } from "antd"
// @Types
import { Parameter } from "catalog/sources/types"
import { ConfigurableFieldsForm } from "ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm"
// @Components
import { PatchConfig, ValidateGetErrorsCount } from "./SourceEditorFormConfiguration"

type Props = {
  initialValues: Partial<SourceData>
  configParameters: Parameter[]
  patchConfig: PatchConfig
  setValidator: React.Dispatch<React.SetStateAction<(validator: ValidateGetErrorsCount) => void>>
}

const CONFIG_INTERNAL_STATE_KEY = "configurableParameters"

export const SourceEditorFormConfigurationConfigurableFields: React.FC<Props> = ({
  initialValues,
  configParameters,
  patchConfig,
  setValidator,
}) => {
  const [form] = Form.useForm()

  // get form fields from source connector

  const handleFormValuesChange = (values: PlainObjectWithPrimitiveValues): void => {
    debugger
    patchConfig(CONFIG_INTERNAL_STATE_KEY, values)
  }

  const handleFormValuesChangeForm: FormProps<PlainObjectWithPrimitiveValues>["onValuesChange"] = (_, values) => {
    debugger
    patchConfig(CONFIG_INTERNAL_STATE_KEY, values)
  }

  const handleSetInitialFormValues = (values: PlainObjectWithPrimitiveValues): void => {
    debugger
    patchConfig(CONFIG_INTERNAL_STATE_KEY, values, { doNotSetStateChanged: true })
  }

  /**
   * set validator on first render
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
  }, [])

  return (
    <Form form={form} onValuesChange={handleFormValuesChangeForm}>
      <ConfigurableFieldsForm
        form={form}
        initialValues={initialValues}
        fieldsParamsList={configParameters}
        setFormValues={handleFormValuesChange}
        setInitialFormValues={handleSetInitialFormValues}
      />
    </Form>
  )
}
