// @Libs
import { observer } from "mobx-react-lite"
import { useCallback, useEffect, useMemo, useState } from "react"
import { cloneDeep } from "lodash"
import { FormInstance } from "antd"
// @Types
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
import { SetSourceEditorState, SourceEditorState } from "./SourceEditor"
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
import { FormSkeleton } from "ui/components/FormSkeleton/FormSkeleton"

export type SourceEditorFormConfigurationProps = {
  editorMode: "add" | "edit"
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  disabled?: boolean
  setSourceEditorState: SetSourceEditorState
  handleSetControlsDisabled: (disabled: boolean | string, setterId: string) => void
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

export type SetFormReference = (
  key: string,
  form: FormInstance,
  patchConfigOnFormValuesChange?: (values: PlainObjectWithPrimitiveValues) => void
) => void

type Forms = {
  [key: string]: {
    form: FormInstance<PlainObjectWithPrimitiveValues>
    patchConfigOnFormValuesChange?: (values: PlainObjectWithPrimitiveValues) => void
  }
}

const initialValidator: () => ValidateGetErrorsCount = () => async () => 0

const SourceEditorFormConfiguration: React.FC<SourceEditorFormConfigurationProps> = ({
  editorMode,
  initialSourceData,
  sourceDataFromCatalog,
  disabled,
  setSourceEditorState,
  handleSetControlsDisabled,
  setTabErrorsVisible,
  setConfigIsValidatedByStreams,
}) => {
  const services = useServices()
  const [forms, setForms] = useState<Forms>({})

  const [fillAuthDataManually, setFillAuthDataManually] = useState<boolean>(true)
  const [isOauthStatusReady, setIsOauthStatusReady] = useState<boolean>(false)
  const [isOauthFlowCompleted, setIsOauthFlowCompleted] = useState<boolean>(false)

  const [staticFieldsValidator, setStaticFieldsValidator] = useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableFieldsValidator, setConfigurableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableLoadableFieldsValidator, setConfigurableLoadableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)

  const [key, resetFormUi] = useUniqueKeyState() // pass a key to a component, then re-mount component by calling `resetFormUi`

  const setFormReference = useCallback<SetFormReference>((key, form, patchConfigOnFormValuesChange) => {
    setForms(forms => ({ ...forms, [key]: { form, patchConfigOnFormValuesChange } }))
  }, [])

  const sourceConfigurationSchema = useMemo(() => {
    switch (sourceDataFromCatalog.protoType) {
      case "airbyte":
        const airbyteId = sourceDataFromCatalog.id.replace("airbyte-", "")
        return {
          backendId: airbyteId,
          hideOauthFields: true,
          onlyManualAuth: false,
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
      default:
        // native source
        const id = sourceDataFromCatalog.id
        return {
          backendId: id,
          hideOauthFields: true,
          onlyManualAuth: false,
          configurableFields: sourceDataFromCatalog.configParameters,
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
    if (!fillManually) {
      resetFormUi() // reset form if user switched from manual auth back to oauth
      setIsOauthFlowCompleted(false) // force user to push the 'Authorize' button one more time
    }
  }

  const setOauthSecretsToForms = useCallback<(secrets: PlainObjectWithPrimitiveValues) => void>(
    secrets => {
      const success = sourcePageUtils.applyOauthValuesToAntdForms(forms, secrets)
      success && setIsOauthFlowCompleted(true)
    },
    [forms]
  )

  const patchConfig = useCallback<PatchConfig>((key, allValues, options) => {
    setSourceEditorState(state => {
      const newState: SourceEditorState = {
        ...state,
        configuration: { ...state.configuration, config: { ...state.configuration.config, [key]: allValues } },
      }
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

  useEffect(() => {
    if (sourceConfigurationSchema.onlyManualAuth) return
    else if (isLoadingOauth) handleSetControlsDisabled(true, "byOauthFlow")
    else if (fillAuthDataManually) handleSetControlsDisabled(false, "byOauthFlow")
    else if (editorMode === "edit") handleSetControlsDisabled(false, "byOauthFlow")
    else if (!isOauthFlowCompleted)
      handleSetControlsDisabled("Please, either grant Jitsu access or fill auth credentials manually", "byOauthFlow")
    else handleSetControlsDisabled(false, "byOauthFlow")
  }, [isLoadingOauth, fillAuthDataManually, isOauthFlowCompleted])

  return (
    <>
      <div className={`flex justify-center items-start w-full h-full ${isLoadingOauth ? "" : "hidden"}`}>
        <FormSkeleton />
      </div>
      <div className={isLoadingOauth ? "hidden" : ""}>
        <SourceEditorOauthButtons
          key="oauth"
          sourceDataFromCatalog={sourceDataFromCatalog}
          disabled={disabled}
          onlyManualAuth={sourceConfigurationSchema.onlyManualAuth}
          onIsOauthSupportedCheckSuccess={handleOauthSupportedStatusChange}
          onFillAuthDataManuallyChange={handleFillAuthDataManuallyChange}
          setOauthSecretsToForms={setOauthSecretsToForms}
        />
        <fieldset key={key} disabled={disabled}>
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
              handleSetControlsDisabled={handleSetControlsDisabled}
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
