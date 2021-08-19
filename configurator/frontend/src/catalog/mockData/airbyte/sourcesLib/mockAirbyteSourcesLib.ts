import { AirbyteSource } from 'catalog/sources/types';
import * as logos from 'catalog/sources/lib/logos';

export const allMockAirbyteSources: AirbyteSource[] = [
  {
    pic: logos.airbyte,
    name: 'airbyte-hubspot-source',
    displayName: 'Hubspot',
    stable: false
  },
  {
    pic: logos.airbyte,
    name: 'airbyte-mysql-source',
    displayName: 'MySQL',
    stable: false
  },
  {
    pic: logos.airbyte,
    name: 'airbyte-mongodb-source',
    displayName: 'MongoDB',
    stable: false
  },
  {
    pic: logos.airbyte,
    name: 'airbyte-freshdesk-source',
    displayName: 'Freshdesk',
    stable: false
  },
  {
    pic: logos.airbyte,
    name: 'airbyte-mailchimp-source',
    displayName: 'Mailchimp',
    stable: false
  },
  {
    pic: logos.airbyte,
    name: 'airbyte-instagram-source',
    displayName: 'Instagram',
    stable: false
  },

  {
    pic: logos.airbyte,
    name: 'airbyte-google-ads-source',
    displayName: 'Google Ads',
    stable: false
  },

  {
    pic: logos.airbyte,
    name: 'airbyte-microsoft-teams-source',
    displayName: 'Microsoft Teams',
    stable: false
  },

  {
    pic: logos.airbyte,
    name: 'airbyte-postgres-source',
    displayName: 'Postgres',
    stable: false
  }
];
