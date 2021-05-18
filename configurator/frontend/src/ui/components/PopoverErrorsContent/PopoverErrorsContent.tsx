// @Libs
import React, { memo } from 'react';
// @Types
import { Tab } from '@component/TabsConfigurator';
// @Styles
import styles from './PopoverErrorsContent.module.less';

export interface Props {
  tabsList: Tab[];
}

const PopoverErrorsContentComponent = ({ tabsList }: Props) => (
  <ul className={styles.list}>
    {
      tabsList
        .filter(t => t.errorsCount > 0)
        .map((tab: Tab) => <li key={tab.key}>{tab.errorsCount} {`${tab.errorsLevel ?? 'error'}(s)`} at `{tab.name}` tab;</li>)
    }
  </ul>
)

PopoverErrorsContentComponent.displayName = 'PopoverErrorsContent';

export const PopoverErrorsContent = PopoverErrorsContentComponent;
