// @Libs
import { Button } from "antd"
import { useEffect, useState } from "react"
// @Components
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { handleError } from "lib/components/components"
// @Icons
import { KeyOutlined } from "@ant-design/icons"
import { useServices } from "hooks/useServices"
import { GoogleSignInButton } from "lib/components/GoogleSignInButton/GoogleSignInButton"

type Props = {
  service: string
  forceNotSupported?: boolean
  className?: string
  disabled?: boolean
  icon?: React.ReactNode
  isGoogle?: boolean
  setAuthSecrets: (data: any) => void
  onIsOauthSuppotedStatusChecked?: (isSupported: boolean) => void
}

export const OauthButton: React.FC<Props> = ({
  service,
  forceNotSupported,
  className,
  disabled,
  icon,
  children,
  setAuthSecrets,
  onIsOauthSuppotedStatusChecked,
}) => {
  const services = useServices()
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isOauthSupported, setIsOauthSupported] = useState<boolean>(false)
  const [isOauthCompleted, setIsOauthCompleted] = useState<boolean>(false)

  const handleClick = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const oauthResult = await services.oauthService.getCredentialsInSeparateWindow(service)
      if (oauthResult.status === "error") {
        actionNotification.error(
          oauthResult.message ??
            oauthResult.errorMessage ??
            "OAuth failed due to internal error. Please, file an issue."
        )
        return
      }
      if (oauthResult.status === "warning") {
        actionNotification.warn(oauthResult.message)
        return
      }
      setAuthSecrets(oauthResult.secrets)
      setIsOauthCompleted(true)
    } catch (error) {
      handleError(new Error(error.message ?? "OAuth failed due to internal error. Please, file an issue."))
      setIsOauthCompleted(false)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (forceNotSupported) {
      onIsOauthSuppotedStatusChecked(false)
      return
    }
    services.oauthService.checkIfOauthSupported(service).then(supported => {
      supported && setIsOauthSupported(supported)
      onIsOauthSuppotedStatusChecked(supported)
    })
  }, [])

  return (
    <div className={`transiton-transform duration-300 transform ${isOauthSupported ? "" : "scale-105)"}`}>
      <div className={`transition-opacity duration-700 ${className} ${isOauthSupported ? "" : "hidden opacity-0"}`}>
        <Button
          type="default"
          loading={isLoading}
          disabled={disabled}
          icon={icon ?? <KeyOutlined />}
          onClick={handleClick}
        >
          {children}
        </Button>
      </div>
    </div>
  )
}
