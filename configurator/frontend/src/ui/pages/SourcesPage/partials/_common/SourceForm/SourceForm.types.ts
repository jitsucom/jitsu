export interface FormProps {
  connectorSource: any;
  isRequestPending: boolean;
  handleFinish: (args: any) => any;
  alreadyExistSources: any;
  initialValues: any;
  formMode: 'create' | 'add' | 'edit';
}

export interface FormWrapProps {
  sources: any;
  connectorSource: any;
  userUid: string;
  sourceData: any;
  formMode?: 'create' | 'add' | 'edit';
}
