import { TabsType } from 'antd/es/tabs';

export interface Tab {
  key: string;
  name: React.ReactNode;
  component?: React.ReactNode;
  isDisabled?: boolean;
}

export interface Props {
  tabsList: Tab[];
  className: string;
  type: TabsType;
  defaultTabIndex?: number;
}
