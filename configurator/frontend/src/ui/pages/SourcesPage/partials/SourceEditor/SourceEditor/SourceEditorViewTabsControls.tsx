// @Libs
import { Button } from "antd"
// @Icons
import { ApiOutlined } from "@ant-design/icons"
import { useState } from "react"

interface ButtonProps {
  title?: string
  disabled?: boolean
  handleClick: () => Promise<unknown>
}

export interface Props {
  saveButton?: ButtonProps
  testConnectionButton?: ButtonProps
  handleCancel?: VoidFunction
  controlsDisabled?: boolean
}

const SourceEditorViewTabsControls = ({ saveButton, testConnectionButton, handleCancel, controlsDisabled }: Props) => {
  const [isSaveLoading, setIsSaveLoading] = useState<boolean>(false)
  const [isTestLoading, setIsTestLoading] = useState<boolean>(false)

  const handleSave = async () => {
    setIsSaveLoading(true)
    try {
      await saveButton.handleClick()
    } finally {
      setIsSaveLoading(false)
    }
  }

  const handleTest = async () => {
    setIsTestLoading(true)
    try {
      await testConnectionButton.handleClick()
    } finally {
      setIsTestLoading(false)
    }
  }

  return (
    <>
      {saveButton && (
        <Button
          type="primary"
          size="large"
          className="mr-3"
          htmlType="button"
          loading={isSaveLoading}
          onClick={handleSave}
          disabled={controlsDisabled || saveButton.disabled}
        >
          {saveButton.title ?? "Save"}
        </Button>
      )}

      {testConnectionButton && (
        <Button
          size="large"
          className="mr-3"
          type="dashed"
          loading={isTestLoading}
          onClick={handleTest}
          icon={<ApiOutlined />}
          disabled={controlsDisabled || testConnectionButton.disabled}
        >
          {testConnectionButton.title ?? "Test connection"}
        </Button>
      )}

      {handleCancel && (
        <Button type="default" size="large" onClick={handleCancel} danger>
          Cancel
        </Button>
      )}
    </>
  )
}

SourceEditorViewTabsControls.displayName = "SourceEditorViewTabsControls"

export { SourceEditorViewTabsControls }
