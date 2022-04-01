import React, { useState } from "react"
import { Form, Input, Select, Button, Tooltip, Switch } from "antd"
import BugIcon from "../../../icons/bug"
import styles from "./ConfigurableFieldsForm.module.less"
import { Html5TwoTone } from "@ant-design/icons"

interface SwitchWithLabelProps {
  id: string
  defaultChecked?: boolean
  onChange?: (value: boolean) => void
  label?: string
}

const SwitchWithLabel: React.FC<SwitchWithLabelProps> = ({ id, defaultChecked, onChange, label }) => {
  const [state, setState] = useState(defaultChecked)

  const triggerChange = (changedValue: boolean) => {
    onChange?.(changedValue)
  }

  const onValueChange = (value: boolean, e: MouseEvent) => {
    setState(value)
    triggerChange(value)
  }

  return (
    <div>
      <Switch className={"mb-0.5"} onChange={onValueChange} checked={state} defaultChecked={!!defaultChecked} />
      {label && <span className={"pl-3"}>{label}</span>}
    </div>
  )
}

export { SwitchWithLabel }
