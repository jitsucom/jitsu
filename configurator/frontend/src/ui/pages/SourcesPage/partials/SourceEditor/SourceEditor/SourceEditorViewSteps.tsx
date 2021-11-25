import cn from "classnames"
import { Prompt } from "react-router"
// @Components
import { SourceEditorFormConfiguration } from "./SourceEditorFormConfiguration"
import { SourceEditorFormStreams } from "./SourceEditorFormStreams"
import { SourceEditorFormConnections } from "./SourceEditorFormConnections"
import { SourceEditorDocumentationDrawer } from "./SourceEditorDocumentationDrawer"
// @Types
import { SourceConnector as CatalogSourceConnector } from "catalog/sources/types"
import { SetSourceEditorState, SourceEditorState } from "./SourceEditor"
import { useState } from "react"
import { Steps } from "antd"
import { SourceEditorViewStepsControls } from "./SourceEditorViewStepsControls"
import { LoadingOutlined } from "@ant-design/icons"

type SourceEditorTabsViewProps = {
  state: SourceEditorState
  controlsDisabled: boolean
  editorMode: "add" | "edit"
  showDocumentationDrawer: boolean
  initialSourceData: Optional<Partial<SourceData>>
  sourceDataFromCatalog: CatalogSourceConnector
  configIsValidatedByStreams: boolean
  setSourceEditorState: SetSourceEditorState
  setControlsDisabled: ReactSetState<boolean>
  setConfigIsValidatedByStreams: (value: boolean) => void
  setShowDocumentationDrawer: (value: boolean) => void
  handleBringSourceData: () => SourceData
  handleSave: AsyncUnknownFunction
  handleCompleteStep: VoidFunction
  handleLeaveEditor: VoidFunction
  handleValidateAndTestConfig: AsyncUnknownFunction
}

export const SourceEditorViewSteps: React.FC<SourceEditorTabsViewProps> = ({
  state,
  controlsDisabled,
  editorMode,
  showDocumentationDrawer,
  initialSourceData,
  sourceDataFromCatalog,
  configIsValidatedByStreams,
  setSourceEditorState,
  setControlsDisabled,
  setConfigIsValidatedByStreams,
  setShowDocumentationDrawer,
  handleBringSourceData,
  handleSave,
  handleCompleteStep,
  handleLeaveEditor,
  handleValidateAndTestConfig,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [currentStepIsLoading, setCurrentStepIsLoading] = useState<boolean>(false)

  const handleGoToNextStep: AsyncUnknownFunction = async () => {
    handleCompleteStep()
    setCurrentStep(step => step + 1)
  }

  const handleStepBack: AsyncUnknownFunction = async () => {
    handleCompleteStep()
    setCurrentStep(step => step - 1)
  }

  const configurationProceedAction: AsyncUnknownFunction = async () => {
    setControlsDisabled(true)
    setCurrentStepIsLoading(true)
    try {
      await handleValidateAndTestConfig()
      await handleGoToNextStep()
    } catch {
    } finally {
      setCurrentStepIsLoading(false)
      setControlsDisabled(false)
    }
  }

  const steps = [
    {
      title: "Configuration",
      description: "Specify essential parameters",
      render: (
        <SourceEditorFormConfiguration
          editorMode={editorMode}
          initialSourceData={initialSourceData}
          sourceDataFromCatalog={sourceDataFromCatalog}
          disabled={currentStepIsLoading}
          setSourceEditorState={setSourceEditorState}
          setControlsDisabled={setControlsDisabled}
          setConfigIsValidatedByStreams={setConfigIsValidatedByStreams}
        />
      ),
      proceedAction: configurationProceedAction,
    },
    {
      title: "Streams",
      description: "Select data pipelines",
      render: (
        <SourceEditorFormStreams
          initialSourceData={initialSourceData}
          sourceDataFromCatalog={sourceDataFromCatalog}
          sourceConfigValidatedByStreamsTab={configIsValidatedByStreams}
          setSourceEditorState={setSourceEditorState}
          setControlsDisabled={setControlsDisabled}
          setConfigIsValidatedByStreams={setConfigIsValidatedByStreams}
          handleBringSourceData={handleBringSourceData}
        />
      ),
      proceedAction: handleGoToNextStep,
    },
    {
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
      <div className={cn("flex flex-col items-stretch flex-grow-0 flex-shrink h-full min-h-0")}>
        <div className="flex-shrink-0 flex-grow-0 mb-6">
          <Steps current={currentStep}>
            {steps.map(({ title, description }, idx) => (
              <Steps.Step
                key={title}
                title={title}
                description={description}
                icon={idx === currentStep && currentStepIsLoading ? <LoadingOutlined spin /> : undefined}
              />
            ))}
          </Steps>
        </div>

        <div className={cn("flex-grow flex-shrink min-h-0 overflow-y-auto pr-4")}>{steps[currentStep]?.render}</div>

        <div className="flex-shrink flex-grow-0 border-t py-2">
          <SourceEditorViewStepsControls
            proceedButton={{
              title: steps[currentStep].proceedButtonTitle ?? "Next",
              handleClick: steps[currentStep].proceedAction,
            }}
            handleCancel={handleLeaveEditor}
            handleStepBack={currentStep === 0 ? undefined : handleStepBack}
            controlsDisabled={controlsDisabled}
          />
        </div>
      </div>

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
