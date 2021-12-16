// @Libs
import { Button, Tooltip } from "antd"
// @Icons
import { useMemo, useState } from "react"

interface ButtonProps {
  title?: string
  handleClick: () => Promise<unknown>
}

/**
 * Enables granular control of which buttons are disabled.
 * If string is passed, the disabled button will show a tooltip with the string.
 */
type SourceEditorStepsControlsDisabledGranular = {
  proceedButton?: boolean | string
  backButton?: boolean | string
  cancelButton?: boolean | string
}

/**
 * Allows to disable each button or all of them at once.
 * Passing a primitive will disable all buttons except for the `Cancel` and `Back` buttons.
 * Passing an object allows to specify buttons to disable (with individual tooltips)
 * Passing a string will disable the button and display a tooltip with the string.
 * */
export type SourceEditorStepsControlsDisabled = boolean | string | SourceEditorStepsControlsDisabledGranular

export interface Props {
  proceedButton?: ButtonProps
  controlsDisabled?: SourceEditorStepsControlsDisabled
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

  const controlsDisabledObject = useMemo<SourceEditorStepsControlsDisabledGranular>(
    () => (typeof controlsDisabled === "object" ? controlsDisabled : { proceedButton: controlsDisabled }),
    [controlsDisabled]
  )

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
        <Tooltip
          title={
            typeof controlsDisabledObject.proceedButton === "string" ? controlsDisabledObject.proceedButton : undefined
          }
        >
          <Button
            key="proceed-button"
            type="primary"
            size="large"
            className="mr-2"
            htmlType="button"
            loading={isProceedLoading}
            onClick={handleProceed}
            disabled={!!controlsDisabledObject.proceedButton}
          >
            {proceedButton.title ?? "Save"}
          </Button>
        </Tooltip>
      )}

      {handleStepBack && (
        <Tooltip
          title={typeof controlsDisabledObject.backButton === "string" ? controlsDisabledObject.backButton : undefined}
        >
          <Button
            key="back-button"
            type="default"
            size="large"
            className="mr-2"
            disabled={!!controlsDisabledObject.backButton}
            onClick={handleStepBack}
          >
            Back
          </Button>
        </Tooltip>
      )}

      {handleCancel && (
        <Tooltip
          title={
            typeof controlsDisabledObject.cancelButton === "string" ? controlsDisabledObject.cancelButton : undefined
          }
        >
          <Button
            key="cancel-button"
            type="default"
            size="large"
            danger
            disabled={!!controlsDisabledObject.cancelButton}
            onClick={handleCancel}
          >
            Cancel
          </Button>
        </Tooltip>
      )}
    </>
  )
}

SourceEditorViewStepsControls.displayName = "SourceEditorViewStepsControls"

export { SourceEditorViewStepsControls }
