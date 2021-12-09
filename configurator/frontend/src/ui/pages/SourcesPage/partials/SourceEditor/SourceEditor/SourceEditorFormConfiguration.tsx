// @Libs
import { observer } from "mobx-react-lite"
import { useCallback, useEffect, useMemo, useState } from "react"
import { cloneDeep } from "lodash"
import { FormInstance, Spin } from "antd"
// @Types
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
import { SetSourceEditorState } from "./SourceEditor"
// @Components
import { SourceEditorFormConfigurationStaticFields } from "./SourceEditorFormConfigurationStaticFields"
import { SourceEditorFormConfigurationConfigurableLoadableFields } from "./SourceEditorFormConfigurationConfigurableLoadableFields"
import { SourceEditorFormConfigurationConfigurableFields } from "./SourceEditorFormConfigurationConfigurableFields"
// @Utils
import { useServices } from "hooks/useServices"
import { useLoaderAsObject } from "hooks/useLoader"
import { OAUTH_FIELDS_NAMES } from "constants/oauth"
import { SourceEditorOauthButtons } from "../Common/SourceEditorOauthButtons/SourceEditorOauthButtons"
import { sourcePageUtils } from "ui/pages/SourcesPage/SourcePage.utils"
import { useForceUpdate } from "hooks/useForceUpdate"
import { useUniqueKeyState } from "hooks/useUniqueKeyState"

export type SourceEditorFormConfigurationProps = {
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

const SourceEditorFormConfiguration: React.FC<SourceEditorFormConfigurationProps> = ({
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
  const forceUpdate = useForceUpdate()
  const [forms, setForms] = useState<Forms>({})

  const [fillAuthDataManually, setFillAuthDataManually] = useState<boolean>(true)
  const [isOauthStatusReady, setIsOauthStatusReady] = useState<boolean>(false)

  const [staticFieldsValidator, setStaticFieldsValidator] = useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableFieldsValidator, setConfigurableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableLoadableFieldsValidator, setConfigurableLoadableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)

  const [key, resetFormUi] = useUniqueKeyState() // pass a key to a component, then re-mount component by calling `resetFormUi`

  const setFormReference = useCallback<SetFormReference>((key, form) => {
    setForms(forms => ({ ...forms, [key]: form }))
  }, [])

  const sourceConfigurationSchema = useMemo(() => {
    switch (sourceDataFromCatalog.protoType) {
      case "airbyte":
        const airbyteId = sourceDataFromCatalog.id.replace("airbyte-", "")
        return {
          backendId: airbyteId,
          hideOauthFields: false,
          onlyManualAuth: true,
          loadableFieldsEndpoint: "test",
          invisibleStaticFields: {
            "config.docker_image": sourceDataFromCatalog.id.replace("airbyte-", ""),
          },
        }
      case "singer":
        const tapId = sourceDataFromCatalog.id.replace("singer-", "")
        return {
          backendId: tapId,
          hideOauthFields: true,
          onlyManualAuth: false,
          configurableFields: sourceDataFromCatalog.configParameters,
          invisibleStaticFields: {
            "config.tap": tapId,
          },
        }
    }
  }, [])

  const { data: availableBackendSecrets, isLoading: isLoadingBackendSecrets } = useLoaderAsObject<
    string[]
  >(async () => {
    const { backendId, hideOauthFields } = sourceConfigurationSchema
    if (!hideOauthFields) return []
    return await services.oauthService.getAvailableBackendSecrets(backendId, services.activeProject.id)
  }, [])

  const hideFields = useMemo<string[]>(() => {
    const { hideOauthFields } = sourceConfigurationSchema
    return fillAuthDataManually || !hideOauthFields ? [] : [...OAUTH_FIELDS_NAMES, ...(availableBackendSecrets ?? [])]
  }, [fillAuthDataManually, availableBackendSecrets])

  const handleOauthSupportedStatusChange = useCallback((oauthSupported: boolean) => {
    setIsOauthStatusReady(true)
    setFillAuthDataManually(!oauthSupported)
  }, [])

  const handleFillAuthDataManuallyChange = (fillManually: boolean) => {
    setFillAuthDataManually(fillManually)
    if (!fillManually) resetFormUi() // reset form if user switched from manual auth back to oauth
  }

  const setOauthSecretsToForms = useCallback<(secrets: PlainObjectWithPrimitiveValues) => void>(
    secrets => {
      sourcePageUtils.applyOauthValuesToAntdForms(forms, secrets)
      forceUpdate()
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
    const { invisibleStaticFields } = sourceConfigurationSchema
    if (invisibleStaticFields)
      patchConfig("invisibleStaticFields", invisibleStaticFields, {
        doNotSetStateChanged: true,
      })
  }, [])

  const isLoadingOauth = !isOauthStatusReady || isLoadingBackendSecrets

  return (
    <>
      <div className={`flex justify-center items-center w-full h-full ${isLoadingOauth ? "" : "hidden"}`}>
        <Spin />
      </div>
      <div key={key} className={isLoadingOauth ? "hidden" : ""}>
        <SourceEditorOauthButtons
          key="oauth"
          sourceDataFromCatalog={sourceDataFromCatalog}
          disabled={disabled}
          onlyManualAuth={sourceConfigurationSchema.onlyManualAuth}
          onIsOauthSupportedChange={handleOauthSupportedStatusChange}
          onFillAuthDataManuallyChange={handleFillAuthDataManuallyChange}
          setOauthSecretsToForms={setOauthSecretsToForms}
        />
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
              availableOauthBackendSecrets={availableBackendSecrets}
              hideFields={hideFields}
              patchConfig={patchConfig}
              setValidator={setConfigurableFieldsValidator}
              setFormReference={setFormReference}
            />
          )}
          {sourceConfigurationSchema.loadableFieldsEndpoint && (
            <SourceEditorFormConfigurationConfigurableLoadableFields
              initialValues={initialSourceData}
              sourceDataFromCatalog={sourceDataFromCatalog}
              availableOauthBackendSecrets={availableBackendSecrets}
              hideFields={hideFields}
              patchConfig={patchConfig}
              setControlsDisabled={setControlsDisabled}
              setValidator={setConfigurableLoadableFieldsValidator}
              setFormReference={setFormReference}
            />
          )}
        </fieldset>
      </div>
    </>
  )
}

const Wrapped = observer(SourceEditorFormConfiguration)

Wrapped.displayName = "SourceEditorFormConfiguration"

export { Wrapped as SourceEditorFormConfiguration }
