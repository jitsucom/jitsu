import { Parameter } from '@catalog/sources/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';

export interface Props {
  fieldsParamsList: Parameter[];
  form: FormInstance<any>;
}
