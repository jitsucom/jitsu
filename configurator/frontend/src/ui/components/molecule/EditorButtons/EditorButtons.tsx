// @Libs
import React from 'react';
import { Button, Popover } from 'antd';
// @Components
import { PopoverTitle } from '@atom/PopoverTitle';
// @Icons
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';

export interface Props {
  handleSubmit: () => void;
  handleTestConnection: () => void;
  testConnectingPopoverClose: () => void;
  handleCancel: () => void;
  destinationSaving: boolean;
  testConnecting: boolean;
  isTestConnectingPopoverVisible: boolean;
}

const EditorButtons = ({
  handleSubmit,
  handleTestConnection,
  testConnectingPopoverClose,
  handleCancel,
  destinationSaving,
  testConnecting,
  isTestConnectingPopoverVisible
}: Props) => {
  return (
    <>
      <Button
        type="primary"
        size="large"
        className="mr-3"
        htmlType="button"
        loading={destinationSaving}
        onClick={handleSubmit}>Save</Button>

      <Popover
        content={<>Error</>}
        title={<PopoverTitle title="Config form errors" handleClose={testConnectingPopoverClose}/>}
        trigger="click"
        visible={isTestConnectingPopoverVisible}
      >
        <Button
          size="large"
          className="mr-3"
          type="dashed"
          loading={testConnecting}
          onClick={handleTestConnection}
          icon={<ApiOutlined/>}
        >Test connection</Button>
      </Popover>

      <Button
        type="default"
        size="large"
        onClick={handleCancel}
        danger>Cancel</Button>
    </>
  );
};

EditorButtons.displayName = 'EditorButtons';

export { EditorButtons };
