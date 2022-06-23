// @Libs
import { observer } from "mobx-react-lite"
import { useCallback, useEffect, useMemo, useState } from "react"
import { cloneDeep } from "lodash"
import { FormInstance } from "antd"
// @Types
import type { SourceConnector as CatalogSourceConnector } from "@jitsu/catalog"
import type { SetSourceEditorState, SourceEditorState } from "./SourceEditor"
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
import { SourceEditorActionsTypes, useSourceEditorDispatcher, useSourceEditorState } from "./SourceEditor.state"

export type SourceEditorFormConfigurationProps = {
  editorMode: "add" | "edit"
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  disabled?: boolean
  setSourceEditorState: SetSourceEditorState
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
  handleReloadStreams,
}) => {
  const services = useServices()
  const dispatchAction = useSourceEditorDispatcher()
  const sourceEditorState = useSourceEditorState()

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
          protoType: sourceDataFromCatalog.protoType,
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
          protoType: sourceDataFromCatalog.protoType,
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
          protoType: sourceDataFromCatalog.protoType,
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

  useEffect(() => {
    const isLoadingOauth = !isOauthStatusReady || isLoadingBackendSecrets
    if (isLoadingOauth)
      dispatchAction(SourceEditorActionsTypes.SET_STATUS, {
        isLoadingOauthStatus: true,
        hasLoadedOauthFieldsStatus: Boolean(availableBackendSecrets),
      })
    else if (fillAuthDataManually)
      dispatchAction(SourceEditorActionsTypes.SET_STATUS, {
        isOauthFlowCompleted: true,
        isLoadingOauthStatus: false,
        hasLoadedOauthFieldsStatus: Boolean(availableBackendSecrets),
      })
    else if (!isOauthFlowCompleted) {
      dispatchAction(SourceEditorActionsTypes.SET_STATUS, {
        isOauthFlowCompleted: false,
        isLoadingOauthStatus: false,
        hasLoadedOauthFieldsStatus: Boolean(availableBackendSecrets),
      })
    } else {
      dispatchAction(SourceEditorActionsTypes.SET_STATUS, {
        isOauthFlowCompleted: true,
        isLoadingOauthStatus: false,
        hasLoadedOauthFieldsStatus: Boolean(availableBackendSecrets),
      })
    }
  }, [isLoadingBackendSecrets, isOauthStatusReady, fillAuthDataManually, isOauthFlowCompleted])

  return (
    <>
      {!sourceEditorState.status.hasLoadedOauthFieldsStatus ? (
        <div className={`flex justify-center items-start w-full h-full`}>
          <FormSkeleton />
        </div>
      ) : (
        <div>
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
            {sourceConfigurationSchema.loadableFields && (
              <SourceEditorFormConfigurationConfigurableLoadableFields
                initialValues={initialSourceData}
                sourceDataFromCatalog={sourceDataFromCatalog}
                availableOauthBackendSecrets={availableBackendSecrets}
                hideFields={hideFields}
                patchConfig={patchConfig}
                setValidator={setConfigurableLoadableFieldsValidator}
                setFormReference={setFormReference}
                handleResetOauth={handleResetOauth}
                handleReloadStreams={handleReloadStreams}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

const Wrapped = observer(SourceEditorFormConfiguration)

Wrapped.displayName = "SourceEditorFormConfiguration"

export { Wrapped as SourceEditorFormConfiguration }
