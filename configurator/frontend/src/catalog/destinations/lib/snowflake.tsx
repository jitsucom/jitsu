import { modeParameter, s3Credentials, tableName } from './common';
import {
  hiddenValue,
  Function,
  jsonType,
  passwordType,
  singleSelectionType,
  stringType
} from '../../sources/types';

const icon = (
  <svg
    viewBox="0 0 44 44"
    height="100%"
    width="100%"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M37.2617 33.6602L28.086 28.3594C26.7969 27.6172 25.1485 28.0586 24.4024 29.3477C24.1133 29.8555 24 30.4141 24.0547 30.957V41.3164C24.0547 42.7969 25.2578 44 26.7422 44C28.2227 44 29.4258 42.7969 29.4258 41.3164V35.3594L34.5664 38.3281C35.8555 39.0742 37.5078 38.6289 38.25 37.3398C38.9961 36.0508 38.5547 34.4023 37.2617 33.6602Z"
      fill="#29B5E8"
    />
    <path
      d="M14.4414 22.3008C14.457 21.3438 13.9531 20.4531 13.125 19.9727L3.94923 14.6758C3.55079 14.4453 3.09376 14.3242 2.63673 14.3242C1.69533 14.3242 0.820325 14.8281 0.351575 15.6406C-0.374987 16.8984 0.0586073 18.5117 1.31642 19.2383L6.60548 22.2891L1.31642 25.3438C0.707044 25.6953 0.269544 26.2617 0.0898573 26.9414C-0.0937367 27.6211 1.33514e-05 28.332 0.351575 28.9414C0.820325 29.7539 1.69533 30.2578 2.63283 30.2578C3.09376 30.2578 3.55079 30.1367 3.94923 29.9062L13.125 24.6094C13.9453 24.1328 14.4492 23.25 14.4414 22.3008Z"
      fill="#29B5E8"
    />
    <path
      d="M6.03127 10.9219L15.2071 16.2188C16.2774 16.8398 17.5977 16.6367 18.4414 15.8125C18.9766 15.3203 19.3086 14.6172 19.3086 13.8359V3.21875C19.3086 1.73438 18.1055 0.53125 16.625 0.53125C15.1406 0.53125 13.9375 1.73438 13.9375 3.21875V9.26172L8.72658 6.25391C7.43752 5.50781 5.78908 5.94922 5.04299 7.23828C4.2969 8.52734 4.74221 10.1758 6.03127 10.9219Z"
      fill="#29B5E8"
    />
    <path
      d="M26.6641 22.7305C26.6641 22.9336 26.5469 23.2148 26.4023 23.3633L22.7656 27C22.6211 27.1445 22.3359 27.2617 22.1328 27.2617H21.207C21.0039 27.2617 20.7187 27.1445 20.5742 27L16.9336 23.3633C16.7891 23.2148 16.6719 22.9336 16.6719 22.7305V21.8047C16.6719 21.5977 16.7891 21.3164 16.9336 21.1719L20.5742 17.5312C20.7187 17.3867 21.0039 17.2695 21.207 17.2695H22.1328C22.3359 17.2695 22.6211 17.3867 22.7656 17.5312L26.4023 21.1719C26.5469 21.3164 26.6641 21.5977 26.6641 21.8047V22.7305ZM23.418 22.2852V22.2461C23.418 22.0977 23.332 21.8906 23.2266 21.7812L22.1523 20.7109C22.0469 20.6016 21.8398 20.5156 21.6875 20.5156H21.6484C21.5 20.5156 21.293 20.6016 21.1836 20.7109L20.1133 21.7812C20.0078 21.8867 19.9219 22.0937 19.9219 22.2461V22.2852C19.9219 22.4375 20.0078 22.6445 20.1133 22.75L21.1836 23.8242C21.293 23.9297 21.5 24.0156 21.6484 24.0156H21.6875C21.8398 24.0156 22.0469 23.9297 22.1523 23.8242L23.2266 22.75C23.332 22.6445 23.418 22.4375 23.418 22.2852Z"
      fill="#29B5E8"
    />
    <path
      d="M28.0859 16.2188L37.2617 10.9219C38.5508 10.1797 38.9961 8.52734 38.25 7.23828C37.5039 5.94922 35.8555 5.50781 34.5664 6.25391L29.4258 9.22266V3.21875C29.4258 1.73438 28.2227 0.53125 26.7422 0.53125C25.2578 0.53125 24.0547 1.73438 24.0547 3.21875V13.625C24.0039 14.1641 24.1094 14.7266 24.4024 15.2344C25.1484 16.5234 26.7969 16.9648 28.0859 16.2188Z"
      fill="#29B5E8"
    />
    <path
      d="M17.0469 28.0469C16.4375 27.9297 15.7852 28.0273 15.2071 28.3594L6.03127 33.6602C4.74221 34.4023 4.2969 36.0508 5.04299 37.3398C5.78908 38.6328 7.43752 39.0742 8.72658 38.3281L13.9375 35.3203V41.3164C13.9375 42.7969 15.1406 44 16.625 44C18.1055 44 19.3086 42.7969 19.3086 41.3164V30.6992C19.3086 29.3594 18.3281 28.25 17.0469 28.0469Z"
      fill="#29B5E8"
    />
    <path
      d="M42.9961 15.6094C42.2539 14.3164 40.6016 13.875 39.3125 14.6211L30.1367 19.918C29.2578 20.4258 28.7735 21.3555 28.7891 22.3008C28.7813 23.2422 29.2656 24.1602 30.1367 24.6602L39.3125 29.9609C40.6016 30.7031 42.25 30.2617 42.9961 28.9727C43.7422 27.6836 43.2969 26.0352 42.0078 25.2891L36.8125 22.2891L42.0078 19.2891C43.3008 18.5469 43.7422 16.8984 42.9961 15.6094Z"
      fill="#29B5E8"
    />
  </svg>
);

function isBatch(cfg) {
  return cfg?._formData?.mode === 'batch';
}

function displayForBatchOnly<T>(defaultValue: T): Function<any, T> {
  return (cfg) => {
    return cfg?._formData?.mode === 'batch'
      ? undefined //display the option
      : defaultValue; //hide the option, display default value
  };
}

const destination = {
  description: (
    <>
      Snowflake is a fast and scalable data warehouse. Jitsu can works with
      Snowflake both in stream and batch modes. For batching, you'll need to
      provide an access either to Amazon S3 or to Google's Cloud storage bucket
    </>
  ),
  syncFromSourcesStatus: 'supported',
  id: 'snowflake',
  type: 'database',
  displayName: 'Snowflake',
  defaultTransform: '',
  hidden: false,
  ui: {
    icon,
    title: (cfg) => cfg?._formData?.snowflakeDB,
    connectCmd: (cfg: object) => null
  },
  parameters: [
    modeParameter(),
    tableName(),
    {
      id: '_formData.snowflakeAccount',
      displayName: 'Account',
      required: true,
      type: stringType,
      documentation: (
        <>
          Snowflake Account from URL
          https://"SNOWFLAKE_ACCOUNT".snowflakecomputing.com/
        </>
      )
    },
    {
      id: '_formData.snowflakeWarehouse',
      displayName: 'Warehouse',
      required: true,
      type: stringType
    },
    {
      id: '_formData.snowflakeDB',
      displayName: 'DB',
      required: true,
      type: stringType
    },
    {
      id: '_formData.snowflakeSchema',
      displayName: 'Schema',
      required: true,
      type: stringType,
      defaultValue: 'PUBLIC'
    },
    {
      id: '_formData.snowflakeUsername',
      displayName: 'Username',
      required: true,
      type: stringType
    },
    {
      id: '_formData.snowflakePassword',
      displayName: 'Password',
      required: true,
      type: passwordType
    },
    {
      id: '_formData.snowflakeStageName',
      displayName: 'Stage name',
      constant: displayForBatchOnly(''),
      required: (cfg) => cfg?._formData?.snowflakeStageType === 'gcs',
      type: stringType
    },
    {
      id: '_formData.snowflakeStageType',
      displayName: 'Stage type',
      defaultValue: 's3',
      constant: displayForBatchOnly('s3'),
      type: singleSelectionType(['s3', 'gcs'])
    },
    {
      id: '_formData.snowflakeJSONKey',
      displayName: 'Access Key',
      documentation: (
        <>
          Google Service Account JSON credentials for GCS Bucket.{' '}
          <a href="https://jitsu.com/docs/configuration/google-authorization#service-account-configuration">
            Read more about Google Authorization
          </a>
        </>
      ),
      required: true,
      type: jsonType,
      constant: hiddenValue('', (cfg) => {
        return (
          cfg?.['_formData']?.mode !== 'batch' ||
          (cfg?.['_formData']?.mode === 'batch' &&
            cfg?.['_formData']?.snowflakeStageType !== 'gcs')
        );
      })
    },
    {
      id: '_formData.snowflakeGCSBucket',
      documentation: (
        <>
          Name of GCS Bucket. The bucket should be accessible with the same
          Access Key as dataset
        </>
      ),
      displayName: 'GCS Bucket',
      required: true,
      type: stringType,
      constant: hiddenValue('', (cfg) => {
        return (
          cfg?.['_formData']?.mode !== 'batch' ||
          (cfg?.['_formData']?.mode === 'batch' &&
            cfg?.['_formData']?.snowflakeStageType !== 'gcs')
        );
      })
    },
    ...s3Credentials(
      '_formData.snowflakeS3Region',
      '_formData.snowflakeS3Bucket',
      '_formData.snowflakeS3AccessKey',
      '_formData.snowflakeS3SecretKey',
      (cfg) =>
        cfg?._formData?.mode !== 'batch' ||
        (cfg?._formData?.mode === 'batch' &&
          cfg?._formData?.snowflakeStageType !== 's3')
    )
  ]
} as const;

export default destination;
