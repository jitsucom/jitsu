import React, { useState } from "react"
import { Form, Input, Select, Button, Tooltip } from "antd"
import BugIcon from "../../../icons/bug"
import styles from "./ConfigurableFieldsForm.module.less"

interface InputWithDebugProps {
  id: string
  jsDebugger?: "object" | "string" | null
  value?: string
  placeholder?: string
  onChange?: (value: string) => void
  onButtonClick?: () => void
}

const InputWithDebug: React.FC<InputWithDebugProps> = ({
  id,
  placeholder,
  jsDebugger,
  value,
  onChange,
  onButtonClick,
}) => {
  const [text, setText] = useState(value)

  const triggerChange = (changedValue: string) => {
    onChange?.(changedValue)
  }

  const onValueChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    triggerChange(e.target.value)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (text?.length == 0 && (e.key == "Backspace" || e.key == "Delete")) {
      setText(undefined)
      triggerChange(undefined)
    }
  }

  return (
    <>
      <Input.TextArea
        autoSize={{ minRows: 1, maxRows: 5 }}
        value={value || text}
        autoComplete="off"
        placeholder={placeholder || typeof text === "undefined" ? "Not set" : undefined}
        onChange={onValueChange}
        onKeyDown={onKeyDown}
      />
      <span className="z-50 absolute top-1.5 right-3">
        {jsDebugger && (
          <Tooltip title="Debug expression">
            <span onClick={onButtonClick}>
              <BugIcon className={styles.bugIcon} />
            </span>
          </Tooltip>
        )}
      </span>
    </>
  )
}

export { InputWithDebug }
