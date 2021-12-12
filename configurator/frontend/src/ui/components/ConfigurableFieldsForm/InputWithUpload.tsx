import React from "react"
import { Button, Input, Upload } from "antd"
import { UploadOutlined } from "@ant-design/icons"

interface InputWithUploadProps {
  value?: string

  onChange?: (value: string) => void
}

const InputWithUpload: React.FC<InputWithUploadProps> = ({ value, onChange }) => {
  const triggerChange = e => {
    onChange?.(e.target.value)
  }

  const beforeUpload = file => {
    const reader = new FileReader()

    reader.onload = e => {
      const content: string = e.target.result as string
      onChange?.(content)
    }
    reader.readAsText(file)

    // Prevent upload
    return false
  }

  return value === "" ? (
    <Upload showUploadList={true} beforeUpload={beforeUpload}>
      <Button icon={<UploadOutlined />}>Click to Upload</Button>
    </Upload>
  ) : (
    <Input.TextArea autoSize={{ minRows: 1, maxRows: 5 }} value={value} autoComplete="off" onChange={triggerChange} />
  )
}

export { InputWithUpload }
