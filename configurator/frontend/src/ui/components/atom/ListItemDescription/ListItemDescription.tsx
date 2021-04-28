// @Libs
import React, { memo } from 'react';
import cn from 'classnames';
// @Styles
import styles from './ListItemDescription.module.less';

export interface Props {
  className?: string;
  render: React.ReactNode;
  dotted?: boolean;
}

const ListItemDescriptionComponent = ({ className, render, dotted }: Props) => {
  return <span className={cn(className, styles.item, dotted && styles.dotted)}>{render}</span>
};

ListItemDescriptionComponent.displayName = 'ListItemDescription';

export const ListItemDescription = memo(ListItemDescriptionComponent);
