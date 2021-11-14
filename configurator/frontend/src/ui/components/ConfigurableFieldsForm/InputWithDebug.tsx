import React, { useState } from "react"
import { Form, Input, Select, Button, Tooltip } from "antd"
import BugIcon from "../../../icons/bug"
import styles from "./ConfigurableFieldsForm.module.less"

interface InputWithDebugProps {
  id: string
  jsDebugger?: "object" | "string" | null
  value?: string
  onChange?: (value: string) => void
  onButtonClick?: () => void
}

const InputWithDebug: React.FC<InputWithDebugProps> = ({ id, jsDebugger, value = "", onChange, onButtonClick }) => {
  const [text, setText] = useState(value || "")

  const triggerChange = (changedValue: string) => {
    onChange?.(changedValue)
  }

  const onValueChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    triggerChange(e.target.value)
  }

  return (
    <>
      <Input.TextArea
        autoSize={{ minRows: 1, maxRows: 5 }}
        value={value || text}
        autoComplete="off"
        onChange={onValueChange}
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
