// @Libs
import { Button, Popover } from 'antd';
// @Components
import { PopoverTitle } from 'ui/components/Popover/PopoverTitle';
// @Icons
import { ApiOutlined } from '@ant-design/icons';
import { useState } from "react"

interface ButtonProps {
  title?: string
  disabled?: boolean
  showErrorsPopover?: boolean
  errorsPopoverTitle?: string
  handleClick: () => Promise<unknown>
  handlePopoverClose?: () => void
}

export interface Props {
  saveButton?: ButtonProps
  testConnectionButton?: ButtonProps
  handleCancel?: VoidFunction
}

const SourceEditorViewControls = ({ saveButton, testConnectionButton, handleCancel }: Props) => {
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
        <Popover
          content={null}
          title={<PopoverTitle title={saveButton.errorsPopoverTitle} handleClose={saveButton.handlePopoverClose} />}
          trigger="click"
          visible={saveButton.showErrorsPopover}>
          <Button
            type="primary"
            size="large"
            className="mr-3"
            htmlType="button"
            loading={isSaveLoading}
            onClick={handleSave}
            disabled={saveButton.disabled}>
            {saveButton.title ?? "Save"}
          </Button>
        </Popover>
      )}

      {testConnectionButton && (
        <Popover
          content={null}
          title={
            <PopoverTitle
              title={testConnectionButton.errorsPopoverTitle}
              handleClose={testConnectionButton.handlePopoverClose}
            />
          }
          trigger="click"
          visible={testConnectionButton.showErrorsPopover}>
          <Button
            size="large"
            className="mr-3"
            type="dashed"
            loading={isTestLoading}
            onClick={handleTest}
            icon={<ApiOutlined />}
            disabled={testConnectionButton.disabled}>
            {testConnectionButton.title ?? "Test connection"}
          </Button>
        </Popover>
      )}

      {handleCancel && (
        <Button type="default" size="large" onClick={handleCancel} danger>
          Cancel
        </Button>
      )}
    </>
  )
}

SourceEditorViewControls.displayName = 'SourceEditorViewControls';

export { SourceEditorViewControls };
