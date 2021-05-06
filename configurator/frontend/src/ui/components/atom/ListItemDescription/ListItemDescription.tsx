// @Libs
import React, { memo } from 'react';
import cn from 'classnames';
// @Styles
import styles from './ListItemDescription.module.less';
import { Popover } from 'antd';

export interface Props {
  className?: string;
  render: React.ReactNode;
  dotted?: boolean;
  tooltip?: React.ReactNode;
}

const ListItemDescriptionComponent = ({ className, render, dotted, tooltip }: Props) => {
  return !tooltip
    ? <span className={cn(className, styles.item, dotted && styles.dotted)}>{render}</span>
    : <Popover content={tooltip} trigger="click" placement="topLeft">
      <span className={cn(className, styles.item, dotted && styles.dotted)}>{render}</span>
    </Popover>;
};

ListItemDescriptionComponent.displayName = 'ListItemDescription';

export const ListItemDescription = memo(ListItemDescriptionComponent);
