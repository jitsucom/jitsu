import {
  Parameter,
  passwordType,
  selectionType,
  stringType,
  Function,
  hiddenValue
} from '../../sources/types';
import { ReactNode } from 'react';

const S3_REGIONS = [
  'us-east-2',
  'us-east-1',
  'us-west-1',
  'us-west-2',
  'ap-south-1',
  'ap-northeast-3',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ca-central-1',
  'cn-north-1',
  'cn-northwest-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-south-1',
  'eu-west-3',
  'eu-north-1',
  'me-south-1',
  'sa-east-1',
  'us-gov-east-1',
  'us-gov-west-1'
];

export const modeParameter = (constValue?: string): Parameter => {
  return {
    id: '_formData.mode',
    displayName: 'Mode',
    documentation: (
      <>In steam mode the data will be send to destination instantly.</>
    ),
    required: true,
    defaultValue: constValue ?? 'stream',
    constant: constValue ?? undefined,
    type: constValue ? stringType : selectionType(['stream', 'batch'], 1)
  };
};

export const filteringExpressionDocumentation = (
  <>
    Table name (or table name template). The value is treated as{' '}
    <a href={'https://jitsu.com/docs/configuration/javascript-functions'}>
      JavaScript functions
    </a>
    , if the expression returns <b>null</b>, empty string <b>''</b> or{' '}
    <b>false</b>, the event will not be sent to API. Otherwise the event will go
    through. Any non-empty will be treated the same way. If you do not intend to
    make any filtering, leave the value as is.
  </>
);

/**
 * Destination table name for DBS
 */
export const tableName = (customDocs?: ReactNode): Parameter => {
  return {
    id: `_formData.tableName`,
    displayName: 'Table Name',
    documentation: customDocs ?? (
      <>
        Table name (or table name template). You can test expression by clicking
        on the 'play' icon
      </>
    ),
    required: true,
    defaultValue: 'events',
    type: stringType,
    jsDebugger: 'string'
  };
};

export function s3Credentials(
  regionField,
  bucketField,
  s3AccessKey,
  s3SecretKey,
  hide?: Function<any, boolean>
): Parameter[] {
  return [
    {
      id: regionField,
      displayName: 'S3 Region',
      type: selectionType(S3_REGIONS, 1),
      required: true,
      defaultValue: 'us-west-1',
      constant: hiddenValue('us-west-1', hide)
    },
    {
      id: bucketField,
      displayName: 'S3 Bucket',
      type: stringType,
      required: true,
      constant: hiddenValue('', hide)
    },
    {
      id: s3AccessKey,
      displayName: 'S3 Access Key',
      type: stringType,
      required: true,
      constant: hiddenValue('', hide)
    },
    {
      id: s3SecretKey,
      displayName: 'S3 Secret Key',
      type: passwordType,
      required: true,
      constant: hiddenValue('', hide)
    }
  ];
}
