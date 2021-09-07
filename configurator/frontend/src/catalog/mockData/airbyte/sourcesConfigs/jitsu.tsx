import {
  booleanType,
  intType,
  makeIntType,
  makeStringType,
  Parameter,
  passwordType,
  selectionType,
  singleSelectionType,
  stringType
} from 'catalog/sources/types';

export const hubspot: Parameter[] = [
  {
    id: 'config.config.connectionSpecification.start_date',
    displayName: 'Start Date',
    type: makeStringType({
      pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
    }),
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'UTC date and time in the format 2017-01-25T00:00:00Z. Any data before this date will not be replicated.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.credentials.api_key',
    displayName: 'API Key',
    type: passwordType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Hubspot API Key. See our <a href="https://docs.airbyte.io/integrations/sources/hubspot">docs</a> if you need help finding this key.'
        }}
      />
    )
  }
];

export const mysql: Parameter[] = [
  {
    id: 'config.config.connectionSpecification.host',
    displayName: 'Host',
    type: stringType,
    required: true,
    documentation: (
      <span dangerouslySetInnerHTML={{ __html: 'Hostname of the database.' }} />
    )
  },
  {
    id: 'config.config.connectionSpecification.port',
    displayName: 'Port',
    type: makeIntType({ minimum: 0, maximum: 65536 }),
    defaultValue: 3306,
    required: true,
    documentation: (
      <span dangerouslySetInnerHTML={{ __html: 'Port of the database.' }} />
    )
  },
  {
    id: 'config.config.connectionSpecification.database',
    displayName: 'Database',
    type: stringType,
    required: true,
    documentation: (
      <span dangerouslySetInnerHTML={{ __html: 'Name of the database.' }} />
    )
  },
  {
    id: 'config.config.connectionSpecification.username',
    displayName: 'Username',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'Username to use to access the database.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.password',
    displayName: 'Password',
    type: passwordType,
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'Password associated with the username.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.jdbc_url_params',
    displayName: 'JDBC URL Params',
    type: stringType,
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            "Additional properties to pass to the jdbc url string when connecting to the database formatted as 'key=value' pairs separated by the symbol '&'. (example: key1=value1&key2=value2&key3=value3)"
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.replication_method',
    displayName: 'Replication Method',
    type: singleSelectionType(['STANDARD', 'CDC']),
    defaultValue: 'STANDARD',
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Replication method to use for extracting data from the database. STANDARD replication requires no setup on the DB side but will not be able to represent deletions incrementally. CDC uses the Binlog to detect inserts, updates, and deletes. This needs to be configured on the source database itself.'
        }}
      />
    )
  }
];

export const mongodb: Parameter[] = [
  {
    id: 'config.config.connectionSpecification.host',
    displayName: 'Host',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'Host of a Mongo database to be replicated.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.port',
    displayName: 'Port',
    type: makeIntType({ minimum: 0, maximum: 65536 }),
    defaultValue: 27017,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'Port of a Mongo database to be replicated.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.database',
    displayName: 'Database Name',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{ __html: 'Database to be replicated.' }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.user',
    displayName: 'User',
    type: stringType,
    required: true,
    documentation: <span dangerouslySetInnerHTML={{ __html: 'User' }} />
  },
  {
    id: 'config.config.connectionSpecification.password',
    displayName: 'Password',
    type: passwordType,
    required: true,
    documentation: <span dangerouslySetInnerHTML={{ __html: 'Password' }} />
  },
  {
    id: 'config.config.connectionSpecification.auth_source',
    displayName: 'Authentication Source',
    type: stringType,
    defaultValue: 'admin',
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Authentication source where user information is stored. See <a href="* [Authentication Source](https://docs.mongodb.com/manual/reference/connection-string/#mongodb-urioption-urioption.authSource)"> the Mongo docs</a> for more info.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.replica_set',
    displayName: 'Replica Set',
    type: stringType,
    defaultValue: '',
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            "The name of the set to filter servers by, when connecting to a replica set (Under this condition, the 'TLS connection' value automatically becomes 'true'). See <a href=\"https://docs.mongodb.com/manual/reference/connection-string/#mongodb-urioption-urioption.replicaSet\"> the Mongo docs </a> for more info."
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.ssl',
    displayName: 'TLS Connection',
    type: booleanType,
    defaultValue: false,
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'If this switch is enabled, TLS connections will be used to connect to MongoDB.'
        }}
      />
    )
  }
];

export const googleAds: Parameter[] = [
  {
    id: 'config.config.connectionSpecification.credentials.developer_token',
    displayName: 'Developer Token',
    type: passwordType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Developer token granted by Google to use their APIs. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.credentials.client_id',
    displayName: 'Client ID',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Google client id. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.credentials.client_secret',
    displayName: 'Client Secret',
    type: passwordType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Google client secret. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.credentials.refresh_token',
    displayName: 'Refresh Token',
    type: passwordType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Refresh token generated using developer_token, oauth_client_id, and oauth_client_secret. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.customer_id',
    displayName: 'Customer ID',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Customer id must be specified as a 10-digit number without dashes. More instruction on how to find this value in our <a href="https://docs.airbyte.io/integrations/sources/google-adwords#setup-guide">docs</a>'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.login_customer_id',
    displayName: 'Login Customer ID',
    type: stringType,
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'If your access to the customer account is through a manager account, this field is required and must be set to the customer ID of the manager account (10-digit number without dashes). More information about this field you can see <a href="https://developers.google.com/google-ads/api/docs/concepts/call-structure#cid">here</a>'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.start_date',
    displayName: 'Start Date',
    type: makeStringType({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'UTC date and time in the format 2017-01-25. Any data before this date will not be replicated.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.conversion_window_days',
    displayName: 'Conversion Window',
    type: makeIntType({ minimum: 0, maximum: 1095 }),
    defaultValue: 14,
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'Define the historical replication lookback window in days'
        }}
      />
    )
  }
];

export const postgres: Parameter[] = [
  {
    id: 'config.config.connectionSpecification.host',
    displayName: 'Host',
    type: stringType,
    required: true,
    documentation: (
      <span dangerouslySetInnerHTML={{ __html: 'Hostname of the database.' }} />
    )
  },
  {
    id: 'config.config.connectionSpecification.port',
    displayName: 'Port',
    type: makeIntType({ minimum: 0, maximum: 65536 }),
    defaultValue: 5432,
    required: true,
    documentation: (
      <span dangerouslySetInnerHTML={{ __html: 'Port of the database.' }} />
    )
  },
  {
    id: 'config.config.connectionSpecification.database',
    displayName: 'DB Name',
    type: stringType,
    required: true,
    documentation: (
      <span dangerouslySetInnerHTML={{ __html: 'Name of the database.' }} />
    )
  },
  {
    id: 'config.config.connectionSpecification.username',
    displayName: 'User',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'Username to use to access the database.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.password',
    displayName: 'Password',
    type: passwordType,
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'Password associated with the username.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.ssl',
    displayName: 'Connect Using SSL',
    type: booleanType,
    defaultValue: false,
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'Encrypt client/server communications for increased security.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.replication_method.method',
    displayName: 'Replication Method',
    type: singleSelectionType(['Standard', 'CDC']),
    defaultValue: 'Standard',
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Replication method to use for extracting data from the database.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.replication_method.replication_slot',
    displayName: 'Replication Slot',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'A pgoutput logical replication slot.'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['replication_method'] !== 'CDC';
    }
  },
  {
    id: 'config.config.connectionSpecification.replication_method.publication',
    displayName: 'Publication',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'A Postgres publication used for consuming changes.'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['replication_method'] !== 'CDC';
    }
  },
  {
    id: 'config.config.connectionSpecification.tunnel_method.tunnel_method',
    displayName: 'Tunnel Method',
    // type: singleSelectionType([
    //   'No Tunnel',
    //   'SSH Key Authentication',
    //   'Password Authentication'
    // ]),
    type: singleSelectionType([
      'NO_TUNNEL',
      'SSH_KEY_AUTH',
      'SSH_PASSWORD_AUTH'
    ]),
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Whether to initiate an SSH tunnel before connecting to the database, and if so, which kind of authentication to use.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.tunnel_method.ssh_key',
    displayName: 'SSH Private Key',
    type: makeStringType({ multiline: true }),
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'OS-level user account ssh key credentials for logging into the jump server host.'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['tunnel_method'] !== 'SSH_KEY_AUTH';
    }
  },
  {
    id: 'config.config.connectionSpecification.tunnel_method.tunnel_host',
    displayName: 'SSH Tunnel Jump Server Host',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Hostname of the jump server host that allows inbound ssh tunnel.'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['tunnel_method'] !== 'SSH_KEY_AUTH';
    }
  },
  {
    id: 'config.config.connectionSpecification.tunnel_method.tunnel_port',
    displayName: 'SSH Connection Port',
    type: makeIntType({ minimum: 0, maximum: 65536 }),
    defaultValue: 22,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Port on the proxy/jump server that accepts inbound ssh connections.'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['tunnel_method'] !== 'SSH_KEY_AUTH';
    }
  },
  {
    id: 'config.config.connectionSpecification.tunnel_method.tunnel_user',
    displayName: 'SSH Login Username',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'OS-level username for logging into the jump server host.'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['tunnel_method'] !== 'SSH_KEY_AUTH';
    }
  },
  {
    id: 'config.config.connectionSpecification.tunnel_method.tunnel_host',
    displayName: 'SSH Tunnel Jump Server Host',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Hostname of the jump server host that allows inbound ssh tunnel.'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['tunnel_method'] !== 'SSH_PASSWORD_AUTH';
    }
  },
  {
    id: 'config.config.connectionSpecification.tunnel_method.tunnel_port',
    displayName: 'SSH Connection Port',
    type: makeIntType({ minimum: 0, maximum: 65536 }),
    defaultValue: 22,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            'Port on the proxy/jump server that accepts inbound ssh connections.'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['tunnel_method'] !== 'SSH_PASSWORD_AUTH';
    }
  },
  {
    id: 'config.config.connectionSpecification.tunnel_method.tunnel_user',
    displayName: 'SSH Login Username',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'OS-level username for logging into the jump server host.'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['tunnel_method'] !== 'SSH_PASSWORD_AUTH';
    }
  },
  {
    id: 'config.config.connectionSpecification.tunnel_method.tunnel_user_password',
    displayName: 'SSH Private Key',
    type: passwordType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'OS-level password for logging into the jump server host'
        }}
      />
    ),
    omitFieldRule: (config) => {
      return config?.['_formData']?.['tunnel_method'] !== 'SSH_PASSWORD_AUTH';
    }
  }
];

export const braintree: Parameter[] = [
  {
    id: 'config.config.connectionSpecification.environment',
    displayName: 'Environment',
    type: selectionType(['Development', 'Sandbox', 'Qa', 'Production'], 1),
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'Environment specifies where the data will come from.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.merchant_id',
    displayName: 'Merchant ID',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            '\u003ca href="https://docs.airbyte.io/integrations/sources/braintree"\u003eMerchant ID\u003c/a\u003e is the unique identifier for entire gateway account.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.private_key',
    displayName: 'Private Key',
    type: passwordType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'This is your user-specific private identifier.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.public_key',
    displayName: 'Public Key',
    type: stringType,
    required: true,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html: 'This is your user-specific public identifier for Braintree.'
        }}
      />
    )
  },
  {
    id: 'config.config.connectionSpecification.start_date',
    displayName: 'Start Date',
    type: stringType,
    required: false,
    documentation: (
      <span
        dangerouslySetInnerHTML={{
          __html:
            "The date from which you'd like to replicate data for Braintree API for UTC timezone, All data generated after this date will be replicated."
        }}
      />
    )
  }
];
