// @Libs
import React from 'react';
import { Tabs } from 'antd';
// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { TabsType } from 'antd/es/tabs';
// @Components
import { TabName } from '@component/Tabs/TabName';

export interface Tab<K = string> {
  readonly key: K;
  readonly name: React.ReactNode;
  readonly getComponent?: (form: FormInstance) => React.ReactNode;
  readonly isDisabled?: boolean;
  readonly isHidden?: boolean;
  form?: FormInstance;
  errorsCount?: number;
  readonly errorsLevel?: 'warning' | 'error';
  touched?: boolean;
}

export interface Props {
  tabsList: Tab[];
  className?: string;
  type: TabsType;
  activeTabKey: string;
  onTabChange?: (tabName: any) => void;
}

const TabsConfiguratorComponent = ({ tabsList, className, type, activeTabKey, onTabChange = () => null }: Props) => (
  <Tabs
    type={type}
    className={className}
    activeKey={activeTabKey}
    onChange={onTabChange}
  >
    {
      tabsList.map((tab: Tab) => {
        if (!tab.isHidden) {
          return (
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
          )
        } else {
          return null;
        }
      })
    }
  </Tabs>
);

TabsConfiguratorComponent.displayName = 'TabsConfigurator';
// ToDo: memo with compare?
export const TabsConfigurator = TabsConfiguratorComponent;
