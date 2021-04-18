import React, { Dispatch, SetStateAction } from 'react';
import { CollectionParameter, SourceConnector } from '@catalog/sources/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { FormListFieldData } from 'antd/es/form/FormList';
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';

type FormMode = 'create' | 'edit';

export interface FormProps {
  connectorSource: SourceConnector;
  isRequestPending: boolean;
  handleFinish: (args: SourceData) => void;
  sources: SourceData[];
  initialValues: any;
  formMode: FormMode;
  setConnected: Dispatch<SetStateAction<boolean>>;
}

export interface FormWrapProps extends CommonSourcePageProps {
  connectorSource: SourceConnector;
  sourceData?: SourceData;
  formMode?: FormMode;
}

export interface SourceFormConfigFieldProps {
  initialValue: any; // string, object?
  id: string;
  displayName: string;
  required: boolean;
  type: string; // 'string' | 'json' | 'int' | 'yaml';
  documentation?: React.ReactNode;
  typeOptions?: {
    maxOptions: number;
    options: Array<{ displayName: string; id: string; }>;
  };
  constant: string;
}

export interface SourceFormConfigProps {
  sources: SourceData[];
  connectorSource: SourceConnector;
  initialValues: SourceData;
  isCreateForm: boolean;
}

export interface SourceFormCollectionsProps {
  form: FormInstance<{ collections: CollectionSource[] }>;
  initialValues: SourceData;
  connectorSource: SourceConnector;
  reportPrefix?: string;
}

export interface SourceFormCollectionsFieldProps {
  collection: CollectionParameter;
  field: FormListFieldData;
  initialValue: any;
  documentation?: React.ReactNode;
}

export interface SourceFormDestinationsProps {
  initialValues: SourceData;
  form: FormInstance<{ destinations: string[]; }>;
}

export interface SourcesFormHeaderProps {
  connectorSource: SourceConnector;
  mode: 'add' | 'edit'
}
