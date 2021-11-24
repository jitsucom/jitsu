// @Libs
import { Button } from "antd"
import { useEffect, useState } from "react"
// @Components
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { handleError } from "lib/components/components"
// @Services
import { OauthService } from "lib/services/oauth"
// @Icons
import { KeyOutlined } from "@ant-design/icons"
import { ReactComponent as GoogleLogo } from "icons/google.svg"

type Props = {
  service: string
  forceNotSupported?: boolean
  className?: string
  disabled?: boolean
  icon?: React.ReactNode
  isGoogle?: boolean
  setAuthSecrets: (data: any) => void
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
}) => {
  const [isOauthSupported, setIsOauthSupported] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  // const [oauthResult, setOauthResult] = useState<string | null>(null)

  const handleClick = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const oauthResult = await new OauthService().getCredentialsInSeparateWindow(service)
      if (oauthResult.status === "error") {
        actionNotification.error(oauthResult.errorMessage)
        // setOauthResult(`❌ ${oauthResult.errorMessage}`)
        return
      }
      if (oauthResult.status === "warning") {
        actionNotification.warn(oauthResult.message)
        // setOauthResult(`⚠️ ${oauthResult.message}`)
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
        {isGoogle ? <span className="align-top">{`Sign In With Google (OAuth Only)`}</span> : children}
      </Button>
    </div>
  )
}
