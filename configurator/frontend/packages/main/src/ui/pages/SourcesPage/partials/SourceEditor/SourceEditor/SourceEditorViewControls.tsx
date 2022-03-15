// @Libs
import { Button, Tooltip } from "antd"
// @Icons
import { useMemo, useState } from "react"

interface ButtonProps {
  title?: string
  hide?: boolean
  loading?: boolean
  handleClick: UnknownFunction | AsyncUnknownFunction
}

/**
 * Enables granular control of which buttons are disabled.
 * If string is passed, the disabled button will show a tooltip with the string.
 */
type SourceEditorStesControlsDisabledGranular = {
  mainButton?: boolean | string
  secondaryButton?: boolean | string
  dashedButton?: boolean | string
  dangerButton?: boolean | string
}

/**
 * Allows to disable each button or all of them at once.
 * Passing a primitive will disable all buttons except for the `Cancel` and `Back` buttons.
 * Passing an object allows to specify buttons to disable (with individual tooltips)
 * Passing a string will disable the button and display a tooltip with the string.
 * */
export type SourceEditorControlsDisabled = boolean | string | SourceEditorStesControlsDisabledGranular

export interface Props {
  mainButton?: ButtonProps
  secondaryButton?: ButtonProps
  dashedButton?: ButtonProps
  dangerButton?: ButtonProps
  controlsDisabled?: SourceEditorControlsDisabled
}

const SourceEditorViewControls: React.FC<Props> = ({
  mainButton,
  secondaryButton,
  dashedButton,
  dangerButton,
  controlsDisabled,
}) => {
  const controlsDisabledObject = useMemo<SourceEditorStesControlsDisabledGranular>(
    () =>
      typeof controlsDisabled === "object"
        ? controlsDisabled
        : { mainButton: controlsDisabled, dashedButton: controlsDisabled },
    [controlsDisabled]
  )

  return (
    <>
      {mainButton && (
        <Tooltip
          title={typeof controlsDisabledObject.mainButton === "string" ? controlsDisabledObject.mainButton : undefined}
        >
          <Button
            key="main-button"
            type="primary"
            size="large"
            className="mr-2"
            loading={mainButton.loading}
            onClick={mainButton.handleClick}
            disabled={!!controlsDisabledObject.mainButton}
          >
            {mainButton.title ?? "Save"}
          </Button>
        </Tooltip>
      )}

      {secondaryButton && !secondaryButton.hide && (
        <Tooltip
          title={
            typeof controlsDisabledObject.secondaryButton === "string"
              ? controlsDisabledObject.secondaryButton
              : undefined
          }
        >
          <Button
            key="default-button"
            type="default"
            size="large"
            className="mr-2"
            loading={secondaryButton.loading}
            disabled={!!controlsDisabledObject.secondaryButton}
            onClick={secondaryButton.handleClick}
          >
            Back
          </Button>
        </Tooltip>
      )}

      {dashedButton && !dashedButton.hide && (
        <Tooltip
          title={
            typeof controlsDisabledObject.dashedButton === "string" ? controlsDisabledObject.dashedButton : undefined
          }
        >
          <Button
            key="dashed-button"
            type="dashed"
            size="large"
            className="mr-2"
            loading={dashedButton.loading}
            disabled={!!controlsDisabledObject.dashedButton}
            onClick={dashedButton.handleClick}
          >
            {dashedButton.title}
          </Button>
        </Tooltip>
      )}

      {dangerButton && (
        <Tooltip
          title={
            typeof controlsDisabledObject.dangerButton === "string" ? controlsDisabledObject.dangerButton : undefined
          }
        >
          <Button
            key="danger-button"
            type="default"
            size="large"
            danger
            loading={dangerButton.loading}
            disabled={!!controlsDisabledObject.dangerButton}
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
