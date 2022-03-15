import * as React from "react"
import { Simulate } from "react-dom/test-utils"
import { useState } from "react"
import { Button, Col, Input, Row } from "antd"
import MinusOutlined from "@ant-design/icons/lib/icons/MinusOutlined"
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined"
import { Align } from "../components"
import "./EditableList.less"

type ListValue = string[]

type ItemState = { value: string; error: string | null }[]

const emptyValidator = str => {
  return null
}

export type EditableListProps = {
  initialValue?: ListValue
  onChange?: (val: ListValue) => void
  newItemLabel?: string
  validator?: (string) => string
}

export function EditableList({
  initialValue = [],
  onChange,
  newItemLabel = "New Item",
  validator = emptyValidator,
}: EditableListProps) {
  if (typeof initialValue === "string") {
    initialValue = []
  }
  const initialItems = initialValue.map(str => {
    return {
      value: str,
      error: validator(str),
    }
  })
  const [items, setItems] = useState(initialItems)

  const triggerChange = changedValue => {
    if (onChange) {
      onChange(changedValue.map(item => item.value))
    }
  }

  const changeVal = (index, newVal) => {
    let newItems = [...items]
    newItems[index].value = newVal
    newItems[index].error = validator(newVal)
    triggerChange(newItems)
    setItems(newItems)
  }

  const addItem = () => {
    let newItems = [...items, { value: "", error: validator("") }]
    triggerChange(newItems)
    setItems(newItems)
  }

  const removeItem = index => {
    let newItems = [...items]
    newItems.splice(index, 1)
    triggerChange(newItems)
    setItems(newItems)
  }

  return (
    <div className="editable-list">
      {items.map((item, index) => {
        return (
          <Row key={index}>
            <Col span={22}>
              <Input value={item.value} onChange={e => changeVal(index, e.target.value)} />
              <div className="editable-list-validation-error">{item.error ? item.error : " "}</div>
            </Col>
            <Col span={2}>
              <Align horizontal="right">
                <Button icon={<MinusOutlined />} onClick={() => removeItem(index)} />
              </Align>
            </Col>
          </Row>
        )
      })}
      <Row key="add">
        <Col span={24}>
          <Align horizontal="right">
            <Button className="editable-list-new-item" type="ghost" onClick={() => addItem()} icon={<PlusOutlined />} />
          </Align>
        </Col>
      </Row>
    </div>
  )
}
