// @Libs
import React from 'react';
import { Button, Popover } from 'antd';
// @Components
import { PopoverTitle } from 'ui/components/Popover/PopoverTitle';
// @Icons
import { ApiOutlined } from '@ant-design/icons';

interface ButtonProps {
  isPopoverVisible: boolean;
  isRequestPending: boolean;
  handlePress: () => void;
  handlePopoverClose: () => void;
  titleText: string;
  disabled?: boolean;
}

export interface Props {
  saveButton: ButtonProps;
  testConnectionButton: ButtonProps;
  handleCancel: VoidFunction;
}

type SourceEditorControlsViewProps = {};

export const SourceEditorControlsView: React.FC<SourceEditorControlsViewProps> =
  () => {
    return null;
  };

const EditorButtons = ({
  saveButton,
  testConnectionButton,
  handleCancel
}: Props) => {
  return (
    <>
      <Popover
        content={null}
        title={
          <PopoverTitle
            title={saveButton.titleText}
            handleClose={saveButton.handlePopoverClose}
          />
        }
        trigger="click"
        visible={saveButton.isPopoverVisible}
      >
        <Button
          type="primary"
          size="large"
          className="mr-3"
          htmlType="button"
          loading={saveButton.isRequestPending}
          onClick={saveButton.handlePress}
          disabled={saveButton.disabled}
        >
          Save
        </Button>
      </Popover>

      <Popover
        content={null}
        title={
          <PopoverTitle
            title={testConnectionButton.titleText}
            handleClose={testConnectionButton.handlePopoverClose}
          />
        }
        trigger="click"
        visible={testConnectionButton.isPopoverVisible}
      >
        <Button
          size="large"
          className="mr-3"
          type="dashed"
          loading={testConnectionButton.isRequestPending}
          onClick={testConnectionButton.handlePress}
          icon={<ApiOutlined />}
          disabled={testConnectionButton.disabled}
        >
          Test connection
        </Button>
      </Popover>

      {handleCancel && (
        <Button type="default" size="large" onClick={handleCancel} danger>
          Cancel
        </Button>
      )}
    </>
  );
};

EditorButtons.displayName = 'EditorButtons';

export { EditorButtons };
