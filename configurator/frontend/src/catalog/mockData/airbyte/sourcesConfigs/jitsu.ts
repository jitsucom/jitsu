import { hiddenValue } from 'catalog/destinations/lib/common';
import {
  booleanType,
  makeIntType,
  makeStringType,
  Parameter,
  passwordType,
  singleSelectionType,
  stringType
} from 'catalog/sources/types';

export const hubspot: Parameter[] = [
  {
    id: 'airbyte-hubspot-start_date',
    displayName: 'Start Date',
    type: makeStringType(
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
    ),
    required: true,
    documentation:
      'UTC date and time in the format 2017-01-25T00:00:00Z. Any data before this date will not be replicated.'
  },
  {
    id: 'airbyte-hubspot-api_key',
    displayName: 'API Key',
    type: passwordType,
    required: true,
    documentation:
      'Hubspot API Key. See our <a href="https://docs.airbyte.io/integrations/sources/hubspot">docs</a> if you need help finding this key.'
  }
];

export const mysql: Parameter[] = [
  {
    id: 'airbyte-mysql-host',
    displayName: 'Host',
    type: stringType,
    required: true,
    documentation: 'Hostname of the database.'
  },
  {
    id: 'airbyte-mysql-port',
    displayName: 'Port',
    type: makeIntType({ minimum: 0, maximum: 65536 }),
    defaultValue: 3306,
    required: true,
    documentation: 'Port of the database.'
  },
  {
    id: 'airbyte-mysql-database',
    displayName: 'Database',
    type: stringType,
    required: true,
    documentation: 'Name of the database.'
  },
  {
    id: 'airbyte-mysql-username',
    displayName: 'Username',
    type: stringType,
    required: true,
    documentation: 'Username to use to access the database.'
  },
  {
    id: 'airbyte-mysql-password',
    displayName: 'Password',
    type: passwordType,
    required: false,
    documentation: 'Password associated with the username.'
  },
  {
    id: 'airbyte-mysql-jdbc_url_params',
    displayName: 'JDBC URL Params',
    type: stringType,
    required: false,
    documentation:
      "Additional properties to pass to the jdbc url string when connecting to the database formatted as 'key=value' pairs separated by the symbol '&'. (example: key1=value1&key2=value2&key3=value3)"
  },
  {
    id: 'airbyte-mysql-replication_method',
    displayName: 'Replication Method',
    type: singleSelectionType(['STANDARD', 'CDC']),
    defaultValue: 'STANDARD',
    required: true,
    documentation:
      'Replication method to use for extracting data from the database. STANDARD replication requires no setup on the DB side but will not be able to represent deletions incrementally. CDC uses the Binlog to detect inserts, updates, and deletes. This needs to be configured on the source database itself.'
  }
];

export const mongodb: Parameter[] = [
  {
    id: 'airbyte-mongodb-host',
    displayName: 'Host',
    type: stringType,
    required: true,
    documentation: 'Host of a Mongo database to be replicated.'
  },
  {
    id: 'airbyte-mongodb-port',
    displayName: 'Port',
    type: makeIntType({ minimum: 0, maximum: 65536 }),
    defaultValue: 27017,
    required: true,
    documentation: 'Port of a Mongo database to be replicated.'
  },
  {
    id: 'airbyte-mongodb-database',
    displayName: 'Database Name',
    type: stringType,
    required: true,
    documentation: 'Database to be replicated.'
  },
  {
    id: 'airbyte-mongodb-user',
    displayName: 'User',
    type: stringType,
    required: true,
    documentation: 'User'
  },
  {
    id: 'airbyte-mongodb-password',
    displayName: 'Password',
    type: passwordType,
    required: true,
    documentation: 'Password'
  },
  {
    id: 'airbyte-mongodb-auth_source',
    displayName: 'Authentication Source',
    type: stringType,
    defaultValue: 'admin',
    required: true,
    documentation:
      'Authentication source where user information is stored. See <a href="* [Authentication Source](https://docs.mongodb.com/manual/reference/connection-string/#mongodb-urioption-urioption.authSource)"> the Mongo docs</a> for more info.'
  },
  {
    id: 'airbyte-mongodb-replica_set',
    displayName: 'Replica Set',
    type: stringType,
    defaultValue: '',
    required: false,
    documentation:
      "The name of the set to filter servers by, when connecting to a replica set (Under this condition, the 'TLS connection' value automatically becomes 'true'). See <a href=\"https://docs.mongodb.com/manual/reference/connection-string/#mongodb-urioption-urioption.replicaSet\"> the Mongo docs </a> for more info."
  },
  {
    id: 'airbyte-mongodb-ssl',
    displayName: 'TLS Connection',
    type: booleanType,
    defaultValue: false,
    required: false,
    documentation:
      'If this switch is enabled, TLS connections will be used to connect to MongoDB.'
  }
];

export const googleAds: Parameter[] = [
  {
    id: 'airbyte-googleAds-developer_token',
    displayName: 'Developer Token',
    type: passwordType,
    required: true,
    documentation:
      'Developer token granted by Google to use their APIs. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
  },
  {
    id: 'airbyte-googleAds-client_id',
    displayName: 'Client ID',
    type: stringType,
    required: true,
    documentation:
      'Google client id. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
  },
  {
    id: 'airbyte-googleAds-client_secret',
    displayName: 'Client Secret',
    type: passwordType,
    required: true,
    documentation:
      'Google client secret. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
  },
  {
    id: 'airbyte-googleAds-refresh_token',
    displayName: 'Refresh Token',
    type: passwordType,
    required: true,
    documentation:
      'Refresh token generated using developer_token, oauth_client_id, and oauth_client_secret. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
  },
  {
    id: 'airbyte-googleAds-customer_id',
    displayName: 'Customer ID',
    type: stringType,
    required: true,
    documentation:
      'Customer id must be specified as a 10-digit number without dashes. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
  },
  {
    id: 'airbyte-googleAds-login_customer_id',
    displayName: 'Login Customer ID',
    type: stringType,
    required: false,
    documentation:
      'If your access to the customer account is through a manager account, this field is required and must be set to the customer ID of the manager account (10-digit number without dashes). More information about this field you can see <a href="https://developers.google.com/google-ads/api/docs/concepts/call-structure#cid">here</a>'
  },
  {
    id: 'airbyte-googleAds-start_date',
    displayName: 'Start Date',
    type: makeStringType('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    required: true,
    documentation:
      'UTC date and time in the format 2017-01-25. Any data before this date will not be replicated.'
  },
  {
    id: 'airbyte-googleAds-conversion_window_days',
    displayName: 'Conversion Window',
    type: makeIntType({ minimum: 0, maximum: 1095 }),
    defaultValue: 14,
    required: false,
    documentation: 'Define the historical replication lookback window in days'
  }
];

export const postgres: Parameter[] = [
  {
    id: 'airbyte-postgres-host',
    displayName: 'Host',
    type: stringType,
    required: true,
    documentation: 'Hostname of the database.'
  },
  {
    id: 'airbyte-postgres-port',
    displayName: 'Port',
    type: makeIntType({ minimum: 0, maximum: 65536 }),
    defaultValue: 5432,
    required: true,
    documentation: 'Port of the database.'
  },
  {
    id: 'airbyte-postgres-database',
    displayName: 'DB Name',
    type: stringType,
    required: true,
    documentation: 'Name of the database.'
  },
  {
    id: 'airbyte-postgres-username',
    displayName: 'User',
    type: stringType,
    required: true,
    documentation: 'Username to use to access the database.'
  },
  {
    id: 'airbyte-postgres-password',
    displayName: 'Password',
    type: passwordType,
    required: false,
    documentation: 'Password associated with the username.'
  },
  {
    id: 'airbyte-postgres-ssl',
    displayName: 'Connect Using SSL',
    type: booleanType,
    defaultValue: false,
    required: false,
    documentation:
      'Encrypt client/server communications for increased security.'
  },
  {
    id: 'airbyte-postgres-replication_method',
    displayName: 'Replication Method',
    type: singleSelectionType(['Standard', 'Logical Replication (CDC)']),
    required: false,
    documentation:
      'Replication method to use for extracting data from the database.'
  },
  {
    id: 'airbyte-postgres-replication_slot',
    displayName: 'Replication Slot',
    type: stringType,
    required: true,
    documentation: 'A pgoutput logical replication slot.',
    constant: hiddenValue('', (config) => {
      return (
        config?.['_formData']?.['replication_method'] !==
        'Logical Replication (CDC)'
      );
    })
  },
  {
    id: 'airbyte-postgres-publication',
    displayName: 'Publication',
    type: stringType,
    required: true,
    documentation: 'A Postgres publication used for consuming changes.',
    constant: hiddenValue('', (config) => {
      return (
        config?.['_formData']?.['replication_method'] !==
        'Logical Replication (CDC)'
      );
    })
  }
];
