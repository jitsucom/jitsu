// @Libs
import { Button } from "antd"
// @Icons
import { KeyOutlined } from "@ant-design/icons"
import { useEffect, useState } from "react"
import { OauthService } from "lib/services/oauth"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { handleError } from "lib/components/components"

type Props = {
  service: string
  forceNotSupported?: boolean
  className?: string
  disabled?: boolean
  icon?: React.ReactNode
  setAuthSecrets: (data: any) => void
}

export const OauthButton: React.FC<Props> = ({
  service,
  forceNotSupported,
  className,
  disabled,
  icon,
  children,
  setAuthSecrets,
}) => {
  const [isOauthSupported, setIsOauthSupported] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const handleClick = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const oauthResult = await new OauthService().getCredentialsInSeparateWindow(service)
      if (oauthResult.status === "error") {
        actionNotification.error(oauthResult.errorMessage)
        return
      }
      setAuthSecrets(oauthResult.secrets)
    } catch (error) {
      handleError(new Error(error.message ?? "Oauth failed due to internal error. Please, file an issue."))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    !forceNotSupported &&
      new OauthService().checkIfOauthSupported(service).then(result => result && setIsOauthSupported(result)) // only change state if oauth is supported
  }, [])

  return (
    <div className={`h-full w-full transiton-transform duration-700 transform ${isOauthSupported ? "" : "scale-105)"}`}>
      <Button
        type="default"
        loading={isLoading}
        className={`transition-opacity duration-700 ${className} ${isOauthSupported ? "" : "opacity-0"}`}
        disabled={disabled}
        icon={icon ?? <KeyOutlined />}
        onClick={handleClick}
      >
        {children}
      </Button>
    </div>
  )
}
