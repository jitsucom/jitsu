// @Libs
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Col, Row, Form, Select, FormProps } from "antd"
import { Parameter, singleSelectionType, SourceConnector } from "@jitsu/catalog"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Components
import { ErrorCard } from "lib/components/ErrorCard/ErrorCard"
import { LoadableFieldsLoadingMessageCard } from "lib/components/LoadingFormCard/LoadingFormCard"
import {
  IMAGE_VERSION_FIELD_ID,
  ConfigurableFieldsForm,
} from "ui/components/ConfigurableFieldsForm/ConfigurableFieldsForm"
// @Types
import { PatchConfig, SetFormReference, ValidateGetErrorsCount } from "./SourceEditorFormConfiguration"
// @Hooks
import { usePolling } from "hooks/usePolling"
// @Utils
import { toTitleCase } from "utils/strings"
import { uniqueId } from "lodash"
import { withQueryParams } from "utils/queryParams"
import { mapAirbyteSpecToSourceConnectorConfig } from "@jitsu/catalog"
import { mapSdkSourceSpecToSourceConnectorConfig } from "@jitsu/catalog"
import { SourceEditorActionsTypes, useSourceEditorDispatcher } from "./SourceEditor.state"

type Props = {
  initialValues: Partial<SourceData>
  sourceDataFromCatalog: SourceConnector
  availableOauthBackendSecrets?: string[]
  disabled?: boolean
  hideFields?: string[]
  patchConfig: PatchConfig
  setValidator: React.Dispatch<React.SetStateAction<(validator: ValidateGetErrorsCount) => void>>
  setFormReference: SetFormReference
  handleResetOauth: VoidFunction
  handleReloadStreams: VoidFunction | AsyncVoidFunction
}

const CONFIG_INTERNAL_STATE_KEY = "loadableParameters"
const CONFIG_FORM_KEY = `${CONFIG_INTERNAL_STATE_KEY}Form`

export const SourceEditorFormConfigurationConfigurableLoadableFields: React.FC<Props> = memo(
  ({
    disabled,
    initialValues,
    sourceDataFromCatalog,
    availableOauthBackendSecrets,
    hideFields: _hideFields,
    patchConfig,
    setValidator,
    setFormReference,
    handleResetOauth,
    handleReloadStreams,
  }) => {
    const [form] = Form.useForm()
    const dispatchAction = useSourceEditorDispatcher()
    const airbyteImageVersion = useRef<string>(
      sourceDataFromCatalog.protoType === "airbyte"
        ? (initialValues as Partial<AirbyteSourceData>).config?.image_version ?? ""
        : ""
    )

    let polledData
    switch (sourceDataFromCatalog.protoType) {
      case "airbyte":
        polledData = usePolling<Parameter[]>(
          {
            configure: () => {
              const controlsDisableRequestId = uniqueId("configurableLoadableFields-")
              const imageVersion: string = airbyteImageVersion.current
              let availableImageVersions: string[] = []
              return {
                onBeforePollingStart: async () => {
                  dispatchAction(SourceEditorActionsTypes.SET_STATUS, { isLoadingConfig: true })
                  availableImageVersions = (await pullAvailableAirbyteImageVersions(sourceDataFromCatalog.id)) || []
                },
                pollingCallback: (end, fail) => async () => {
                  try {
                    const response = await pullAirbyteSpec(
                      sourceDataFromCatalog.id,
                      imageVersion || availableImageVersions[0]
                    )
                    if (response?.message) throw new Error(response?.message)
                    if (response?.status && response?.status !== "pending") {
                      const result = transformAirbyteSpecResponse(response)
                      result.unshift({
                        id: IMAGE_VERSION_FIELD_ID,
                        displayName: "Airbyte Image Version",
                        type: singleSelectionType(availableImageVersions),
                        defaultValue: imageVersion || availableImageVersions[0],
                        required: true,
                      })
                      end(result)
                    }
                  } catch (error) {
                    fail(error)
                  }
                },
                onAfterPollingEnd: () => {
                  dispatchAction(SourceEditorActionsTypes.SET_STATUS, { isLoadingConfig: false })
                },
              }
            },
          },
          { interval_ms: 2000 }
        )
        break
      case "sdk_source":
        polledData = usePolling<Parameter[]>(
          {
            configure: () => {
              const controlsDisableRequestId = uniqueId("configurableLoadableFields-")

              return {
                onBeforePollingStart: async () => {
                  dispatchAction(SourceEditorActionsTypes.SET_STATUS, { isLoadingConfig: true })
                },
                pollingCallback: (end, fail) => async () => {
                  try {
                    const response = await pullSdkSourceSpec(sourceDataFromCatalog.specEndpoint)
                    if (response?.message) throw new Error(response?.message)
                    if (response?.status && response?.status !== "pending") {
                      const result = transformSdkSourceSpecResponse(response, availableOauthBackendSecrets)
                      end(result)
                    }
                  } catch (error) {
                    fail(error)
                  }
                },
                onAfterPollingEnd: () => {
                  dispatchAction(SourceEditorActionsTypes.SET_STATUS, { isLoadingConfig: false })
                },
              }
            },
          },
          { interval_ms: 2000 },
          [availableOauthBackendSecrets]
        )
    }

    const {
      isLoading: isLoadingParameters,
      data: fp,
      error: loadingParametersError,
      reload: reloadParameters,
    } = polledData

    const fieldsParameters = fp as Parameter[]
    const hideFields = useMemo<string[]>(() => {
      if (!fieldsParameters) return _hideFields
      const oauthFieldsParametersNames = fieldsParameters.reduce<string[]>((result, current) => {
        if (current.type.typeName === "oauthSecret") result.push(current.id)
        return result
      }, [])
      return [..._hideFields, ...oauthFieldsParametersNames]
    }, [_hideFields, fieldsParameters])

    const handleFormValuesChange = useCallback(
      (values: PlainObjectWithPrimitiveValues): void => {
        patchConfig(CONFIG_INTERNAL_STATE_KEY, values, { resetErrorsCount: true })
      },
      [patchConfig]
    )

    const handleFormValuesChangeForm = useCallback<FormProps<PlainObjectWithPrimitiveValues>["onValuesChange"]>(
      (changedValues, allValues) => {
        patchConfig(CONFIG_INTERNAL_STATE_KEY, allValues, { resetErrorsCount: true })
        handleIfAirbyteVersionChanged(changedValues)
      },
      [patchConfig]
    )

    const handleIfAirbyteVersionChanged = async (changedFormValues: PlainObjectWithPrimitiveValues): Promise<void> => {
      const newImageVersion = changedFormValues[IMAGE_VERSION_FIELD_ID]
      if (newImageVersion && typeof newImageVersion === "string") {
        airbyteImageVersion.current = newImageVersion
        handleResetOauth()
        await reloadParameters()
        handleReloadStreams()
      }
    }

    const handleSetInitialFormValues = useCallback(
      (values: PlainObjectWithPrimitiveValues): void => {
        patchConfig(CONFIG_INTERNAL_STATE_KEY, values, { doNotSetStateChanged: true })
      },
      [patchConfig]
    )

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
      setFormReference(CONFIG_FORM_KEY, form, handleFormValuesChange)
    }, [])

    return loadingParametersError ? (
      <Row>
        <Col span={4} />
        <Col span={20}>
          <ErrorCard
            title={`Failed to load the source specification data`}
            error={loadingParametersError}
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
      <Form disabled={disabled} form={form} onValuesChange={handleFormValuesChangeForm}>
        <ConfigurableFieldsForm
          fieldsParamsList={fieldsParameters || []}
          form={form}
          initialValues={initialValues}
          availableOauthBackendSecrets={"all_from_config"}
          hideFields={hideFields}
          setFormValues={handleFormValuesChange}
          setInitialFormValues={handleSetInitialFormValues}
        />
      </Form>
    )
  }
)

const pullAvailableAirbyteImageVersions = async (sourceId: string): Promise<string[]> => {
  const services = ApplicationServices.get()
  const queryParams = { project_id: services.activeProject.id }
  const requestUrl = withQueryParams(`/airbyte/${sourceId.replace("airbyte-", "")}/versions`, queryParams)

  const response = await services.backendApiClient.get(requestUrl, { proxy: true })
  if (!Array.isArray(response?.versions)) return []
  return response.versions
}

const pullAirbyteSpec = async (sourceId: string, imageVersion?: string): Promise<any> => {
  const services = ApplicationServices.get()
  const queryParams = { project_id: services.activeProject.id }
  if (imageVersion) queryParams["image_version"] = imageVersion
  const requestUrl = withQueryParams(`/airbyte/${sourceId.replace("airbyte-", "")}/spec`, queryParams)

  return await services.backendApiClient.get(requestUrl, { proxy: true })
}

const pullSdkSourceSpec = async (endpoint: string): Promise<any> => {
  const services = ApplicationServices.get()
  const queryParams = { project_id: services.activeProject.id }
  const requestUrl = withQueryParams(endpoint, queryParams)

  return await services.backendApiClient.get(requestUrl, { proxy: true })
}

const transformAirbyteSpecResponse = (response: any) => {
  return mapAirbyteSpecToSourceConnectorConfig(
    response?.["spec"]?.["spec"]?.["connectionSpecification"]
  ).map<Parameter>(parameter => ({
    ...parameter,
    displayName: toTitleCase(parameter.displayName || parameter.id.split(".").pop(), { separator: "_" }),
  }))
}

const transformSdkSourceSpecResponse = (response: any, availableOauthBackendSecrets: string[]) => {
  return mapSdkSourceSpecToSourceConnectorConfig(response?.["spec"], availableOauthBackendSecrets)
}
