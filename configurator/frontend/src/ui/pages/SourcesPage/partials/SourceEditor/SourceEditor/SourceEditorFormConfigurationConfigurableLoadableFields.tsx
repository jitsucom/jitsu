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
import { SetSourceEditorState } from "./SourceEditor"
import { PatchConfig, ValidateGetErrorsCount } from "./SourceEditorFormConfiguration"
// @Hooks
import { usePolling } from "hooks/usePolling"
// @Utils
import { toTitleCase } from "utils/strings"
import { mapAirbyteSpecToSourceConnectorConfig } from "catalog/sources/lib/airbyte.helper"
import { useEffect } from "react"

type Props = {
  initialValues: any
  sourceDataFromCatalog: SourceConnector
  patchConfig: PatchConfig
  setControlsDisabled: ReactSetState<boolean>
  setValidator: React.Dispatch<React.SetStateAction<(validator: ValidateGetErrorsCount) => void>>
}

export const SourceEditorFormConfigurationConfigurableLoadableFields: React.FC<Props> = ({
  initialValues,
  sourceDataFromCatalog,
  patchConfig,
  setControlsDisabled,
  setValidator,
}) => {
  const [form] = Form.useForm()

  const {
    isLoading: isLoadingParameters,
    data: fieldsParameters,
    error: loadingParametersError,
  } = usePolling<Parameter[]>((end, fail) => async () => {
    setControlsDisabled(true)
    try {
      const result = await pullAirbyteSpec(sourceDataFromCatalog.id)
      end(result)
    } catch (error) {
      fail(error)
    } finally {
      setControlsDisabled(false)
    }
  })

  const handleFormValuesChange: FormProps<PlainObjectWithPrimitiveValues>["onValuesChange"] = (_, values) => {
    patchConfig(values)
  }

  const handleSetInitialFormValues = (values: PlainObjectWithPrimitiveValues): void => {
    patchConfig(values, { doNotSetStateChanged: true })
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

  return loadingParametersError ? (
    <Row>
      <Col span={4} />
      <Col span={20}>
        <ErrorCard
          title={`Failed to load the source specification data`}
          descriptionWithContacts={null}
          stackTrace={loadingParametersError.stack}
          className={"form-fields-card"}
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
        />
      </Col>
    </Row>
  ) : (
    <Form form={form} onValuesChange={handleFormValuesChange}>
      <ConfigurableFieldsForm
        fieldsParamsList={fieldsParameters || []}
        form={form}
        initialValues={initialValues}
        setInitialFormValues={handleSetInitialFormValues}
      />
    </Form>
  )
}

const pullAirbyteSpec = async (sourceId: string): Promise<Parameter[]> => {
  const services = ApplicationServices.get();
  const response = await services.backendApiClient.get(
    `/airbyte/${sourceId.replace('airbyte-', '')}/spec?project_id=${
      services.activeProject.id
    }`,
    { proxy: true }
  );

  if (response?.message) throw new Error(response?.message);
  if (response?.status && response?.status !== 'pending') {
    return mapAirbyteSpecToSourceConnectorConfig(
      response?.['spec']?.['spec']?.['connectionSpecification']
    ).map<Parameter>((parameter) => ({
      ...parameter,
      displayName: toTitleCase(parameter.displayName, { separator: '_' })
    }));
  }
};
