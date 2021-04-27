// @Libs
import React, { memo } from 'react';
import cn from 'classnames';
// @Styles
import styles from './ListItemDescription.module.less';

export interface Props {
  className?: string;
  render: React.ReactNode;
}

const ListItemDescriptionComponent = ({ className, render }: Props) => {
  return <span className={cn(className, styles.item)}>{render}</span>
};

ListItemDescriptionComponent.displayName = 'ListItemDescription';

export const ListItemDescription = memo(ListItemDescriptionComponent);
