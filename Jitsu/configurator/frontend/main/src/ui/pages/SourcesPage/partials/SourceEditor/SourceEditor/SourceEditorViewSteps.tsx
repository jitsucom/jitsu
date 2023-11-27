import cn from "classnames"
import { useState } from "react"
import { Steps } from "antd"
import { SourceEditorViewControls } from "./SourceEditorViewControls"
import { LoadingOutlined } from "@ant-design/icons"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { SetSourceEditorInitialSourceData } from "./SourceEditor"

type Step = {
  key: string
  title: string
  description: string
  render: React.ReactNode
  proceedButtonTitle?: string
  proceedAction?: AsyncUnknownFunction
}

type SourceEditorTabsViewProps = {
  steps: Step[]
  handleBringSourceData: () => SourceData
  setInitialSourceData: SetSourceEditorInitialSourceData
  handleLeaveEditor: VoidFunction
}

export const SourceEditorViewSteps: React.FC<SourceEditorTabsViewProps> = ({
  steps,
  handleBringSourceData,
  setInitialSourceData,
  handleLeaveEditor,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [currentStepIsLoading, setCurrentStepIsLoading] = useState<boolean>(false)

  const proceedButtonTitle = steps[currentStep].proceedButtonTitle ?? "Next"

  const handleCompleteStep = () => {
    setInitialSourceData(handleBringSourceData())
  }

  const handleGoToNextStep: AsyncUnknownFunction = async () => {
    handleCompleteStep()
    setCurrentStepIsLoading(true)
    try {
      await steps[currentStep].proceedAction?.()
      setCurrentStep(step => step + 1)
    } catch (error) {
      actionNotification.error(`${error}`)
    } finally {
      setCurrentStepIsLoading(false)
    }
  }

  const handleStepBack: AsyncUnknownFunction = async () => {
    handleCompleteStep()
    setCurrentStep(step => step - 1)
  }

  return (
    <>
      <div className={cn("flex flex-col items-stretch flex-grow-0 flex-shrink h-full min-h-0")}>
        <div className="flex-shrink-0 flex-grow-0 mb-4">
          <Steps current={currentStep}>
            {steps.map(({ key, title, description }, idx) => (
              <Steps.Step
                key={key}
                title={title}
                description={description}
                icon={idx === currentStep && currentStepIsLoading ? <LoadingOutlined spin /> : undefined}
              />
            ))}
          </Steps>
        </div>

        <div className={cn("flex-grow flex-shrink min-h-0 overflow-y-auto pr-4")}>
          <fieldset disabled={currentStepIsLoading}>{steps[currentStep]?.render}</fieldset>
        </div>

        <div className="flex items-center flex-shrink flex-grow-0 border-t py-2">
          <SourceEditorViewControls
            mainButton={{
              title: proceedButtonTitle,
              loading: currentStepIsLoading,
              handleClick: handleGoToNextStep,
            }}
            secondaryButton={{
              title: "Back",
              hide: currentStep === 0,
              handleClick: handleStepBack,
            }}
            dangerButton={{
              title: "Cancel",
              handleClick: handleLeaveEditor,
            }}
          />
        </div>
      </div>
    </>
  )
}
