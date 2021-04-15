// @Libs
import React, { memo, ReactElement, ReactNode } from 'react';
import { Button, Dropdown } from 'antd';
// @Styles
import styles from './EmptyList.module.less';
// @Icons
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';

export interface Props {
  title: ReactNode;
  list?: ReactElement;
  unit: string;
}

const EmptyListComponent = ({ title, list, unit }: Props) => {
  return <div className={styles.empty}>
    <h3 className="text-2xl">{title}</h3>
    <div>
      <Dropdown placement="bottomCenter" trigger={['click']} overlay={list}>
        <Button type="primary" size="large" icon={<PlusOutlined />}>{`Add ${unit}`}</Button>
      </Dropdown>
    </div>
  </div>
};

EmptyListComponent.displayName = 'EmptyList';

export const EmptyList = memo(EmptyListComponent);
