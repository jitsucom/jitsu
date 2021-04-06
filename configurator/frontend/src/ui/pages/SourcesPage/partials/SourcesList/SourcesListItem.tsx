// @Libs
import React, { memo, useCallback, useMemo } from 'react';
import { generatePath, NavLink } from 'react-router-dom';
import { Button, List, Modal } from 'antd';
import cn from 'classnames';
// @Icons
import EditOutlined from '@ant-design/icons/lib/icons/EditOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
// @Types
import { SourcesListItemProps as Props } from './SourcesList.types';
// @Routes
import { routes } from '@page/SourcesPage/routes';
// @Styles
import styles from './SourcesListItem.module.less';

const SourcesListItemComponent = ({ sourceId, sourceProto, handleDeleteSource }: Props) => {
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

  return (
    <List.Item
      key={sourceId}
      className={styles.sourcesListItem}
      actions={[
        <NavLink
          to={generatePath(routes.editExact, { sourceId })}
          className={cn('ant-btn', 'ant-btn-round', styles.editButton)}
          key="edit"><EditOutlined /> Edit</NavLink>,
        <Button icon={<DeleteOutlined />} key="delete" shape="round" onClick={handleDelete}>
          Delete
        </Button>
      ]}
    >
      <List.Item.Meta avatar={sourceProto?.pic} title={sourceProto?.displayName} description={itemDescription} />
    </List.Item>
  );
};

SourcesListItemComponent.displayName = 'SourcesListItem';

export const SourcesListItem = memo(SourcesListItemComponent);
