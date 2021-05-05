// @Libs
import { memo } from 'react';
import { Tooltip } from 'antd';
import cn from 'classnames';
// @Styles
import styles from './ListItemTitle.module.less';

export interface Props {
  render: React.ReactNode;
  error?: boolean;
  className?: string;
  errorMessage?: React.ReactNode;
}

const ListItemTitleComponent = ({ render, error = false, className, errorMessage }: Props) => {
  return error
    ? <Tooltip trigger={['click', 'hover']} title={errorMessage}>
      <span className={cn(className, error && styles.error)}><b>!</b> {render}</span>
    </Tooltip>
    : <span>{render}</span>;
};

ListItemTitleComponent.displayName = 'ListItemTitle';

export const ListItemTitle = memo(ListItemTitleComponent);
