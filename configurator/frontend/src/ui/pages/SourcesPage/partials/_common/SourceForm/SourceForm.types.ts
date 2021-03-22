import React from 'react';
import { CollectionParameter, SourceConnector } from '@connectors/types';

export interface FormProps {
  connectorSource: SourceConnector;
  isRequestPending: boolean;
  handleFinish: (args: any) => any;
  alreadyExistSources: any;
  initialValues: any;
  formMode: 'create' | 'edit';
}

export interface FormWrapProps {
  sources: any;
  connectorSource: SourceConnector;
  projectId: string;
  sourceData?: any;
  formMode?: 'create' | 'edit';
}

export interface SourceFormConfigFieldProps {
  initialValue: any;
  id: string;
  displayName: string;
  required: boolean;
  type: any;
  documentation?: React.ReactNode;
}

export interface SourceFormConfigProps {
  alreadyExistSources: any;
  connectorSource: SourceConnector;
  initialValues: any;
}

export interface SourceFormCollectionsProps {
  initialValues: any;
  connectorSource: SourceConnector;
}

export interface SourceFormCollectionsFieldProps {
  collection: CollectionParameter;
  field: any;
  initialFieldValue: any;
  documentation?: React.ReactNode;
}
