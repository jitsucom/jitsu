// @Libs
import React, { memo } from 'react';
import { Tabs } from 'antd';
// @Types
import { Props, Tab } from './TabsConfigurator.types';

const TabsConfiguratorComponent = ({ tabsList, className, type, defaultTabIndex = 0 }: Props) => {
  return (
    <Tabs type={type} className={className} defaultActiveKey={tabsList[defaultTabIndex]?.key ?? tabsList[0].key}>
      {
        tabsList.map((tab: Tab) =>  (
          <React.Fragment key={tab.key}>
            <Tabs.TabPane key={tab.key} tab={tab.name} disabled={tab.isDisabled}>
              {tab.component}
            </Tabs.TabPane>
          </React.Fragment>
        ))
      }
    </Tabs>
  );
};

TabsConfiguratorComponent.displayName = 'TabsConfigurator';

export const TabsConfigurator = memo(TabsConfiguratorComponent);
