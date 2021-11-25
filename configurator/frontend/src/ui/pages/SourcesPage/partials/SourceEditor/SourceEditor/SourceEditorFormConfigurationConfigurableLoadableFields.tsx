// @Libs
import { Col, Row, Form, FormProps } from "antd"
import { Parameter, SourceConnector } from "catalog/sources/types"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Components
import { ErrorCard } from "lib/components/ErrorCard/ErrorCard"
import { LoadableFieldsLoadingMessageCard } from "lib/components/LoadingFormCard/LoadingFormCard"
import { ConfigurableFieldsForm } from "ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm"
// @Types
import { PatchConfig, SetFormReference, ValidateGetErrorsCount } from "./SourceEditorFormConfiguration"
// @Hooks
import { usePolling } from "hooks/usePolling"
// @Utils
import { toTitleCase } from "utils/strings"
import { mapAirbyteSpecToSourceConnectorConfig } from "catalog/sources/lib/airbyte.helper"
import { useEffect } from "react"

type Props = {
  initialValues: Partial<SourceData>
  sourceDataFromCatalog: SourceConnector
  patchConfig: PatchConfig
  setControlsDisabled: ReactSetState<boolean>
  setValidator: React.Dispatch<React.SetStateAction<(validator: ValidateGetErrorsCount) => void>>
  setFormReference: SetFormReference
}

const CONFIG_INTERNAL_STATE_KEY = "loadableParameters"
const CONFIG_FORM_KEY = `${CONFIG_INTERNAL_STATE_KEY}Form`

export const SourceEditorFormConfigurationConfigurableLoadableFields: React.FC<Props> = ({
  initialValues,
  sourceDataFromCatalog,
  patchConfig,
  setControlsDisabled,
  setValidator,
  setFormReference,
}) => {
  const [form] = Form.useForm()

  const {
    isLoading: isLoadingParameters,
    data: fieldsParameters,
    error: loadingParametersError,
  } = usePolling<Parameter[]>(
    (end, fail) => async () => {
      setControlsDisabled(true)
      try {
        const response = await pullAirbyteSpec(sourceDataFromCatalog.id)
        if (response?.message) throw new Error(response?.message)
        if (response?.status && response?.status !== "pending") {
          const result = transformAirbyteSpecResponse(response)
          end(result)
        }
      } catch (error) {
        fail(error)
      } finally {
        setControlsDisabled(false)
      }
    },
    { interval_ms: 2000 }
  )

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
   * set validator and form reference to parent component after the first render
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

  return loadingParametersError ? (
    <Row>
      <Col span={4} />
      <Col span={20}>
        <ErrorCard
          title={`Failed to load the source specification data`}
          descriptionWithContacts={null}
          stackTrace={loadingParametersError.stack}
          className={`form-fields-card`}
        />
      </Col>
    </Row>
  ) : isLoadingParameters ? (
    <Row>
      <Col span={4} />
      <Col span={20}>
        <LoadableFieldsLoadingMessageCard
          title="Loading the source configuration"
          longLoadingMessage="Loading the spec takes longer than usual. This might happen if you are configuring such source for the first time - Jitsu will need some time to pull a docker image with the connector code"
          showLongLoadingMessageAfterMs={5000}
          className={`form-fields-card`}
        />
      </Col>
    </Row>
  ) : (
    /**
     * Possible refactor -- use component for configurable fields
     * e.g. <SourceEditorFormConfigurationConfigurableFields />
     *
     * make sure that their functionality won't diverge
     */
    <Form form={form} onValuesChange={handleFormValuesChangeForm}>
      <ConfigurableFieldsForm
        fieldsParamsList={fieldsParameters || []}
        form={form}
        initialValues={initialValues}
        setFormValues={handleFormValuesChange}
        setInitialFormValues={handleSetInitialFormValues}
      />
    </Form>
  )
}

const pullAirbyteSpec = async (sourceId: string): Promise<any> => {
  const services = ApplicationServices.get()
  return await services.backendApiClient.get(
    `/airbyte/${sourceId.replace("airbyte-", "")}/spec?project_id=${services.activeProject.id}`,
    { proxy: true }
  )
}

const transformAirbyteSpecResponse = (response: any) => {
  return mapAirbyteSpecToSourceConnectorConfig(
    response?.["spec"]?.["spec"]?.["connectionSpecification"]
  ).map<Parameter>(parameter => ({
    ...parameter,
    displayName: toTitleCase(parameter.displayName, { separator: "_" }),
  }))
}
