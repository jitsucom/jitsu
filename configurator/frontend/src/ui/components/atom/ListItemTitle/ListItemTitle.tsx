// @Libs
import { memo } from 'react';
import cn from 'classnames';
// @Styles
import styles from './ListItemTitle.module.less';

export interface Props {
  render: React.ReactNode;
  error?: boolean;
  className?: string;
}

const ListItemTitleComponent = ({ render, error = false, className }: Props) => {
  return (
    <span className={cn(className, error && styles.error)}>{render}</span>
  );
};

ListItemTitleComponent.displayName = 'ListItemTitle';

export const ListItemTitle = memo(ListItemTitleComponent);
