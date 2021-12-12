// @Libs
import { Button } from "antd"
import { useEffect, useState } from "react"
// @Components
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { handleError } from "lib/components/components"
// @Icons
import { KeyOutlined } from "@ant-design/icons"
import { ReactComponent as GoogleLogo } from "icons/google.svg"
import { useServices } from "hooks/useServices"

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
  isGoogle,
  children,
  setAuthSecrets,
  onIsOauthSuppotedStatusChecked,
}) => {
  const services = useServices()
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isOauthSupported, setIsOauthSupported] = useState<boolean>(false)

  const handleClick = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const oauthResult = await services.oauthService.getCredentialsInSeparateWindow(service)
      if (oauthResult.status === "error") {
        actionNotification.error(oauthResult.errorMessage)
        return
      }
      if (oauthResult.status === "warning") {
        actionNotification.warn(oauthResult.message)
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
      services.oauthService.checkIfOauthSupported(service).then(supported => {
        if (supported) {
          // only change state if oauth is supported
          setIsOauthSupported(supported)
        }
        onIsOauthSuppotedStatusChecked(supported)
      })
  }, [])

  return (
    <div className={`h-full w-full transiton-transform duration-300 transform ${isOauthSupported ? "" : "scale-105)"}`}>
      <Button
        type="default"
        loading={isLoading}
        className={`transition-opacity duration-700 ${className} ${isOauthSupported ? "" : "hidden opacity-0"}`}
        disabled={disabled}
        icon={
          isGoogle ? (
            <span className="h-5 w-5 mr-2">
              <GoogleLogo />
            </span>
          ) : (
            icon ?? <KeyOutlined />
          )
        }
        onClick={handleClick}
      >
        {isGoogle ? <span className="align-top">{`Sign In With Google`}</span> : children}
      </Button>
    </div>
  )
}
