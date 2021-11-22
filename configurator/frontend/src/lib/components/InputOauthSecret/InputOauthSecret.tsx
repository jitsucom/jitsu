import { useMemo } from "react"
import { InputWithCheckbox, InputWithCheckboxProps } from "../InputWithCheckbox/InputWithCheckbox"

type Props = {
  status?: "loading" | "secrets_set" | "secrets_not_set"
} & InputWithCheckboxProps

export const InputOauthSecret: React.FC<Props> = ({ status, ...props }) => {
  const message = useMemo<string>(() => {
    switch (status) {
      case "loading":
        return "Loading..."
      case "secrets_set":
        return "Jitsu will use the value stored on backend"
      case "secrets_not_set":
        return "Value not found. Please, use One-click auth button to authorize Jitsu to get the value for you."
      default:
        return "Internal Error. Please, use the support button or file an issue."
    }
  }, [status])

  return (
    <InputWithCheckbox
      checkboxTitle={`Use server-stored secret`}
      checkedFixedTitle={message}
      invertCheckBehaviour
      {...props}
    />
  )
}
