import * as React from 'react';
import { Destination } from '../types';
import { modeParameter, s3Credentials, tableName } from './common';
import { stringType, passwordType, booleanType } from '../../sources/types';

const icon = <svg enableBackground="new 0 0 1615 1783.7" viewBox="0 0 1615 1783.7" xmlns="http://www.w3.org/2000/svg">
  <path d="m807.5 1363.8 678.3 161.5v-1270.5l-678.3 161.5z" fill="#205b97"/>
  <path d="m1485.8 254.8 129.2 64.6v1141.3l-129.2 64.6zm-678.3 1109-678.3 161.5v-1270.5l678.3 161.5z" fill="#5193ce"/>
  <path d="m129.2 254.8-129.2 64.6v1141.3l129.2 64.6z" fill="#205b97"/>
  <path d="m979.8 1783.7 258.4-129.2v-1525.3l-258.4-129.2-79 847z" fill="#5193ce"/>
  <path d="m635.2 1783.7-258.4-129.2v-1525.3l258.4-129.2 79 847z" fill="#205b97"/>
  <path d="m635.2 0h348.1v1780.1h-348.1z" fill="#2e73b7"/>
</svg>

const destination: Destination = {
  id: 'redshift',
  displayName: 'Redshift',
  ui: {
    title: (cfg) => cfg._formData.redshiftHost,
    connectCmd: (cfg: object) => {
      return `PGPASSWORD="${cfg['_formData']['redshiftPassword']}" psql -U ${cfg['_formData']['redshiftUser']} -d ${cfg['_formData']['redshiftDB']} -h ${cfg['_formData']['redshiftHost']} -p 5439 -c "SELECT 1"`
    },
    icon
  },
  parameters: [
    modeParameter(),
    tableName(),
    {
      id: '_formData.redshiftHost',
      displayName: 'Host',
      required: true,
      type: stringType
    },
    {
      id: '_formData.redshiftDB',
      displayName: 'Database',
      required: true,
      type: stringType
    },
    {
      id: '_formData.redshiftSchema',
      displayName: 'Schema',
      required: true,
      defaultValue: 'public',
      type: stringType
    },
    {
      id: '_formData.redshiftUser',
      displayName: 'Username',
      required: true,
      type: stringType
    },
    {
      id: '_formData.redshiftPassword',
      displayName: 'Password',
      required: true,
      type: passwordType
    },
    {
      id: '_formData.redshiftUseHostedS3',
      type: booleanType,
      constant: false
    },
    ...s3Credentials('redshiftS3Region', 'redshiftS3Bucket', 'redshiftS3AccessKey', 'redshiftS3SecretKey', (cfg) => {
      return cfg?._formData?.mode !== 'batch';
    })
  ]
}

export default destination;
