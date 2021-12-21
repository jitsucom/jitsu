// @Libs
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { observer } from "mobx-react-lite"
import { useHistory, useParams } from "react-router"
import { cloneDeep, snakeCase, uniqueId } from "lodash"
// @Types
import { CommonSourcePageProps } from "ui/pages/SourcesPage/SourcesPage"
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
// @Store
import { sourcesStore } from "stores/sources"
// @Catalog
import { allSources as sourcesCatalog } from "catalog/sources/lib"
// @Components
import { withHome as breadcrumbsWithHome } from "ui/components/Breadcrumbs/Breadcrumbs"
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
import { PageHeader } from "ui/components/PageHeader/PageHeader"
import { createInitialSourceData, sourceEditorUtils } from "./SourceEditor.utils"
import { sourcePageUtils } from "ui/pages/SourcesPage/SourcePage.utils"
import { firstToLower } from "lib/commons/utils"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { SourceEditorView } from "./SourceEditorView"
// @Utils

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
  const allSourcesList = sourcesStore.sources
  const { source, sourceId } = useParams<{ source?: string; sourceId?: string }>()

  const sourceDataFromCatalog = useMemo<CatalogSourceConnector>(() => {
    let sourceType = source
      ? source
      : sourceId
      ? sourcesStore.sources.find(src => src.sourceId === sourceId)?.sourceProtoType
      : undefined

    return sourceType
      ? sourcesCatalog.find((source: CatalogSourceConnector) => snakeCase(source.id) === snakeCase(sourceType))
      : undefined
  }, [sourceId, allSourcesList])

  const [initialSourceData, setInitialSourceData] = useState<Optional<Partial<SourceData>>>(
    () =>
      sourceEditorUtils.reformatCatalogIntoSelectedStreams(allSourcesList.find(src => src.sourceId === sourceId)) ??
      createInitialSourceData(sourceDataFromCatalog)
  )

  const [state, setState] = useState<SourceEditorState>(initialState)

  const [controlsDisabled, setControlsDisabled] = useState<boolean | string>(false)
  const [showDocumentation, setShowDocumentation] = useState<boolean>(false)
  const [configIsValidatedByStreams, setConfigIsValidatedByStreams] = useState<boolean>(false)

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

  const handleValidateAndTestConfig = async (): Promise<void> => {
    const someFieldsErrored = !!(await validateCountErrors())
    if (someFieldsErrored) throw new Error("some values are invalid")

    const controlsDisableRequestId = uniqueId("validateAndTest-")
    handleSetControlsDisabled("Validating source configuration", controlsDisableRequestId)

    try {
      const sourceData = handleBringSourceData()
      const testResult = await sourcePageUtils.testConnection(sourceData)
      if (!testResult.connected) throw new Error(testResult.connectedErrorMessage)
    } finally {
      handleSetControlsDisabled(false, controlsDisableRequestId)
    }
  }

  const handleValidateStreams = async (): Promise<void> => {
    const streamsErrorsCount = await state.streams.validateGetErrorsCount()
    if (streamsErrorsCount) throw new Error("some streams settings are invalid")
  }

  const handleSave = useCallback<AsyncVoidFunction>(async () => {
    let sourceEditorState = null
    setState(state => {
      sourceEditorState = state
      return { ...state, stateChanged: false }
    })
    const sourceData = handleBringSourceData()

    if (editorMode === "edit") {
      const someFieldsErrored = !!(await validateCountErrors())
      if (someFieldsErrored) {
        actionNotification.error("Some values are invalid")
        return
      }
    }

    const testConnectionResults = await sourcePageUtils.testConnection(sourceData, true)

    const sourceDataToSave: SourceData = {
      ...sourceData,
      ...testConnectionResults,
    }

    if (editorMode === "add") sourcesStore.addSource(sourceDataToSave)
    if (editorMode === "edit") sourcesStore.editSources(sourceDataToSave)

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
  }, [editorMode, state])

  const handleCompleteStep = () => {
    setInitialSourceData(handleBringSourceData())
  }

  const handleLeaveEditor = useCallback<(options?: { goToSourcesList?: boolean }) => void>(options => {
    options.goToSourcesList ? history.push(sourcesPageRoutes.root) : history.goBack()
  }, [])

  useEffect(() => {
    setBreadcrumbs(
      breadcrumbsWithHome({
        elements: [
          { title: "Sources", link: sourcesPageRoutes.root },
          {
            title: (
              <PageHeader
                title={sourceDataFromCatalog?.displayName}
                icon={sourceDataFromCatalog?.pic}
                mode={editorMode}
              />
            ),
          },
        ],
      })
    )
  }, [editorMode, sourceDataFromCatalog, setBreadcrumbs])

  return (
    <SourceEditorView
      state={state}
      controlsDisabled={controlsDisabled}
      editorMode={editorMode}
      showDocumentationDrawer={showDocumentation}
      initialSourceData={initialSourceData}
      sourceDataFromCatalog={sourceDataFromCatalog}
      configIsValidatedByStreams={configIsValidatedByStreams}
      setSourceEditorState={setState}
      handleSetControlsDisabled={handleSetControlsDisabled}
      setConfigIsValidatedByStreams={setConfigIsValidatedByStreams}
      setShowDocumentationDrawer={setShowDocumentation}
      handleBringSourceData={handleBringSourceData}
      handleSave={handleSave}
      handleCompleteStep={handleCompleteStep}
      handleLeaveEditor={handleLeaveEditor}
      handleValidateAndTestConfig={handleValidateAndTestConfig}
      handleValidateStreams={handleValidateStreams}
    />
  )
}

const Wrapped = observer(SourceEditor)

Wrapped.displayName = "SourceEditor"

export { Wrapped as SourceEditor }
