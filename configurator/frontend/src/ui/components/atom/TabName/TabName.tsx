// @Libs
import { memo } from 'react';
import cn from 'classnames';
// @Styles
import styles from './TabName.module.less';

export interface Props {
  name: React.ReactNode;
  errorsCount: number;
  errorsLevel?: 'warning' | 'error';
}

const TabNameComponent = ({ name, errorsCount, errorsLevel = 'error' }: Props) => (
  <>
    {
      errorsCount === 0
        ? name
        : <span className={cn(styles.name, errorsCount > 0 && styles[errorsLevel])}>{name} <sup>{errorsCount}</sup></span>
    }
  </>
)

TabNameComponent.displayName = 'TabName';

export const TabName = TabNameComponent;
