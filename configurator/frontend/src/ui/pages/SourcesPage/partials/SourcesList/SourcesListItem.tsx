// @Libs
import React, { memo, useCallback, useMemo } from 'react';
import { generatePath, NavLink } from 'react-router-dom';
import { Button, List, Modal, Tooltip } from 'antd';
import cn from 'classnames';
// @Components
import { ListItemTitle } from '@atom/ListItemTitle';
// @Icons
import EditOutlined from '@ant-design/icons/lib/icons/EditOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
// @Types
import { SourceConnector } from '@catalog/sources/types';
// @Routes
import { sourcesPageRoutes } from '@page/SourcesPage/routes';
// @Styles
import styles from './SourcesListItem.module.less';

export interface Props {
  sourceData: SourceData;
  sourceId: string;
  sourceProto: SourceConnector;
  handleDeleteSource: (sourceId: string) => void;
}

const SourcesListItemComponent = ({ sourceId, sourceProto, handleDeleteSource, sourceData }: Props) => {
  const itemDescription = useMemo(() => <div>Source ID: {sourceId}</div>, [sourceId]);

  const handleDelete = useCallback(() => {
    Modal.confirm({
      title: 'Please confirm deletion of source',
      icon: <ExclamationCircleOutlined/>,
      content: <span>Are you sure you want to delete <strong>{sourceProto?.displayName}</strong> source?</span>,
      okText: 'Delete',
      cancelText: 'Cancel',
      onOk: () => {
        handleDeleteSource(sourceId)
      },
      onCancel: () => {
      }
    });
  }
  , [sourceId, handleDeleteSource, sourceProto?.displayName]);

  const sourceTitle = sourceData.connected
    ? <ListItemTitle render={sourceProto?.displayName} />
    : <Tooltip
      trigger={['click', 'hover']}
      title={<>
        Last connection test failed with {Object.keys(sourceData.config).map(key => <span style={{ display: 'block', fontWeight: 'bold', fontStyle: 'italic' }} key={key}>{key}: {sourceData.config[key]}</span>)} Source might be not
        accepting data. Please, go to editor and fix the connection settings
      </>}>
      <ListItemTitle error render={<><b>!</b> {sourceProto?.displayName}</>} />
    </Tooltip>;

  return (
    <List.Item
      key={sourceId}
      className={styles.sourcesListItem}
      actions={[
        <NavLink
          to={generatePath(sourcesPageRoutes.editExact, { sourceId })}
          className={cn('ant-btn', 'ant-btn-round', styles.editButton)}
          key="edit"><EditOutlined /> Edit</NavLink>,
        <Button icon={<DeleteOutlined />} key="delete" shape="round" onClick={handleDelete}>
          Delete
        </Button>
      ]}
    >
      <List.Item.Meta avatar={sourceProto?.pic} title={sourceTitle} description={itemDescription} />
    </List.Item>
  );
};

SourcesListItemComponent.displayName = 'SourcesListItem';

export const SourcesListItem = memo(SourcesListItemComponent);
