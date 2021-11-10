// @Libs
import { Button } from "antd"
// @Icons
import { KeyOutlined } from "@ant-design/icons"
import { useEffect, useState } from "react"
import { OauthService } from "lib/services/oauth"

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
  const [oauthError, setOauthError] = useState<string>("")

  const handleClick = async () => {
    setOauthError("")
    setIsLoading(true)
    try {
      const oauthResult = await new OauthService().getCredentialsInSeparateWindow(service)
      if (oauthResult.status === "error") {
        throw new Error(oauthResult.errorMessage)
      }
      setAuthSecrets(oauthResult.secrets)
    } catch (error) {
      setOauthError(error.message ?? "Oauth failed due to internal error. Please, file an issue.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    !forceNotSupported &&
      new OauthService().checkIfOauthSupported(service).then(result => result && setIsOauthSupported(result)) // only change state if oauth is supported
  }, [])

  return (
    <div className={`transition-all duration-700 ${isOauthSupported ? "max-w-full" : "max-w-0"}`}>
      <Button
        type="default"
        size="large"
        loading={isLoading}
        danger={!!oauthError}
        className={`transiton all duration-1000 ${className} ${
          isOauthSupported ? "opacity-100" : "opacity-0 transform-gpu scale-125)"
        }`}
        disabled={disabled}
        icon={icon ?? <KeyOutlined />}
        onClick={handleClick}
      >
        {children}
      </Button>
    </div>
  )
}
