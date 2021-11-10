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
  forceFieldsValues: PlainObjectWithPrimitiveValues
  patchConfig: PatchConfig
  setValidator: React.Dispatch<React.SetStateAction<(validator: ValidateGetErrorsCount) => void>>
}

const CONFIG_INTERNAL_STATE_KEY = "configurableParameters"

export const SourceEditorFormConfigurationConfigurableFields: React.FC<Props> = ({
  initialValues,
  configParameters,
  forceFieldsValues,
  patchConfig,
  setValidator,
}) => {
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
   * Refactor -- use a function passed from parent component
   */
  useEffect(() => {
    const currentValues = form.getFieldsValue()
    const newValues = { ...currentValues }
    Object.keys(newValues).forEach(key => {
      Object.entries(forceFieldsValues).forEach(([forceKey, forceValue]) => {
        if (key.includes(forceKey)) newValues[key] = forceValue
      })
    })
    form.setFieldsValue(newValues)
    handleFormValuesChange(newValues)
  }, [forceFieldsValues, form])

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
