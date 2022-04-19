// @Libs
import { observer } from "mobx-react-lite"
import { useCallback, useEffect, useMemo, useState } from "react"
import { cloneDeep } from "lodash"
import { FormInstance } from "antd"
// @Types
import { SourceConnector as CatalogSourceConnector } from "@jitsu/catalog/sources/types"
import { SetSourceEditorDisabledTabs, SetSourceEditorState, SourceEditorState } from "./SourceEditor"
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
import { useUniqueKeyState } from "hooks/useUniqueKeyState"
import { FormSkeleton } from "ui/components/FormSkeleton/FormSkeleton"

export type SourceEditorFormConfigurationProps = {
  editorMode: "add" | "edit"
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  disabled?: boolean
  setSourceEditorState: SetSourceEditorState
  handleSetControlsDisabled: (disabled: boolean | string, setterId: string) => void
  handleSetTabsDisabled: SetSourceEditorDisabledTabs
  handleReloadStreams: VoidFunction | AsyncVoidFunction
}

export type ValidateGetErrorsCount = () => Promise<number>
export type PatchConfig = (
  key: string,
  allValues: PlainObjectWithPrimitiveValues,
  options?: {
    /**
     * Whether to tell the parent component to update the UI.
     * Needed to distinguish the state updates caused by the user and updates made internally.
     **/
    doNotSetStateChanged?: boolean
    /** Whether to reset configuration tab errors count. False by default */
    resetErrorsCount?: boolean
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
  handleSetTabsDisabled,
  handleReloadStreams,
}) => {
  const services = useServices()
  const [forms, setForms] = useState<Forms>({})

  const isInitiallySignedIn = editorMode === "edit"

  const [fillAuthDataManually, setFillAuthDataManually] = useState<boolean>(true)
  const [isOauthStatusReady, setIsOauthStatusReady] = useState<boolean>(false)
  const [isOauthFlowCompleted, setIsOauthFlowCompleted] = useState<boolean>(isInitiallySignedIn)

  const [staticFieldsValidator, setStaticFieldsValidator] = useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableFieldsValidator, setConfigurableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)
  const [configurableLoadableFieldsValidator, setConfigurableLoadableFieldsValidator] =
    useState<ValidateGetErrorsCount>(initialValidator)

  const [resetKey, resetFormUi] = useUniqueKeyState() // pass a key to a component, then re-mount component by calling `resetFormUi`

  const setFormReference = useCallback<SetFormReference>((key, form, patchConfigOnFormValuesChange) => {
    setForms(forms => ({ ...forms, [key]: { form, patchConfigOnFormValuesChange } }))
  }, [])

  const sourceConfigurationSchema = useMemo(() => {
    switch (sourceDataFromCatalog.protoType) {
      case "sdk_source":
        const sdkSourceId = sourceDataFromCatalog.id.replace("sdk-", "")
        return {
          backendId: sdkSourceId,
          hideOauthFields: true,
          loadableFields: true,
          configurableFields: sourceDataFromCatalog.configParameters,
          protoType: sourceDataFromCatalog.protoType
        }
      case "airbyte":
        const airbyteId = sourceDataFromCatalog.id.replace("airbyte-", "")
        return {
          backendId: airbyteId,
          hideOauthFields: true,
          loadableFields: true,
          invisibleStaticFields: {
            "config.docker_image": sourceDataFromCatalog.id.replace("airbyte-", ""),
          },
          protoType: sourceDataFromCatalog.protoType
        }
      case "singer":
        const tapId = sourceDataFromCatalog.id.replace("singer-", "")
        return {
          backendId: tapId,
          hideOauthFields: true,
          configurableFields: sourceDataFromCatalog.configParameters,
          invisibleStaticFields: {
            "config.tap": tapId,
          },
          protoType: sourceDataFromCatalog.protoType
        }
      /** Native source */
      default:
        const id = sourceDataFromCatalog.id
        return {
          backendId: id,
          hideOauthFields: true,
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

  const handleResetOauth = useCallback<() => void>(() => {
    setIsOauthFlowCompleted(false)
  }, [])

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
      if (options.resetErrorsCount) newState.configuration.errorsCount = 0

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
      newState.configuration.validateGetErrorsCount = validateConfigAndCountErrors
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
    if (isLoadingOauth) handleSetControlsDisabled(true, "byOauthFlow")
    else if (fillAuthDataManually) handleSetControlsDisabled(false, "byOauthFlow")
    else if (!isOauthFlowCompleted) {
      handleSetControlsDisabled("Please, either grant Jitsu access or fill auth credentials manually", "byOauthFlow")
      handleSetTabsDisabled(["streams"], "disable")
    } else {
      handleSetControlsDisabled(false, "byOauthFlow")
      handleSetTabsDisabled(["streams"], "enable")
    }
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
          isSignedIn={isOauthFlowCompleted}
          onIsOauthSupportedCheckSuccess={handleOauthSupportedStatusChange}
          onFillAuthDataManuallyChange={handleFillAuthDataManuallyChange}
          setOauthSecretsToForms={setOauthSecretsToForms}
        />
        <div key={resetKey}>
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
          {sourceConfigurationSchema.loadableFields && sourceConfigurationSchema.protoType == "airbyte"  && (
            <SourceEditorFormConfigurationConfigurableLoadableFields
              editorMode={editorMode}
              initialValues={initialSourceData as AirbyteSourceData}
              sourceDataFromCatalog={sourceDataFromCatalog}
              hideFields={hideFields}
              patchConfig={patchConfig}
              handleSetControlsDisabled={handleSetControlsDisabled}
              handleSetTabsDisabled={handleSetTabsDisabled}
              setValidator={setConfigurableLoadableFieldsValidator}
              setFormReference={setFormReference}
              handleResetOauth={handleResetOauth}
              handleReloadStreams={handleReloadStreams}
            />
          )}
          {sourceConfigurationSchema.loadableFields && sourceConfigurationSchema.protoType == "sdk_source"  && (
            <SourceEditorFormConfigurationConfigurableLoadableFields
              editorMode={editorMode}
              initialValues={initialSourceData as SDKSourceData}
              sourceDataFromCatalog={sourceDataFromCatalog}
              hideFields={hideFields}
              patchConfig={patchConfig}
              handleSetControlsDisabled={handleSetControlsDisabled}
              handleSetTabsDisabled={handleSetTabsDisabled}
              setValidator={setConfigurableLoadableFieldsValidator}
              setFormReference={setFormReference}
              handleResetOauth={handleResetOauth}
              handleReloadStreams={handleReloadStreams}
            />
          )}
        </div>
      </div>
    </>
  )
}

const Wrapped = observer(SourceEditorFormConfiguration)

Wrapped.displayName = "SourceEditorFormConfiguration"

export { Wrapped as SourceEditorFormConfiguration }
