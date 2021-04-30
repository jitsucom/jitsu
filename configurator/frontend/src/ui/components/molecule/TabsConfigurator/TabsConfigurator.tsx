// @Libs
import React from 'react';
import { Tabs } from 'antd';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { TabsType } from 'antd/es/tabs';
// @Components
import { TabName } from '@atom/TabName';

export interface Tab {
  readonly key: string;
  readonly name: React.ReactNode;
  readonly getComponent?: (form: FormInstance) => React.ReactNode;
  readonly isDisabled?: boolean;
  readonly isHidden?: boolean;
  form?: FormInstance;
  errorsCount?: number;
  readonly errorsLevel?: 'warning' | 'error';
}

export interface Props {
  tabsList: Tab[];
  className?: string;
  type: TabsType;
  defaultTabIndex?: number;
  onTabChange: (tabName: any) => void;
}

const TabsConfiguratorComponent = ({ tabsList, className, type, defaultTabIndex = 0, onTabChange }: Props) => (
  <Tabs
    type={type}
    className={className}
    defaultActiveKey={tabsList[defaultTabIndex]?.key ?? tabsList[0].key}
    onChange={onTabChange}
  >
    {
      tabsList.map((tab: Tab) => !tab.isHidden ? (
        <React.Fragment key={tab.key}>
          <Tabs.TabPane
            key={tab.key}
            tab={<TabName name={tab.name} errorsCount={tab.errorsCount} errorsLevel={tab.errorsLevel} />}
            disabled={tab.isDisabled}
            forceRender
          >
            {tab.getComponent?.(tab.form)}
          </Tabs.TabPane>
        </React.Fragment>
      ) : null)
    }
  </Tabs>
);

TabsConfiguratorComponent.displayName = 'TabsConfigurator';
// ToDo: memo with compare?
export const TabsConfigurator = TabsConfiguratorComponent;
