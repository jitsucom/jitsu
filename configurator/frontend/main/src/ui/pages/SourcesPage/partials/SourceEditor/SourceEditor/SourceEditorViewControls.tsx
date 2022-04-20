// @Libs
import { Button, Tooltip } from "antd"
// @Icons
import { useMemo, useState } from "react"
import { useSourceEditorState } from "./SourceEditor.state"

interface ButtonProps {
  title?: string
  hide?: boolean
  loading?: boolean
  handleClick: UnknownFunction | AsyncUnknownFunction
}

/**
 * Enables granular control of which buttons are disabled.
 * If string is passed, the disabled button will show a tooltip.
 */
type ControlsDisabled = {
  mainButton?: boolean | string
  secondaryButton?: boolean | string
  dashedButton?: boolean | string
  dangerButton?: boolean | string
}

export interface Props {
  mainButton?: ButtonProps
  secondaryButton?: ButtonProps
  dashedButton?: ButtonProps
  dangerButton?: ButtonProps
}

const SourceEditorViewControls: React.FC<Props> = ({ mainButton, secondaryButton, dashedButton, dangerButton }) => {
  const sourceEditorViewState = useSourceEditorState()

  /** @see {@link ControlsDisabled} type description */
  const controlsDisabled = useMemo<ControlsDisabled>(() => {
    const result: ControlsDisabled = {
      mainButton: false,
      secondaryButton: false,
      dashedButton: false,
      dangerButton: false,
    }
    if (sourceEditorViewState.status.isLoadingOauthStatus) {
      result.mainButton = result.secondaryButton = result.dashedButton = true
    }
    if (sourceEditorViewState.status.isTestingConnection) {
      result.mainButton = result.secondaryButton = result.dashedButton = "Validating source configuration"
    }
    if (!sourceEditorViewState.status.isOauthFlowCompleted) {
      result.mainButton =
        result.secondaryButton =
        result.dashedButton =
          "Please, either grant Jitsu access or fill auth credentials manually"
    }
    if (sourceEditorViewState.status.isLoadingConfig) {
      result.mainButton = result.secondaryButton = result.dashedButton = "Loading source configuration"
    }
    if (sourceEditorViewState.status.isLoadingStreams) {
      result.mainButton = result.secondaryButton = result.dashedButton = "Loading the list of streams"
    }
    return result
  }, [sourceEditorViewState.status])

  return (
    <>
      {mainButton && (
        <Tooltip title={typeof controlsDisabled.mainButton === "string" ? controlsDisabled.mainButton : undefined}>
          <Button
            key="main-button"
            type="primary"
            size="large"
            className="mr-2"
            loading={mainButton.loading}
            onClick={mainButton.handleClick}
            disabled={!!controlsDisabled.mainButton}
          >
            {mainButton.title ?? "Save"}
          </Button>
        </Tooltip>
      )}

      {secondaryButton && !secondaryButton.hide && (
        <Tooltip
          title={typeof controlsDisabled.secondaryButton === "string" ? controlsDisabled.secondaryButton : undefined}
        >
          <Button
            key="default-button"
            type="default"
            size="large"
            className="mr-2"
            loading={secondaryButton.loading}
            disabled={!!controlsDisabled.secondaryButton}
            onClick={secondaryButton.handleClick}
          >
            Back
          </Button>
        </Tooltip>
      )}

      {dashedButton && !dashedButton.hide && (
        <Tooltip title={typeof controlsDisabled.dashedButton === "string" ? controlsDisabled.dashedButton : undefined}>
          <Button
            key="dashed-button"
            type="dashed"
            size="large"
            className="mr-2"
            loading={dashedButton.loading}
            disabled={!!controlsDisabled.dashedButton}
            onClick={dashedButton.handleClick}
          >
            {dashedButton.title}
          </Button>
        </Tooltip>
      )}

      {dangerButton && (
        <Tooltip title={typeof controlsDisabled.dangerButton === "string" ? controlsDisabled.dangerButton : undefined}>
          <Button
            key="danger-button"
            type="default"
            size="large"
            danger
            loading={dangerButton.loading}
            disabled={!!controlsDisabled.dangerButton}
            onClick={dangerButton.handleClick}
          >
            Cancel
          </Button>
        </Tooltip>
      )}
    </>
  )
}

SourceEditorViewControls.displayName = "SourceEditorViewControls"

export { SourceEditorViewControls }
