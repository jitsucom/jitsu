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
  hideOauthButton?: boolean
  controlsDisabled?: boolean
  handleStepBack?: VoidFunction
  handleCancel?: VoidFunction
}

const SourceEditorViewStepsControls: React.FC<Props> = ({
  proceedButton,
  controlsDisabled,
  handleStepBack,
  handleCancel,
}) => {
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
          key="proceed-button"
          type="primary"
          size="large"
          className="mr-2"
          htmlType="button"
          loading={isProceedLoading}
          onClick={handleProceed}
          disabled={controlsDisabled}
        >
          {proceedButton.title ?? "Save"}
        </Button>
      )}

      {handleStepBack && (
        <Button key="back-button" type="default" size="large" className="mr-2" onClick={handleStepBack}>
          Back
        </Button>
      )}

      {handleCancel && (
        <Button key="cancel-button" type="default" size="large" onClick={handleCancel} danger>
          Cancel
        </Button>
      )}
    </>
  )
}

SourceEditorViewStepsControls.displayName = "SourceEditorViewStepsControls"

export { SourceEditorViewStepsControls }
