import { memo, useState } from "react"
import { Switch } from "antd"

type Props = {
  isTelemetryEnabled: boolean
  className?: string
  handleChangeTelemetry: (enabled: boolean) => Promise<void>
}

const TelemetrySettingsFormComponent: React.FC<Props> = ({
  isTelemetryEnabled,
  handleChangeTelemetry: _handleChangeTelemetry,
}) => {
  const [isChangeTelemetryInProgress, setIsChangeTelemetryInProgress] = useState<boolean>(false)
  const handleChangeTelemetry = async (enabled: boolean) => {
    setIsChangeTelemetryInProgress(true)
    try {
      await _handleChangeTelemetry(enabled)
    } finally {
      setIsChangeTelemetryInProgress(false)
    }
  }

  return (
    <span className="flex items-center">
      <Switch
        size="small"
        loading={isChangeTelemetryInProgress}
        checked={isTelemetryEnabled}
        onChange={handleChangeTelemetry}
      />
      <span className="ml-2">
        {"Allow us to track the application state in order to detect and respond to any issues."}
      </span>
    </span>
  )
}

export const TelemetrySettingsForm = memo(TelemetrySettingsFormComponent)
