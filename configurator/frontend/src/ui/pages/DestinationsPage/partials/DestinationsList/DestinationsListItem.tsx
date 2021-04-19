// @Libs
import React, { useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { Avatar, Button, List, message, Modal, Popover, Tooltip } from 'antd';
// @Types
import { ConnectionDescription, DestinationConfig } from '@service/destinations';
// @Icons
import EditOutlined from '@ant-design/icons/lib/icons/EditOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
import { LabelWithTooltip } from '@atom/LabelWithTooltip';
import { ActionLink, Align, CodeInline, CodeSnippet } from '@./lib/components/components';
import { copyToClipboard } from '@./lib/commons/utils';
import { getIconSrc } from '@page/DestinationsPage/partials/DestinationsList/DestinationsList';

export interface Props {
  current: DestinationConfig;
  destinations: DestinationConfig[];
  onChange: (destinations: DestinationConfig[]) => void;
}

const DestinationsListItem = ({ current, destinations, onChange }: Props) => {
  const history = useHistory();

  const destinationTitle = useMemo(() => {
    const configTitle = current.connectionTestOk
      ? <>{current.id}</> :
      <Tooltip
        trigger={['click', 'hover']}
        title={
          <>
            Last connection test failed with <b><i>'{current.connectionErrorMessage}'</i></b>. Destination might be not
            accepting data. Please, go to editor and fix the connection settings
          </>
        }>
        <span className="destinations-list-failed-connection">
          <b>!</b> {current.id}
        </span>
      </Tooltip>;

    return current.comment
      ? <LabelWithTooltip documentation={current.comment} render={configTitle} />
      : configTitle;
  }, [current]);

  return <List.Item
    actions={[
      <Button icon={<EditOutlined/>} key="edit" shape="round" onClick={() => {
        history.push(`/destinations/edit/${current.id}`)
      }}>Edit</Button>,
      <Button icon={<DeleteOutlined/>} key="delete" shape="round" onClick={() => {
        Modal.confirm({
          title: 'Please confirm deletion of destination',
          icon: <ExclamationCircleOutlined/>,
          content: 'Are you sure you want to delete ' + current.id + ' destination?',
          okText: 'Delete',
          cancelText: 'Cancel',
          onOk: () => {
            destinations = destinations.filter(dest => dest.id !== current.id);
            onChange(destinations);
          },
          onCancel: () => {
          }
        });
      }}>
        Delete
      </Button>
    ]}
    className="destination-list-item">
    <List.Item.Meta
      avatar={<Avatar shape="square" src={getIconSrc(current.type)}/>}
      title={destinationTitle}
      description={
        <>
          <br/>
          {!!current.mode && <>mode: {current.mode}</>}
        </>
      }
    />
  </List.Item>;
};

DestinationsListItem.displayName = 'DestinationsListItem';

export { DestinationsListItem };
