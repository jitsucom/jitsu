import React, { useState } from "react"
import { Checkbox, Input, InputProps as AntdInputProps } from "antd"
import { CheckboxChangeEvent } from "antd/lib/checkbox"
import styles from "./InputWithCheckbox.module.less"

export type InputWithCheckboxProps = AntdInputProps & {
  /**
   * Allows to implement a controlled component
   * */
  checked?: boolean
  /** Default value */
  defaultChecked?: boolean
  /** Title of the checkbox */
  checkboxTitle?: string
  /**
   * Text will be show instead of input when the checkbox is not checked.
   * If not set, nothing will be displayed.
   *
   * Works only if `invertCheckBehaviour` is `false` (default)
   */
  uncheckedFixedTitle?: string
  /**
   * Text will be show instead of input when the checkbox is checked.
   * If not set, nothing will be displayed.
   *
   * Works only if `invertCheckBehaviour` is `true`
   */
  checkedFixedTitle?: string
  /**
   * Show input when the checkbox is not checked, hide it when it is checked
   * @default false
   * */
  invertCheckBehaviour?: boolean
  /**
   * Allows to wrap Input into another element.
   * This primarily enables to use Input as a form item
   * */
  inputWrapper?: React.FC
  /**  */
  onCheckboxChange?: (e: CheckboxChangeEvent) => void
  onInputChange?: React.ChangeEventHandler<HTMLInputElement>
}

export const InputWithCheckbox: React.FC<InputWithCheckboxProps> = ({
  checked: controlledShowInputChecked,
  defaultChecked,
  checkboxTitle,
  checkedFixedTitle,
  uncheckedFixedTitle,
  invertCheckBehaviour = false,
  inputWrapper,
  children,
  onCheckboxChange,
  onInputChange,
  ...inputProps
}) => {
  const isControlled = controlledShowInputChecked ?? false
  const [showInput, setShowInput] = useState<boolean>(defaultChecked ?? false)

  const needShowInput = controlledShowInputChecked ?? showInput
  const _showInput = invertCheckBehaviour ? !needShowInput : needShowInput

  const InputWrapper: React.FC = inputWrapper ?? (({ children }) => <>{children}</>)

  const handleCheck = (event: CheckboxChangeEvent) => {
    controlledShowInputChecked ?? setShowInput(event.target.checked)
  }

  return (
    <div className="flex flex-col items-stretch w-full">
      <Checkbox
        checked={controlledShowInputChecked ?? showInput}
        className={`mt-1 mb-1 ${styles.checkbox}`}
        onChange={onCheckboxChange ?? handleCheck}
      >
        {checkboxTitle && <span>{checkboxTitle}</span>}
      </Checkbox>
      {_showInput ? (
        <InputWrapper>
          <Input className={`pr`} {...inputProps} onChange={onInputChange} />
        </InputWrapper>
      ) : (
        <span
          className={`${styles.staticTitle}`}
          title={invertCheckBehaviour ? checkedFixedTitle : uncheckedFixedTitle}
        >
          {invertCheckBehaviour ? checkedFixedTitle : uncheckedFixedTitle}
        </span>
      )}
    </div>
  )
}
