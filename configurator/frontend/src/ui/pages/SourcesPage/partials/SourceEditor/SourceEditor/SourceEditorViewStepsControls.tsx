// @Libs
import { Button } from "antd"
// @Types
import { SourceConnector } from "catalog/sources/types"
// @Icons
import { useState } from "react"
import { OauthButton } from "../../OauthButton/OauthButton"

interface ButtonProps {
  title?: string
  disabled?: boolean
  handleClick: () => Promise<unknown>
}

export interface Props {
  proceedButton?: ButtonProps
  sourceDataFromCatalog: SourceConnector
  controlsDisabled?: boolean
  setAuthSecrets?: (data: any) => void
  handleStepBack?: VoidFunction
  handleCancel?: VoidFunction
}

const SourceEditorViewStepsControls: React.FC<Props> = ({ proceedButton, sourceDataFromCatalog, controlsDisabled, setAuthSecrets, handleStepBack, handleCancel }) => {
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

      <OauthButton
        key="oauth-button"
        service={sourceDataFromCatalog.id}
        forceNotSupported={sourceDataFromCatalog.expertMode}
        className="mr-2"
        disabled={controlsDisabled}
        icon={<span className="h-6 w-8 pr-2">{sourceDataFromCatalog.pic}</span>}
        setAuthSecrets={setAuthSecrets ?? (() => {})}
      >
        <span className="align-top">{`Log In to ${sourceDataFromCatalog.displayName} to Fill in OAuth Credentials`}</span>
      </OauthButton>

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
