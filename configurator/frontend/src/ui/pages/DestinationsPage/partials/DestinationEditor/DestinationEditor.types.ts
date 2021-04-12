import { Destination } from '@catalog/destinations/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';

export interface Props {
  destination: Destination;
  form: FormInstance<any>;
}
