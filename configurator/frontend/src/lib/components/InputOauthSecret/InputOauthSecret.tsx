import { useMemo } from "react"
import { InputWithCheckbox, InputWithCheckboxProps } from "../InputWithCheckbox/InputWithCheckbox"

type Props = {
  status?: "loading" | "secrets_set" | "secrets_not_set"
} & InputWithCheckboxProps

export const InputOauthSecret: React.FC<Props> = ({ status, ...props }) => {
  const hideCheckbox = status !== "secrets_set"
  const message = useMemo<string>(() => {
    switch (status) {
      case "loading":
        return "Loading..."
      case "secrets_set":
        return "Jitsu will use its own secret"
      case "secrets_not_set":
      default:
        return "Internal Error. Please, use the support button or file an issue."
    }
  }, [status])

  return (
    <InputWithCheckbox
      hideCheckbox={hideCheckbox}
      checked={hideCheckbox ? false : undefined}
      checkboxTitle={`Use server-stored Jitsu App secret`}
      checkedFixedTitle={message}
      invertCheckBehaviour
      {...props}
    />
  )
}
