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
  configIsValidatedByStreams: boolean
  setSourceEditorState: SetSourceEditorState
  handleSetControlsDisabled: (disabled: boolean | string, setterId: string) => void
  setConfigIsValidatedByStreams: (value: boolean) => void
  setShowDocumentationDrawer: (value: boolean) => void
  handleBringSourceData: () => SourceData
  handleSave: AsyncUnknownFunction
  handleCompleteStep: VoidFunction
  handleLeaveEditor: VoidFunction
  handleValidateAndTestConfig: AsyncUnknownFunction
}

export const SourceEditorView: React.FC<SourceEditorViewProps> = ({
  state,
  controlsDisabled,
  editorMode,
  showDocumentationDrawer,
  initialSourceData,
  sourceDataFromCatalog,
  configIsValidatedByStreams,
  setSourceEditorState,
  handleSetControlsDisabled,
  setConfigIsValidatedByStreams,
  setShowDocumentationDrawer,
  handleBringSourceData,
  handleSave,
  handleCompleteStep,
  handleLeaveEditor,
  handleValidateAndTestConfig,
}) => {
  const forms = [
    {
      key: "configuration",
      title: "Configuration",
      description: "Specify essential parameters",
      render: (
        <SourceEditorFormConfiguration
          editorMode={editorMode}
          initialSourceData={initialSourceData}
          sourceDataFromCatalog={sourceDataFromCatalog}
          setSourceEditorState={setSourceEditorState}
          handleSetControlsDisabled={handleSetControlsDisabled}
          setConfigIsValidatedByStreams={setConfigIsValidatedByStreams}
        />
      ),
      proceedAction: handleValidateAndTestConfig,
    },
    {
      key: "streams",
      title: "Streams",
      description: "Select data pipelines",
      render: (
        <SourceEditorFormStreams
          initialSourceData={initialSourceData}
          sourceDataFromCatalog={sourceDataFromCatalog}
          sourceConfigValidatedByStreamsTab={configIsValidatedByStreams}
          setSourceEditorState={setSourceEditorState}
          handleSetControlsDisabled={handleSetControlsDisabled}
          setConfigIsValidatedByStreams={setConfigIsValidatedByStreams}
          handleBringSourceData={handleBringSourceData}
        />
      ),
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
