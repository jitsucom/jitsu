// @Libs
import { Button, Popover } from 'antd';
// @Components
import { PopoverTitle } from 'ui/components/Popover/PopoverTitle';
// @Icons
import { ApiOutlined } from '@ant-design/icons';

interface ButtonProps {
  title?: string;
  disabled?: boolean;
  loading?: boolean;
  showErrorsPopover?: boolean;
  errorsPopoverTitle?: string;
  handleClick: () => void;
  handlePopoverClose?: () => void;
}

export interface Props {
  saveButton?: ButtonProps;
  testConnectionButton?: ButtonProps;
  handleCancel?: VoidFunction;
}

const SourceEditorViewControls = ({
  saveButton,
  testConnectionButton,
  handleCancel
}: Props) => {
  return (
    <>
      {saveButton && (
        <Popover
          content={null}
          title={
            <PopoverTitle
              title={saveButton.errorsPopoverTitle}
              handleClose={saveButton.handlePopoverClose}
            />
          }
          trigger="click"
          visible={saveButton.showErrorsPopover}
        >
          <Button
            type="primary"
            size="large"
            className="mr-3"
            htmlType="button"
            loading={saveButton.loading}
            onClick={saveButton.handleClick}
            disabled={saveButton.disabled}
          >
            {saveButton.title ?? 'Save'}
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
          visible={testConnectionButton.showErrorsPopover}
        >
          <Button
            size="large"
            className="mr-3"
            type="dashed"
            loading={testConnectionButton.loading}
            onClick={testConnectionButton.handleClick}
            icon={<ApiOutlined />}
            disabled={testConnectionButton.disabled}
          >
            {testConnectionButton.title ?? 'Test connection'}
          </Button>
        </Popover>
      )}

      {handleCancel && (
        <Button type="default" size="large" onClick={handleCancel} danger>
          Cancel
        </Button>
      )}
    </>
  );
};

SourceEditorViewControls.displayName = 'SourceEditorViewControls';

export { SourceEditorViewControls };
