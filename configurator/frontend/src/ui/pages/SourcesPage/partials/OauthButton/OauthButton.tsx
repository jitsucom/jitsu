// @Libs
import { Button } from "antd"
// @Icons
import { KeyOutlined } from "@ant-design/icons"
import { useEffect, useState } from "react"
import { OauthService } from "lib/services/oauth"

type Props = {
  service: string
  className?: string
  disabled?: boolean
  icon?: React.ReactNode
  setAuthSecrets: (data: any) => void
}

export const OauthButton: React.FC<Props> = ({ service, className, disabled, icon, children, setAuthSecrets }) => {
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
    new OauthService().checkIfOauthSupported(service).then(result => result && setIsOauthSupported(result)) // only change state if oauth supported
  }, [])

  return isOauthSupported ? (
    <Button
      type="default"
      size="large"
      loading={isLoading}
      danger={!!oauthError}
      className={className}
      disabled={disabled}
      icon={icon ?? <KeyOutlined />}
      onClick={handleClick}
    >
      {children}
    </Button>
  ) : null
}
