// @Libs
import { observer } from "mobx-react-lite"
import { useCallback, useEffect, useMemo, useState } from "react"
import { cloneDeep } from "lodash"
import { Col, FormInstance, Row } from "antd"
// @Types
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
import { SetSourceEditorState } from "./SourceEditor"
// @Components
import { SourceEditorFormConfigurationStaticFields } from "./SourceEditorFormConfigurationStaticFields"
import { SourceEditorFormConfigurationConfigurableLoadableFields } from "./SourceEditorFormConfigurationConfigurableLoadableFields"
import { SourceEditorFormConfigurationConfigurableFields } from "./SourceEditorFormConfigurationConfigurableFields"
import { OauthButton } from "../../OauthButton/OauthButton"
// @Utils
import { sourcePageUtils } from "ui/pages/SourcesPage/SourcePage.utils"
import ApplicationServices from "lib/services/ApplicationServices"
import { useLoaderAsObject } from "hooks/useLoader"
import { useServices } from "hooks/useServices"

type Props = {
  editorMode: "add" | "edit"
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  disabled?: boolean
  setSourceEditorState: SetSourceEditorState
  setControlsDisabled: ReactSetState<boolean>
  setTabErrorsVisible?: (value: boolean) => void
  setConfigIsValidatedByStreams: (value: boolean) => void
}

export type ValidateGetErrorsCount = () => Promise<number>
export type PatchConfig = (
  key: string,
  allValues: PlainObjectWithPrimitiveValues,
  options?: {
    doNotSetStateChanged?: boolean
  }
) => void

export type SetFormReference = (key: string, form: FormInstance) => void

type Forms = {
  [key: string]: FormInstance<PlainObjectWithPrimitiveValues>
}

const initialValidator: () => ValidateGetErrorsCount = () => async () => 0

const SourceEditorFormConfiguration: React.FC<Props> = ({
  editorMode,
  initialSourceData,
  sourceDataFromCatalog,
  disabled,
  setSourceEditorState,
  setControlsDisabled,
  setTabErrorsVisible,
  setConfigIsValidatedByStreams,
}) => {
  const services = useServices()
  const [forms, setForms] = useState<Forms>({})

  const [isLoadingBackendSecretsStatus, setIsLoadingBackendSecretsStatus] = useState<boolean>(false)
  const [oauthBackendSecretsAvailable, setOauthBackendSecretsAvailable] = useState<boolean>(false)

  const backendSecretsStatus: "loading" | "secrets_set" | "secrets_not_set" = isLoadingBackendSecretsStatus
    ? "loading"
    : oauthBackendSecretsAvailable
    ? "secrets_set"
    : "secrets_not_set"

  const [staticFieldsValidator, setStaticFieldsValidator] = useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableFieldsValidator, setConfigurableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableLoadableFieldsValidator, setConfigurableLoadableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)

  const setFormReference = useCallback<SetFormReference>((key, form) => {
    setForms(forms => ({ ...forms, [key]: form }))
  }, [])

  const sourceConfigurationSchema = useMemo(() => {
    switch (sourceDataFromCatalog.protoType) {
      case "airbyte":
        return {
          loadableFieldsEndpoint: "test",
          invisibleStaticFields: {
            "config.docker_image": sourceDataFromCatalog.id.replace("airbyte-", ""),
          },
          oauthBackendSecretsStatusCheck: () => true,
        }
      case "singer":
        const tapId = sourceDataFromCatalog.id.replace("singer-", "")
        return {
          configurableFields: sourceDataFromCatalog.configParameters,
          invisibleStaticFields: {
            "config.tap": tapId,
          },
          oauthBackendSecretsStatusCheck: () =>
            services.oauthService.isOauthBackendSecretsAvailable(tapId, services.activeProject.id),
        }
    }
  }, [])

  const setOauthSecretsToForms = useCallback<(secrets: PlainObjectWithPrimitiveValues) => void>(
    secrets => {
      sourcePageUtils.applyOauthValuesToAntdForms(forms, secrets)
    },
    [forms]
  )

  const patchConfig = useCallback<PatchConfig>((key, allValues, options) => {
    setSourceEditorState(state => {
      const newState = cloneDeep(state)

      newState.configuration.config[key] = allValues

      if (!options?.doNotSetStateChanged) newState.stateChanged = true

      setTabErrorsVisible?.(false)
      setConfigIsValidatedByStreams(false)

      return newState
    })
  }, [])

  useEffect(() => {
    const validateConfigAndCountErrors = async (): Promise<number> => {
      const staticFieldsErrorsCount = await staticFieldsValidator()
      const configurableFieldsErrorsCount = await configurableFieldsValidator()
      const configurableLoadableFieldsErrorsCount = await configurableLoadableFieldsValidator()
      return staticFieldsErrorsCount + configurableLoadableFieldsErrorsCount + configurableFieldsErrorsCount
    }

    setSourceEditorState(state => {
      const newState = cloneDeep(state)
      newState.configuration.getErrorsCount = validateConfigAndCountErrors
      return newState
    })
  }, [staticFieldsValidator, configurableFieldsValidator, configurableLoadableFieldsValidator])

  /**
   * Sets source type specific fields that are not configurable by user
   */
  useEffect(() => {
    const { invisibleStaticFields, oauthBackendSecretsStatusCheck } = sourceConfigurationSchema

    if (invisibleStaticFields)
      patchConfig("invisibleStaticFields", invisibleStaticFields, {
        doNotSetStateChanged: true,
      })
    ;(async () => {
      setIsLoadingBackendSecretsStatus(true)
      try {
        const isBackendSecretsAvailable = await oauthBackendSecretsStatusCheck()
        isBackendSecretsAvailable && setOauthBackendSecretsAvailable(true)
      } finally {
        setIsLoadingBackendSecretsStatus(false)
      }
    })()
  }, [])

  return (
    <div>
      <Row key="oauth-button" className="h-8 mb-5">
        <Col span={4} />
        <Col span={20} className="pl-2">
          <OauthButton
            key="oauth-button"
            service={sourceDataFromCatalog.id}
            forceNotSupported={sourceDataFromCatalog.expertMode}
            className="mr-2"
            disabled={disabled}
            icon={<span className="align-middle h-5 w-7 pr-2 ">{sourceDataFromCatalog.pic}</span>}
            isGoogle={
              sourceDataFromCatalog.id.toLowerCase().includes("google") ||
              sourceDataFromCatalog.id.toLowerCase().includes("firebase")
            }
            setAuthSecrets={setOauthSecretsToForms}
          >
            <span className="align-top">{`Log In to Fill OAuth Credentials`}</span>
          </OauthButton>
        </Col>
      </Row>
      <fieldset key="fields" disabled={disabled}>
        <SourceEditorFormConfigurationStaticFields
          editorMode={editorMode}
          initialValues={initialSourceData}
          patchConfig={patchConfig}
          setValidator={setStaticFieldsValidator}
          setFormReference={setFormReference}
        />
        {sourceConfigurationSchema.configurableFields && (
          <SourceEditorFormConfigurationConfigurableFields
            initialValues={initialSourceData}
            configParameters={sourceConfigurationSchema.configurableFields}
            oauthBackendSecretsStatus={backendSecretsStatus}
            patchConfig={patchConfig}
            setValidator={setConfigurableFieldsValidator}
            setFormReference={setFormReference}
          />
        )}
        {sourceConfigurationSchema.loadableFieldsEndpoint && (
          <SourceEditorFormConfigurationConfigurableLoadableFields
            initialValues={initialSourceData}
            sourceDataFromCatalog={sourceDataFromCatalog}
            oauthBackendSecretsStatus={backendSecretsStatus}
            patchConfig={patchConfig}
            setControlsDisabled={setControlsDisabled}
            setValidator={setConfigurableLoadableFieldsValidator}
            setFormReference={setFormReference}
          />
        )}
      </fieldset>
    </div>
  )
}

const Wrapped = observer(SourceEditorFormConfiguration)

Wrapped.displayName = "SourceEditorFormConfiguration"

export { Wrapped as SourceEditorFormConfiguration }
