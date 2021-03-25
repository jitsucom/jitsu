import React from 'react';
import { CollectionParameter, SourceConnector } from '@connectors/types';
import { FormInstance } from 'antd/lib/form/hooks/useForm';
import { FormListFieldData } from 'antd/es/form/FormList';
import { CommonSourcePageProps } from '@page/SourcesPage/SourcesPage.types';

export interface FormProps {
  connectorSource: SourceConnector;
  isRequestPending: boolean;
  handleFinish: (args: SourceData) => void;
  sources: SourceData[];
  initialValues: any;
  formMode: 'create' | 'edit';
}

export interface FormWrapProps extends CommonSourcePageProps {
  connectorSource: SourceConnector;
  sourceData?: SourceData;
  formMode?: 'create' | 'edit';
}

export interface SourceFormConfigFieldProps {
  initialValue: any; // string, object?
  id: string;
  displayName: string;
  required: boolean;
  type: string; // 'string' | 'json' | 'int' | 'yaml';
  documentation?: React.ReactNode;
}

export interface SourceFormConfigProps {
  sources: SourceData[];
  connectorSource: SourceConnector;
  initialValues: SourceData;
  sourceIdMustBeUnique: boolean;
}

export interface SourceFormCollectionsProps {
  form: FormInstance;
  initialValues: SourceData;
  connectorSource: SourceConnector;
}

export interface SourceFormCollectionsFieldProps {
  collection: CollectionParameter;
  field: FormListFieldData;
  initialFieldValue: CollectionSource;
  documentation?: React.ReactNode;
}
