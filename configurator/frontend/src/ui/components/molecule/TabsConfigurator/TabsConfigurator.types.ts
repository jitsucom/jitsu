import { TabsType } from 'antd/es/tabs';
import { FormInstance } from 'antd/lib/form/hooks/useForm';

export interface Tab {
  key: string;
  name: React.ReactNode;
  getComponent?: (form: FormInstance<any>) => React.ReactNode;
  isDisabled?: boolean;
  form?: FormInstance<any>;
}

export interface Props {
  tabsList: Tab[];
  className: string;
  type: TabsType;
  defaultTabIndex?: number;
}
