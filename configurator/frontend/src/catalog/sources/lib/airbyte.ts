import * as logos from './logos';
import { AirbyteSource } from '../types';

export const allAirbyteSources: AirbyteSource[] = [
  {
    pic: logos.amazon,
    docker_image_name: 'airbyte/source-amazon-seller-partner',
    displayName: 'Amazon Seller Partner',
    stable: false
  },
  {
    pic: logos.default_logo,
    docker_image_name: 'airbyte/source-apify-dataset',
    displayName: 'Apify Dataset',
    stable: false
  },
  {
    pic: logos.appstore,
    docker_image_name: 'airbyte/source-appstore-singer',
    displayName: 'App Store',
    stable: false
  },
  {
    pic: logos.asana,
    docker_image_name: 'airbyte/source-asana',
    displayName: 'Asana',
    stable: false
  },
  {
    pic: logos.tap_postgresql,
    docker_image_name: 'airbyte/source-postgres',
    displayName: 'Postgres',
    stable: false
  },
  {
    pic: logos.tap_mysql,
    docker_image_name: 'airbyte/source-mysql',
    displayName: 'MySQL',
    stable: false
  },
  {
    pic: logos.file,
    docker_image_name: 'airbyte/source-file',
    displayName: 'File',
    stable: false
  },
  {
    pic: logos.microsoft_sql_server,
    docker_image_name: 'airbyte/source-mssql',
    displayName: 'Microsoft SQL Server',
    stable: false
  },
  {
    pic: logos.tap_hubspot,
    docker_image_name: 'airbyte/source-hubspot',
    displayName: 'HubSpot',
    stable: false
  },
  {
    pic: logos.tap_salesforce,
    docker_image_name: 'airbyte/source-salesforce-singer',
    displayName: 'Salesforce',
    stable: false
  },
  {
    pic: logos.mailchimp,
    docker_image_name: 'airbyte/source-mailchimp',
    displayName: 'Mailchimp',
    stable: false
  },
  {
    pic: logos.tap_jira,
    docker_image_name: 'airbyte/source-jira',
    displayName: 'Jira',
    stable: false
  },
  {
    pic: logos.tap_stripe,
    docker_image_name: 'airbyte/source-stripe',
    displayName: 'Stripe',
    stable: false
  },
  {
    pic: logos.tap_shopify,
    docker_image_name: 'airbyte/source-shopify',
    displayName: 'Shopify',
    stable: false
  },
  {
    pic: logos.google_adwords,
    docker_image_name: 'airbyte/source-google-adwords-singer',
    displayName: 'Google AdWords',
    stable: false
  },
  {
    pic: logos.redshift,
    docker_image_name: 'airbyte/source-redshift',
    displayName: 'Redshift',
    stable: false
  },
  {
    pic: logos.tap_google_ads,
    docker_image_name: 'airbyte/source-google-ads',
    displayName: 'Google Ads',
    stable: false
  },
  {
    pic: logos.instagram,
    docker_image_name: 'airbyte/source-instagram',
    displayName: 'Instagram',
    stable: false
  },
  {
    pic: logos.freshdesk,
    docker_image_name: 'airbyte/source-freshdesk',
    displayName: 'Freshdesk',
    stable: false
  },
  {
    pic: logos.mongodb,
    docker_image_name: 'airbyte/source-mongodb',
    displayName: 'Mongo DB',
    stable: false
  },
  {
    pic: logos.tap_zoom,
    docker_image_name: 'airbyte/source-zoom-singer',
    displayName: 'Zoom',
    stable: false
  },
  {
    pic: logos.tap_sendgrid_core,
    docker_image_name: 'airbyte/source-sendgrid',
    displayName: 'Sendgrid',
    stable: false
  },
  {
    pic: logos.tap_github,
    docker_image_name: 'airbyte/source-github',
    displayName: 'GitHub',
    stable: false
  },
  {
    pic: logos.tap_marketo,
    docker_image_name: 'airbyte/source-marketo-singer',
    displayName: 'Marketo',
    stable: false
  },
  {
    pic: logos.tap_looker,
    docker_image_name: 'airbyte/source-looker',
    displayName: 'Looker',
    stable: false
  },
  {
    pic: logos.tap_oracle,
    docker_image_name: 'airbyte/source-oracle',
    displayName: 'Oracle DB',
    stable: false
  },
  {
    pic: logos.tap_exchange_rates_api,
    docker_image_name: 'airbyte/source-exchange-rates',
    displayName: 'Exchange Rates API',
    stable: false
  },
  {
    pic: logos.quickbooks,
    docker_image_name: 'airbyte/source-quickbooks-singer',
    displayName: 'Quickbooks',
    stable: false
  },
  {
    pic: logos.tap_recurly,
    docker_image_name: 'airbyte/source-recurly',
    displayName: 'Recurly',
    stable: false
  },
  {
    pic: logos.greenhouse,
    docker_image_name: 'airbyte/source-greenhouse',
    displayName: 'Greenhouse',
    stable: false
  },
  {
    pic: logos.tap_google_search_console,
    docker_image_name: 'airbyte/source-google-search-console-singer',
    displayName: 'Google Search Console',
    stable: false
  },
  {
    pic: logos.microsoft_teams,
    docker_image_name: 'airbyte/source-microsoft-teams',
    displayName: 'Microsoft teams',
    stable: false
  },
  {
    pic: logos.posthog,
    docker_image_name: 'airbyte/source-posthog',
    displayName: 'PostHog',
    stable: false
  },
  {
    pic: logos.pokeapi,
    docker_image_name: 'airbyte/source-pokeapi',
    displayName: 'PokeAPI',
    stable: false
  },
  {
    pic: logos.google_workspace,
    docker_image_name: 'airbyte/source-google-workspace-admin-reports',
    displayName: 'Google Workspace Admin Reports',
    stable: false
  },
  {
    pic: logos.default_logo,
    docker_image_name: 'airbyte/source-google-directory',
    displayName: 'Google Directory',
    stable: false
  },
  {
    pic: logos.clickhouse,
    docker_image_name: 'airbyte/source-clickhouse',
    displayName: 'ClickHouse',
    stable: false
  },
  {
    pic: logos.drift,
    docker_image_name: 'airbyte/source-drift',
    displayName: 'Drift',
    stable: false
  },
  {
    pic: logos.tap_slack,
    docker_image_name: 'airbyte/source-slack',
    displayName: 'Slack',
    stable: false
  },
  {
    pic: logos.tap_zendesk_chat,
    docker_image_name: 'airbyte/source-zendesk-chat',
    displayName: 'Zendesk Chat',
    stable: false
  },
  {
    pic: logos.smartsheet,
    docker_image_name: 'airbyte/source-smartsheets',
    displayName: 'Smartsheets',
    stable: false
  },
  {
    pic: logos.plaid,
    docker_image_name: 'airbyte/source-plaid',
    displayName: 'Plaid',
    stable: false
  },
  {
    pic: logos.tap_s3_csv,
    docker_image_name: 'airbyte/source-s3',
    displayName: 'S3',
    stable: false
  },
  {
    pic: logos.aws_cloudtrail,
    docker_image_name: 'airbyte/source-aws-cloudtrail',
    displayName: 'AWS CloudTrail',
    stable: false
  },
  {
    pic: logos.tap_intercom,
    docker_image_name: 'airbyte/source-intercom',
    displayName: 'Intercom',
    stable: false
  },
  {
    pic: logos.tap_harvest,
    docker_image_name: 'airbyte/source-harvest',
    displayName: 'Harvest',
    stable: false
  },
  {
    pic: logos.tempo,
    docker_image_name: 'airbyte/source-tempo',
    displayName: 'Tempo',
    stable: false
  },
  {
    pic: logos.snowflake,
    docker_image_name: 'airbyte/source-snowflake',
    displayName: 'Snowflake',
    stable: false
  },
  {
    pic: logos.zendesk,
    docker_image_name: 'airbyte/source-zendesk-talk',
    displayName: 'Zendesk Talk',
    stable: false
  },
  {
    pic: logos.iterable,
    docker_image_name: 'airbyte/source-iterable',
    displayName: 'Iterable',
    stable: false
  },
  {
    pic: logos.paypal,
    docker_image_name: 'airbyte/source-paypal-transaction',
    displayName: 'Paypal Transaction',
    stable: false
  },
  {
    pic: logos.default_logo,
    docker_image_name: 'airbyte/source-cart',
    displayName: 'Cart.com',
    stable: false
  },
  {
    pic: logos.cockroachdb,
    docker_image_name: 'airbyte/source-cockroachdb',
    displayName: 'CockroachDB',
    stable: false
  },
  {
    pic: logos.tap_klaviyo,
    docker_image_name: 'airbyte/source-klaviyo',
    displayName: 'Klaviyo',
    stable: false
  },
  {
    pic: logos.tap_ibm_db2,
    docker_image_name: 'airbyte/source-db2',
    displayName: 'IMB Db2',
    stable: false
  },
  {
    pic: logos.okta,
    docker_image_name: 'airbyte/source-okta',
    displayName: 'Okta',
    stable: false
  },
  {
    pic: logos.bigquery,
    docker_image_name: 'airbyte/source-bigquery',
    displayName: 'BigQuery',
    stable: false
  },
  {
    pic: logos.default_logo,
    docker_image_name: 'airbyte/source-dixa',
    displayName: 'Dixa',
    stable: false
  },
  {
    pic: logos.tap_recharge,
    docker_image_name: 'airbyte/source-recharge',
    displayName: 'Recharge',
    stable: false
  },
  {
    pic: logos.tap_chargebee,
    docker_image_name: 'airbyte/source-chargebee',
    displayName: 'Chargebee',
    stable: false
  },
  {
    pic: logos.tap_pipedrive,
    docker_image_name: 'airbyte/source-pipedrive',
    displayName: 'Pipedrive',
    stable: false
  },
  {
    pic: logos.tap_square,
    docker_image_name: 'airbyte/source-square',
    displayName: 'Square',
    stable: false
  },
  {
    pic: logos.tap_gitlab,
    docker_image_name: 'airbyte/source-gitlab',
    displayName: 'GitLab',
    stable: false
  },
  {
    pic: logos.snapchat_marketing,
    docker_image_name: 'airbyte/source-snapchat-marketing',
    displayName: 'Snapchat Marketing',
    stable: false
  },
  {
    pic: logos.tap_mixpanel,
    docker_image_name: 'airbyte/source-mixpanel',
    displayName: 'Mixpanel',
    stable: false,
    hasNativeEquivalent: true
  },
  {
    pic: logos.twilio,
    docker_image_name: 'airbyte/source-twilio',
    displayName: 'Twilio',
    stable: false
  },
  {
    pic: logos.tap_zendesk_support,
    docker_image_name: 'airbyte/source-zendesk-support',
    displayName: 'Zendesk Support',
    stable: false
  },
  {
    pic: logos.us_census,
    docker_image_name: 'airbyte/source-us-census',
    displayName: 'US Census',
    stable: false
  },
  {
    pic: logos.typeform,
    docker_image_name: 'airbyte/source-typeform',
    displayName: 'Typeform',
    stable: false
  },

  {
    pic: logos.tap_surveymonkey,
    docker_image_name: 'airbyte/source-surveymonkey',
    displayName: 'Survey Monkey',
    stable: false
  },
  {
    pic: logos.zendesk,
    docker_image_name: 'airbyte/source-zendesk-sunshine',
    displayName: 'Zendesk Sunshine',
    stable: false
  },
  {
    pic: logos.prestashop,
    docker_image_name: 'airbyte/source-prestashop',
    displayName: 'Prestashop',
    stable: false
  },
  {
    pic: logos.tap_bing_ads,
    docker_image_name: 'airbyte/source-bing-ads',
    displayName: 'Bing Ads',
    stable: false
  },
  {
    pic: logos.tap_braintree,
    docker_image_name: 'airbyte/source-braintree',
    displayName: 'Braintree',
    stable: false
  },
  {
    pic: logos.tap_zuora,
    docker_image_name: 'airbyte/source-zuora',
    displayName: 'Zuora',
    stable: false
  },
  {
    pic: logos.tap_kustomer,
    docker_image_name: 'airbyte/source-kustomer',
    displayName: 'Kustomer',
    stable: false
  },
  {
    pic: logos.default_logo,
    docker_image_name: 'airbyte/source-shortio',
    displayName: 'Shortio',
    stable: false
  },
  {
    pic: logos.tap_trello,
    docker_image_name: 'airbyte/source-trello',
    displayName: 'Trello',
    stable: false
  }
];
