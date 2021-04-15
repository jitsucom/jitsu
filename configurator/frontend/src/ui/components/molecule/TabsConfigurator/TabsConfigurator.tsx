// @Libs
import React, { memo } from 'react';
import { Tabs } from 'antd';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { TabsType } from 'antd/es/tabs';

export interface Tab {
  key: string;
  name: React.ReactNode;
  getComponent?: (form: FormInstance) => React.ReactNode;
  isDisabled?: boolean;
  form?: FormInstance;
  errorsCount?: number;
}

export interface Props {
  tabsList: Tab[];
  className: string;
  type: TabsType;
  defaultTabIndex?: number;
}

const TabsConfiguratorComponent = ({ tabsList, className, type, defaultTabIndex = 0 }: Props) => {
  return (
    <Tabs type={type} className={className} defaultActiveKey={tabsList[defaultTabIndex]?.key ?? tabsList[0].key}>
      {
        tabsList.map((tab: Tab) =>  (
          <React.Fragment key={tab.key}>
            <Tabs.TabPane key={tab.key} tab={tab.name} disabled={tab.isDisabled} forceRender>
              {tab.getComponent && tab.getComponent(tab.form)}
            </Tabs.TabPane>
          </React.Fragment>
        ))
      }
    </Tabs>
  );
};

TabsConfiguratorComponent.displayName = 'TabsConfigurator';

export const TabsConfigurator = memo(TabsConfiguratorComponent);
