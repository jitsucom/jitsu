import { Prompt } from "react-router"
// @Components
import { SourceEditorFormConfiguration } from "./SourceEditorFormConfiguration"
import { SourceEditorFormStreams } from "./SourceEditorFormStreams"
import { SourceEditorFormConnections } from "./SourceEditorFormConnections"
import { SourceEditorDocumentationDrawer } from "./SourceEditorDocumentationDrawer"
// @Types
import { SourceConnector as CatalogSourceConnector } from "@jitsu/catalog/sources/types"
import {
  HandleSaveSource,
  HandleValidateTestConnection,
  SetSourceEditorDisabledTabs,
  SetSourceEditorInitialSourceData,
  SetSourceEditorState,
  SourceEditorDisabledTabs,
  SourceEditorState,
} from "./SourceEditor"
import { SourceEditorControlsDisabled } from "./SourceEditorViewControls"
import { SourceEditorViewSteps } from "./SourceEditorViewSteps"
import { SourceEditorViewTabs } from "./SourceEditorViewTabs"

type SourceEditorViewProps = {
  state: SourceEditorState
  controlsDisabled: SourceEditorControlsDisabled
  tabsDisabled: SourceEditorDisabledTabs
  editorMode: "add" | "edit"
  showDocumentationDrawer: boolean
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  setSourceEditorState: SetSourceEditorState
  handleSetControlsDisabled: (disabled: boolean | string, setterId: string) => void
  handleSetTabsDisabled: SetSourceEditorDisabledTabs
  setShowDocumentationDrawer: (value: boolean) => void
  handleBringSourceData: () => SourceData
  handleSave: HandleSaveSource
  setInitialSourceData: SetSourceEditorInitialSourceData
  handleLeaveEditor: VoidFunction
  handleValidateAndTestConnection: HandleValidateTestConnection
  handleValidateStreams: AsyncUnknownFunction
  handleReloadStreams: VoidFunction | AsyncVoidFunction
}

export const SourceEditorView: React.FC<SourceEditorViewProps> = ({
  state,
  controlsDisabled,
  tabsDisabled,
  editorMode,
  showDocumentationDrawer,
  initialSourceData,
  sourceDataFromCatalog,
  setSourceEditorState,
  handleSetControlsDisabled,
  handleSetTabsDisabled,
  setShowDocumentationDrawer,
  handleBringSourceData,
  handleSave,
  setInitialSourceData,
  handleLeaveEditor,
  handleValidateAndTestConnection,
  handleValidateStreams,
  handleReloadStreams,
}) => {
  const forms = [
    {
      key: "configuration",
      title: "Configuration",
      description: "Specify essential parameters",
      errorsCount: state.configuration.errorsCount,
      render: (
        <SourceEditorFormConfiguration
          editorMode={editorMode}
          initialSourceData={initialSourceData}
          sourceDataFromCatalog={sourceDataFromCatalog}
          setSourceEditorState={setSourceEditorState}
          handleSetControlsDisabled={handleSetControlsDisabled}
          handleSetTabsDisabled={handleSetTabsDisabled}
          handleReloadStreams={handleReloadStreams}
        />
      ),
      proceedAction: handleValidateAndTestConnection,
    },
    {
      key: "streams",
      title: "Streams",
      description: "Select data pipelines",
      errorsCount: state.streams.errorsCount,
      render: (
        <SourceEditorFormStreams
          editorMode={editorMode}
          initialSourceData={initialSourceData}
          sourceDataFromCatalog={sourceDataFromCatalog}
          setSourceEditorState={setSourceEditorState}
          handleSetControlsDisabled={handleSetControlsDisabled}
          handleBringSourceData={handleBringSourceData}
        />
      ),
      proceedAction: handleValidateStreams,
    },
    {
      key: "connections",
      title: "Connections",
      description: "Choose destinations to send data to",
      render: (
        <SourceEditorFormConnections
          initialSourceData={initialSourceData}
          setSourceEditorState={setSourceEditorState}
        />
      ),
      proceedButtonTitle: "Save",
      proceedAction: handleSave,
    },
  ]

  return (
    <>
      {editorMode === "add" ? (
        <SourceEditorViewSteps
          steps={forms}
          controlsDisabled={controlsDisabled}
          handleBringSourceData={handleBringSourceData}
          setInitialSourceData={setInitialSourceData}
          handleLeaveEditor={handleLeaveEditor}
        />
      ) : (
        <SourceEditorViewTabs
          sourceId={initialSourceData.sourceId}
          tabs={forms}
          tabsDisabled={tabsDisabled}
          sourceDataFromCatalog={sourceDataFromCatalog}
          controlsDisabled={controlsDisabled}
          handleSave={handleSave}
          handleValidateAndTestConnection={handleValidateAndTestConnection}
          handleLeaveEditor={handleLeaveEditor}
          setShowDocumentationDrawer={setShowDocumentationDrawer}
        />
      )}

      <Prompt
        message={"You have unsaved changes. Are you sure you want to leave without saving?"}
        when={state.stateChanged}
      />

      {sourceDataFromCatalog?.documentation && (
        <SourceEditorDocumentationDrawer
          visible={showDocumentationDrawer}
          sourceDataFromCatalog={sourceDataFromCatalog}
          setVisible={setShowDocumentationDrawer}
        />
      )}
    </>
  )
}
