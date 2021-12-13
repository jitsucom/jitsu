import { InputWithCheckbox, InputWithCheckboxProps } from "../InputWithCheckbox/InputWithCheckbox"

type Props = {
  backendSecretAvailable: boolean
} & InputWithCheckboxProps

export const InputOauthSecret: React.FC<Props> = ({ backendSecretAvailable, ...props }) => {
  return (
    <InputWithCheckbox
      hideCheckbox={!backendSecretAvailable}
      checked={backendSecretAvailable ? undefined : false}
      checkboxTitle={`Use server-stored Jitsu App secret`}
      checkedFixedTitle={"Jitsu will use its own secret"}
      invertCheckBehaviour
      {...props}
    />
  )
}
