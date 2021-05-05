// @Libs
import React, { memo, ReactNode, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'antd';
import cn from 'classnames';
// @Styles
import styles from './ListItem.module.less';

export interface ListItemAction {
  onClick: () => void
  title: string
  icon: ReactNode
}

export interface Props {
  className?: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  additional?: React.ReactNode;
  prefix?: React.ReactNode;
  actions?: ListItemAction[];
  id: string;
}

// ToDo: maybe components name has to be changed?
const ListItemComponent = ({ className, icon, title, description, additional, prefix, actions, id }: Props) => {

  return (
    <li className={cn(styles.item, className)}>
      <span className={styles.left}>
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        {icon && <span className={styles.icon}>{icon}</span>}
        <span className={styles.info}>
          <span className={styles.title}>{title}</span>
          {description && <span className={styles.description}>{description}</span>}
          {additional && <span className={styles.additional}>{additional}</span>}
        </span>
      </span>
      {
        actions?.length > 0 && <span className={styles.right}>
          {
            actions.map((action: ListItemAction, index: number) => {
              return (
                <span key={action.title} className={styles.action}>
                  <Button icon={action.icon} key="edit" shape="round" type="link" onClick={action.onClick}>{action.title}</Button>
                  {
                    index < actions.length - 1 && <span className={styles.splitter} />
                  }
                </span>
              )
            })
          }
        </span>
      }
    </li>
  );
};

ListItemComponent.displayName = 'ListItem';

export const ListItem = memo(ListItemComponent);
