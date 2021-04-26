// @Types
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { SourceConnector } from '@catalog/sources/types';

export interface Props {
  form: FormInstance;
  // initialValues: SourceData;
  // connectorSource: SourceConnector;
  // reportPrefix?: string;
}

const SourceEditorCollections = ({ form }: Props) => {
  return (
    <div>SourceEditorCollections</div>
  );
};

SourceEditorCollections.displayName = 'SourceEditorCollections';

export { SourceEditorCollections };
