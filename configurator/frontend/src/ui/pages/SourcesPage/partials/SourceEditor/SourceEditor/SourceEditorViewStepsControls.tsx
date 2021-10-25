// @Libs
import { Button } from "antd"
// @Icons
import { useState } from "react"

interface ButtonProps {
  title?: string
  disabled?: boolean
  handleClick: () => Promise<unknown>
}

export interface Props {
  proceedButton?: ButtonProps
  handleStepBack?: VoidFunction
  handleCancel?: VoidFunction
  controlsDisabled?: boolean
}

const SourceEditorViewStepsControls = ({ proceedButton, handleStepBack, handleCancel, controlsDisabled }: Props) => {
  const [isProceedLoading, setIsProceedLoading] = useState<boolean>(false)

  const handleProceed = async () => {
    setIsProceedLoading(true)
    try {
      await proceedButton.handleClick()
    } finally {
      setIsProceedLoading(false)
    }
  }

  return (
    <>
      {proceedButton && (
        <Button
          type="primary"
          size="large"
          className="mr-2"
          htmlType="button"
          loading={isProceedLoading}
          onClick={handleProceed}
          disabled={controlsDisabled}>
          {proceedButton.title ?? "Save"}
        </Button>
      )}

      {handleStepBack && (
        <Button type="default" size="large" className="mr-2" onClick={handleStepBack}>
          Back
        </Button>
      )}

      {handleCancel && (
        <Button type="default" size="large" onClick={handleCancel} danger>
          Cancel
        </Button>
      )}
    </>
  )
}

SourceEditorViewStepsControls.displayName = "SourceEditorViewStepsControls"

export { SourceEditorViewStepsControls }
