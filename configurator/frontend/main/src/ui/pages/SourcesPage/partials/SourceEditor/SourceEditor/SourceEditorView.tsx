import { Prompt } from "react-router"
// @Components
import { SourceEditorFormConfiguration } from "./SourceEditorFormConfiguration"
import { SourceEditorFormStreams } from "./SourceEditorFormStreams"
import { SourceEditorFormConnections } from "./SourceEditorFormConnections"
import { SourceEditorDocumentationDrawer } from "./SourceEditorDocumentationDrawer"
// @Types
import type { SourceConnector as CatalogSourceConnector } from "@jitsu/catalog/sources/types"
import type {
  HandleSaveSource,
  HandleValidateTestConnection,
  SetSourceEditorInitialSourceData,
  SetSourceEditorState,
  SourceEditorState,
} from "./SourceEditor"
import { SourceEditorViewSteps } from "./SourceEditorViewSteps"
import { SourceEditorViewTabs } from "./SourceEditorViewTabs"

type SourceEditorViewProps = {
  state: SourceEditorState
  editorMode: "add" | "edit"
  showDocumentationDrawer: boolean
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  setSourceEditorState: SetSourceEditorState
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
  editorMode,
  showDocumentationDrawer,
  initialSourceData,
  sourceDataFromCatalog,
  setSourceEditorState,
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
          handleBringSourceData={handleBringSourceData}
          setInitialSourceData={setInitialSourceData}
          handleLeaveEditor={handleLeaveEditor}
        />
      ) : (
        <SourceEditorViewTabs
          sourceId={initialSourceData.sourceId}
          tabs={forms}
          sourceDataFromCatalog={sourceDataFromCatalog}
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
