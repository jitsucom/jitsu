// @Libs
import React, { useCallback, useMemo, useState } from "react"
import { observer } from "mobx-react-lite"
import { useHistory, useParams } from "react-router"
import { cloneDeep, snakeCase, uniqueId } from "lodash"
// @Types
import { CommonSourcePageProps } from "ui/pages/SourcesPage/SourcesPage"
import { SourceConnector as CatalogSourceConnector } from "@jitsu/catalog/sources/types"
// @Store
import { sourcesStore } from "stores/sources"
// @Catalog
import { allSources as sourcesCatalog } from "@jitsu/catalog/sources/lib"
// @Components
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
import { createInitialSourceData, sourceEditorUtils, useBreadcrubmsEffect } from "./SourceEditor.utils"
import { sourcePageUtils, TestConnectionResponse } from "ui/pages/SourcesPage/SourcePage.utils"
import { firstToLower } from "lib/commons/utils"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { SourceEditorView } from "./SourceEditorView"
import { ErrorDetailed } from "lib/commons/errors"
// @Utils

/** Accumulated state of all forms that is transformed and sent to backend on source save */
export type SourceEditorState = {
  /**
   * Source configuration step/tab
   */
  configuration: ConfigurationState
  /**
   * Source streams step/tab
   */
  streams: StreamsState
  /**
   * Source connected destinations step/tab
   */
  connections: ConnectionsState
  /**
   * Whether user made any changes
   */
  stateChanged: boolean
}
export type SetSourceEditorState = React.Dispatch<React.SetStateAction<SourceEditorState>>

/** Initial source data used to render the forms */
export type SourceEditorInitialSourceData = Optional<Partial<SourceData>>
export type SetSourceEditorInitialSourceData = React.Dispatch<React.SetStateAction<SourceEditorInitialSourceData>>

/** Set of source editor disabled tabs */
export type SourceEditorDisabledTabs = Set<string>
export type SetSourceEditorDisabledTabs = (tabKeys: string[], action: "enable" | "disable") => void

/** Method for saving the configured source */
export type HandleSaveSource = (config?: HandleSaveSourceConfig) => Promise<void>
type HandleSaveSourceConfig = {
  /** Errors names to skip when saving the source */
  ignoreErrors?: string[]
}

/** Method for validating and testing connection of the configured source */
export type HandleValidateTestConnection = (config?: HandleValidateTestConnectionConfig) => Promise<void>
type HandleValidateTestConnectionConfig = {
  /** Errors names to skip when testing the source connection */
  ignoreErrors?: string[]
}

type ConfigurationState = {
  config: SourceConfigurationData
  validateGetErrorsCount: () => Promise<number>
  errorsCount: number
}

type StreamsState = {
  /** @deprecated use `selectedStreams` instead */
  streams?: SourceStreamsData
  selectedStreams: SourceSelectedStreams
  validateGetErrorsCount: () => Promise<number>
  forceReloadStreamsList: VoidFunction | AsyncVoidFunction
  errorsCount: number
}

type ConnectionsState = {
  connections: SourceConnectionsData
  errorsCount: number
}

export type SourceConfigurationData = {
  [key: string]: PlainObjectWithPrimitiveValues
}
export type SourceStreamsData = {
  [pathToStreamsInSourceData: string]: StreamData[]
}
export type SourceSelectedStreams = {
  [pathToSelectedStreamsInSourceData: string]: StreamConfig[]
}
export type SourceConnectionsData = {
  [pathToConnectionsInSourceData: string]: string[]
}

export type UpdateConfigurationFields = (newFileds: Partial<SourceConfigurationData>) => void

const initialState: SourceEditorState = {
  configuration: {
    config: {},
    validateGetErrorsCount: async () => 0,
    errorsCount: 0,
  },
  streams: {
    streams: {},
    selectedStreams: {},
    validateGetErrorsCount: async () => 0,
    forceReloadStreamsList: () => {},
    errorsCount: 0,
  },
  connections: {
    connections: {},
    errorsCount: 0,
  },
  stateChanged: false,
}

const disableControlsRequestsRegistry = new Map<string, { tooltipMessage?: string }>()

const SourceEditor: React.FC<CommonSourcePageProps> = ({ editorMode, setBreadcrumbs }) => {
  const history = useHistory()
  const allSourcesList = sourcesStore.list
  const { source, sourceId } = useParams<{ source?: string; sourceId?: string }>()

  const sourceDataFromCatalog = useMemo<CatalogSourceConnector>(() => {
    let sourceType = source
      ? source
      : sourceId
      ? sourcesStore.list.find(src => src.sourceId === sourceId)?.sourceProtoType
      : undefined

    return sourceType
      ? sourcesCatalog.find((source: CatalogSourceConnector) => snakeCase(source.id) === snakeCase(sourceType))
      : undefined
  }, [sourceId, allSourcesList])

  const [initialSourceData, setInitialSourceData] = useState<SourceEditorInitialSourceData>(
    () =>
      sourceEditorUtils.reformatCatalogIntoSelectedStreams(allSourcesList.find(src => src.sourceId === sourceId)) ??
      createInitialSourceData(sourceDataFromCatalog)
  )

  const [state, setState] = useState<SourceEditorState>(initialState)

  const [controlsDisabled, setControlsDisabled] = useState<boolean | string>(false)
  const [tabsDisabled, setTabsDisabled] = useState<SourceEditorDisabledTabs>(null)
  const [showDocumentation, setShowDocumentation] = useState<boolean>(false)

  const handleSetControlsDisabled = useCallback((disabled: boolean | string, disableRequestId: string): void => {
    const tooltipMessage: string | undefined = typeof disabled === "string" ? disabled : undefined
    if (disabled) {
      setControlsDisabled(disabled)
      disableControlsRequestsRegistry.set(disableRequestId, { tooltipMessage })
    } else {
      disableControlsRequestsRegistry.delete(disableRequestId)
      // enable back only if controls are not disabled by any other callers
      if (disableControlsRequestsRegistry.size === 0) {
        setControlsDisabled(disabled)
      } else {
        // set the tooltip message by a last `disable` caller
        let disabled: boolean | string = true
        disableControlsRequestsRegistry.forEach(({ tooltipMessage }) => {
          if (tooltipMessage) disabled = tooltipMessage
        })
        setControlsDisabled(disabled)
      }
    }
  }, [])

  const handleSetTabsDisabled = useCallback<SetSourceEditorDisabledTabs>((tabKeys, action) => {
    setTabsDisabled(state => {
      const newState = new Set(state)
      tabKeys.forEach(key => (action === "disable" ? newState.add(key) : newState.delete(key)))
      return newState
    })
  }, [])

  const handleBringSourceData = () => {
    let sourceEditorState = state
    setState(state => {
      sourceEditorState = state
      return state
    })
    return sourceEditorUtils.getSourceDataFromState(sourceEditorState, sourceDataFromCatalog, initialSourceData)
  }

  const validateCountErrors = async (): Promise<number> => {
    const configurationErrorsCount = await state.configuration.validateGetErrorsCount()
    const streamsErrorsCount = await state.streams.validateGetErrorsCount()

    setState(state => {
      const newState = cloneDeep(state)
      newState.configuration.errorsCount = configurationErrorsCount
      newState.streams.errorsCount = streamsErrorsCount
      return newState
    })

    return configurationErrorsCount + streamsErrorsCount
  }

  const validateAllForms = async () => {
    const someFieldsErrored = !!(await validateCountErrors())
    if (someFieldsErrored) throw new Error("some values are invalid")
  }

  const getTestConnectionResponse = async (): Promise<TestConnectionResponse> => {
    const sourceData = handleBringSourceData()
    const testResult = await sourcePageUtils.testConnection(sourceData, true)
    return testResult
  }

  const assertCanConnect = async (config?: {
    testConnectionResponse?: TestConnectionResponse
    ignoreErrors?: string[]
  }): Promise<void> => {
    const response = config?.testConnectionResponse ?? (await getTestConnectionResponse())
    if (!response.connected && !config?.ignoreErrors?.includes(response.connectedErrorType))
      throw new ErrorDetailed({
        message: response.connectedErrorMessage,
        name: response.connectedErrorType,
        payload: response.connectedErrorPayload,
      })
  }

  const handleValidateAndTestConnection: HandleValidateTestConnection = async (methodConfig): Promise<void> => {
    await validateAllForms()
    const controlsDisableRequestId = uniqueId("validateAndTest-")
    handleSetControlsDisabled("Validating source configuration", controlsDisableRequestId)
    try {
      await assertCanConnect({ ignoreErrors: methodConfig?.ignoreErrors })
    } finally {
      handleSetControlsDisabled(false, controlsDisableRequestId)
    }
  }

  const handleSave = useCallback<HandleSaveSource>(
    async methodConfig => {
      let sourceEditorState = null
      setState(state => {
        sourceEditorState = state // hack for getting the most recent state in the async function
        return { ...state, stateChanged: false }
      })

      if (editorMode === "edit") await validateAllForms()

      const sourceData = handleBringSourceData()
      const testConnectionResults = await sourcePageUtils.testConnection(sourceData, true)

      await assertCanConnect({
        testConnectionResponse: testConnectionResults,
        ignoreErrors: methodConfig?.ignoreErrors,
      })

      const sourceDataToSave: SourceData = {
        ...sourceData,
        ...testConnectionResults,
      }

      if (editorMode === "add") sourcesStore.add(sourceDataToSave)
      if (editorMode === "edit") sourcesStore.replace(sourceDataToSave)

      handleLeaveEditor({ goToSourcesList: true })

      if (sourceDataToSave.connected) {
        actionNotification.success(editorMode === "add" ? "New source has been added!" : "Source has been saved")
      } else {
        actionNotification.warn(
          `Source has been saved, but test has failed with '${firstToLower(
            sourceDataToSave.connectedErrorMessage
          )}'. Data from this source will not be available`
        )
      }
    },
    [editorMode, state]
  )

  const handleLeaveEditor = useCallback<(options?: { goToSourcesList?: boolean }) => void>(options => {
    options.goToSourcesList ? history.push(sourcesPageRoutes.root) : history.goBack()
  }, [])

  const handleValidateStreams = async (): Promise<void> => {
    const streamsErrorsCount = await state.streams.validateGetErrorsCount()
    if (streamsErrorsCount) throw new Error("some streams settings are invalid")
  }

  useBreadcrubmsEffect({ editorMode, sourceDataFromCatalog, setBreadcrumbs })

  return (
    <SourceEditorView
      state={state}
      controlsDisabled={controlsDisabled}
      tabsDisabled={tabsDisabled}
      editorMode={editorMode}
      showDocumentationDrawer={showDocumentation}
      initialSourceData={initialSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      setSourceEditorState={setState}
      handleSetControlsDisabled={handleSetControlsDisabled}
      handleSetTabsDisabled={handleSetTabsDisabled}
      setShowDocumentationDrawer={setShowDocumentation}
      handleBringSourceData={handleBringSourceData}
      handleSave={handleSave}
      setInitialSourceData={setInitialSourceData}
      handleLeaveEditor={handleLeaveEditor}
      handleValidateAndTestConnection={handleValidateAndTestConnection}
      handleValidateStreams={handleValidateStreams}
      handleReloadStreams={state.streams.forceReloadStreamsList}
    />
  )
}

const Wrapped = observer(SourceEditor)

Wrapped.displayName = "SourceEditor"

export { Wrapped as SourceEditor }
