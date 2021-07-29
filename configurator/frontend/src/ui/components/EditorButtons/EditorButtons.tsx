// @Libs
import React from 'react';
import { Button, Popover } from 'antd';
// @Components
import { PopoverTitle } from 'ui/components/Popover/PopoverTitle';
import { PopoverErrorsContent } from 'ui/components/Popover/PopoverErrorsContent';
// @Icons
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';
// @Types
import { Tab } from 'ui/components/Tabs/TabsConfigurator';

interface ButtonProps {
  isPopoverVisible: boolean;
  isRequestPending: boolean;
  handlePress: () => void;
  handlePopoverClose: () => void;
  titleText: string;
  tabsList: Tab[];
}

export interface Props {
  save: ButtonProps;
  test: ButtonProps;
  handleCancel: () => void;
}

const EditorButtons = ({
  test,
  save,
  handleCancel
}: Props) => {
  return (
    <>
      <Popover
        content={<PopoverErrorsContent tabsList={save.tabsList} />}
        title={<PopoverTitle title={save.titleText} handleClose={save.handlePopoverClose}/>}
        trigger="click"
        visible={save.isPopoverVisible}
      >
        <Button
          type="primary"
          size="large"
          className="mr-3"
          htmlType="button"
          loading={save.isRequestPending}
          onClick={save.handlePress}>Save</Button>
      </Popover>

      <Popover
        content={<PopoverErrorsContent tabsList={test.tabsList} />}
        title={<PopoverTitle title={test.titleText} handleClose={test.handlePopoverClose}/>}
        trigger="click"
        visible={test.isPopoverVisible}
      >
        <Button
          size="large"
          className="mr-3"
          type="dashed"
          loading={test.isRequestPending}
          onClick={test.handlePress}
          icon={<ApiOutlined/>}
        >Test connection</Button>
      </Popover>

        {handleCancel && (
      <Button
        type="default"
        size="large"
        onClick={handleCancel}
        danger>Cancel</Button>
        )}
    </>
  );
};

EditorButtons.displayName = 'EditorButtons';

export { EditorButtons };
