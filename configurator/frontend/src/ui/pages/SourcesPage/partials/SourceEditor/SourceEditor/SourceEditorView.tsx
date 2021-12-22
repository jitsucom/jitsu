import { Prompt } from "react-router"
// @Components
import { SourceEditorFormConfiguration } from "./SourceEditorFormConfiguration"
import { SourceEditorFormStreams } from "./SourceEditorFormStreams"
import { SourceEditorFormConnections } from "./SourceEditorFormConnections"
import { SourceEditorDocumentationDrawer } from "./SourceEditorDocumentationDrawer"
// @Types
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
import { SetSourceEditorState, SourceEditorState } from "./SourceEditor"
import { SourceEditorControlsDisabled } from "./SourceEditorViewControls"
import { SourceEditorViewSteps } from "./SourceEditorViewSteps"
import { SourceEditorViewTabs } from "./SourceEditorViewTabs"

type SourceEditorViewProps = {
  state: SourceEditorState
  controlsDisabled: SourceEditorControlsDisabled
  editorMode: "add" | "edit"
  showDocumentationDrawer: boolean
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  setSourceEditorState: SetSourceEditorState
  handleSetControlsDisabled: (disabled: boolean | string, setterId: string) => void
  setShowDocumentationDrawer: (value: boolean) => void
  handleBringSourceData: () => SourceData
  handleSave: AsyncUnknownFunction
  handleCompleteStep: VoidFunction
  handleLeaveEditor: VoidFunction
  handleValidateAndTestConfig: AsyncUnknownFunction
  handleValidateStreams: AsyncUnknownFunction
}

export const SourceEditorView: React.FC<SourceEditorViewProps> = ({
  state,
  controlsDisabled,
  editorMode,
  showDocumentationDrawer,
  initialSourceData,
  sourceDataFromCatalog,
  setSourceEditorState,
  handleSetControlsDisabled,
  setShowDocumentationDrawer,
  handleBringSourceData,
  handleSave,
  handleCompleteStep,
  handleLeaveEditor,
  handleValidateAndTestConfig,
  handleValidateStreams,
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
        />
      ),
      proceedAction: handleValidateAndTestConfig,
    },
    {
      key: "streams",
      title: "Streams",
      description: "Select data pipelines",
      errorsCount: state.streams.errorsCount,
      render: (
        <SourceEditorFormStreams
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
          handleCompleteStep={handleCompleteStep}
          handleLeaveEditor={handleLeaveEditor}
        />
      ) : (
        <SourceEditorViewTabs
          tabs={forms}
          sourceDataFromCatalog={sourceDataFromCatalog}
          controlsDisabled={controlsDisabled}
          handleSave={handleSave}
          handleValidateAndTestConfig={handleValidateAndTestConfig}
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
