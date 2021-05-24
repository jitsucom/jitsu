import { ReactNode } from 'react';
import * as logos  from './logos'
import { stringType, isoUtcDateType, jsonType } from '../types';
import { customParameters, SingerTap } from './helper';

export const allSingerTaps: SingerTap[] = [
  {
    pic: logos.tap_3plcentral,
    displayName: '3PL Central',
    tap: 'tap-3plcentral',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_adroll,
    displayName: 'AdRoll',
    tap: 'tap-adroll',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_s3_csv,
    displayName: 'Amazon S3 CSV',
    tap: 'tap-s3-csv',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_amplitude,
    displayName: 'Amplitude',
    tap: 'tap-amplitude',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_appsflyer,
    displayName: 'AppsFlyer',
    tap: 'tap-appsflyer',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_autopilot,
    displayName: 'Autopilot',
    tap: 'tap-autopilot',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_bigcommerce,
    displayName: 'BigCommerce',
    tap: 'tap-bigcommerce',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_bing_ads,
    displayName: 'Bing Ads',
    tap: 'tap-bing-ads',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_braintree,
    displayName: 'Braintree',
    tap: 'tap-braintree',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_bronto,
    displayName: 'Bronto',
    tap: 'tap-bronto',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_covid_19_public_data,
    displayName: 'COVID-19 Public Data',
    tap: 'tap-covid-19',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_campaign_manager,
    displayName: 'Campaign Manager',
    tap: 'tap-doubleclick-campaign-manager',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_campaign_monitor,
    displayName: 'Campaign Monitor',
    tap: 'tap-campaign-monitor',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_chargebee,
    displayName: 'Chargebee',
    tap: 'tap-chargebee',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_chargify,
    displayName: 'Chargify',
    tap: 'tap-chargify',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_close_io,
    displayName: 'Close',
    tap: 'tap-closeio',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_clubspeed,
    displayName: 'Club Speed',
    tap: 'tap-clubspeed',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: null,
    displayName: 'Codat',
    tap: 'tap-codat',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_darksky,
    displayName: 'Dark Sky',
    tap: 'tap-darksky',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_deputy,
    displayName: 'Deputy',
    tap: 'tap-deputy',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_dynamodb,
    displayName: 'Dynamo DB',
    tap: 'tap-dynamodb',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_ebay,
    displayName: 'Ebay',
    tap: 'tap-ebay',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_eloqua,
    displayName: 'Eloqua',
    tap: 'tap-eloqua',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_exchange_rates_api,
    displayName: 'Exchange Rates API',
    tap: 'tap-exchangeratesapi',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_facebook_ads,
    displayName: 'Facebook Ads',
    tap: 'tap-facebook',
    stable: true,
    hasNativeEquivalent: true
  },
  {
    pic: null,
    displayName: 'Freshdesk',
    tap: 'tap-freshdesk',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_frontapp,
    displayName: 'Front',
    tap: 'tap-frontapp',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_fullstory,
    displayName: 'FullStory',
    tap: 'tap-fullstory',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_github,
    displayName: 'GitHub',
    tap: 'tap-github',
    parameters: customParameters('tap-github', {
      customConfig: [
        {
          displayName: 'Access Token',
          id: 'access_token',
          type: stringType,
          required: true,
          documentation: <>
            Access Token. Generate it <a href="https://github.com/settings/tokens">here</a>
          </>
        },
        {
          displayName: 'Repository',
          id: 'repository',
          type: stringType,
          required: true,
          documentation: <>
            Repository as org/repo such as jitsucom/jitsu
          </>
        }

      ]
    }),

    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_gitlab,
    displayName: 'GitLab',
    tap: 'tap-gitlab',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_google_ads,
    displayName: 'Google Ads',
    tap: 'tap-adwords',
    stable: true,
    hasNativeEquivalent: true
  },
  {
    pic: logos.tap_google_analytics,
    displayName: 'Google Analytics',
    tap: 'tap-google-analytics',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: null,
    displayName: 'Google Analytics 360',
    tap: 'tap-ga360',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_google_search_console,
    displayName: 'Google Search Console',
    tap: 'tap-google-search-console',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_google_sheets,
    displayName: 'Google Sheets',
    tap: 'tap-google-sheets',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_harvest,
    displayName: 'Harvest',
    tap: 'tap-harvest',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_harvest_forecast,
    displayName: 'Harvest Forecast',
    tap: 'tap-harvest-forecast',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_heap,
    displayName: 'Heap',
    tap: 'tap-heap',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_hubspot,
    displayName: 'HubSpot',
    tap: 'tap-hubspot',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_ibm_db2,
    displayName: 'IBM Db2',
    tap: 'tap-db2',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_impact,
    displayName: 'Impact',
    tap: 'tap-impact',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_intercom,
    displayName: 'Intercom',
    tap: 'tap-intercom',
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters('tap-intercom', {
      customConfig: [
        {
          displayName: 'API Access Token',
          id: 'access_token',
          type: stringType,
          required: true,
          documentation: <>
                        Intercom API Access Token. <a href="https://developers.intercom.com/building-apps/docs/authentication-types#section-access-tokens">Read how to get it</a>
          </>
        },
        {
          displayName: 'Start Date',
          id: 'start_date',
          type: isoUtcDateType,
          defaultValue: '2018-01-01T00:00:00.000Z',
          required: true
        },
        {
          displayName: 'User Agent',
          id: 'user_agent',
          type: stringType,
          constant: 'Jitsu Bot (https://jitsu.com)'
        }
      ]
    })
  },
  {
    pic: logos.tap_invoiced,
    displayName: 'Invoiced',
    tap: 'tap-invoiced',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_jira,
    displayName: 'Jira',
    tap: 'tap-jira',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_klaviyo,
    displayName: 'Klaviyo',
    tap: 'tap-klaviyo',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_kustomer,
    displayName: 'Kustomer',
    tap: 'tap-kustomer',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_lever,
    displayName: 'Lever',
    tap: 'tap-lever',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_linkedin_ads,
    displayName: 'LinkedIn Ads',
    tap: 'tap-linkedin-ads',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_listrak,
    displayName: 'Listrak',
    tap: 'tap-listrak',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_liveperson,
    displayName: 'LivePerson',
    tap: 'tap-liveperson',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_LookML,
    displayName: 'LookML',
    tap: 'tap-LookML',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_looker,
    displayName: 'Looker',
    tap: 'tap-looker',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_mailshake,
    displayName: 'Mailshake',
    tap: 'tap-mailshake',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_mambu,
    displayName: 'Mambu',
    tap: 'tap-mambu',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_marketo,
    displayName: 'Marketo',
    tap: 'tap-marketo',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_mixpanel,
    displayName: 'Mixpanel',
    tap: 'tap-mixpanel',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_mysql,
    displayName: 'MySQL',
    tap: 'tap-mysql',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_onfleet,
    displayName: 'Onfleet',
    tap: 'tap-onfleet',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_oracle,
    displayName: 'Oracle',
    tap: 'tap-oracle',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_outbrain,
    displayName: 'Outbrain',
    tap: 'tap-outbrain',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_outreach,
    displayName: 'Outreach',
    tap: 'tap-outreach',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_pardot,
    displayName: 'Pardot',
    tap: 'tap-pardot',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_pendo,
    displayName: 'Pendo',
    tap: 'tap-pendo',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: null,
    displayName: 'Pepperjam',
    tap: 'tap-pepperjam',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_pipedrive,
    displayName: 'Pipedrive',
    tap: 'tap-pipedrive',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_platform_purple,
    displayName: 'Platform Purple',
    tap: 'tap-platformpurple',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_postgresql,
    displayName: 'PostgreSQL',
    tap: 'tap-postgres',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_quick_base,
    displayName: 'Quick Base',
    tap: 'tap-quickbase',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: null,
    displayName: 'Recharge',
    tap: 'tap-recharge',
    stable: false,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_recurly,
    displayName: 'Recurly',
    tap: 'tap-recurly',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_referral_saasquatch,
    displayName: 'Referral SaaSquatch',
    tap: 'tap-referral-saasquatch',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_responsys,
    displayName: 'Responsys',
    tap: 'tap-responsys',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_revinate,
    displayName: 'Revinate',
    tap: 'tap-revinate',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_sftp,
    displayName: 'SFTP',
    tap: 'tap-sftp',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_saasoptics,
    displayName: 'SaaSOptics',
    tap: 'tap-saasoptics',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_salesforce,
    displayName: 'Salesforce',
    tap: 'tap-salesforce',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_salesforce_marketing_cloud,
    displayName: 'Salesforce Marketing Cloud',
    tap: 'tap-exacttarget',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_selligent,
    displayName: 'Selligent',
    tap: 'tap-selligent',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_sendgrid_core,
    displayName: 'SendGrid Core',
    tap: 'tap-sendgrid',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_shiphero,
    displayName: 'ShipHero',
    tap: 'tap-shiphero',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_shippo,
    displayName: 'Shippo',
    tap: 'tap-shippo',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_shopify,
    displayName: 'Shopify',
    tap: 'tap-shopify',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_slack,
    displayName: 'Slack',
    tap: 'tap-slack',
    stable: true,
    hasNativeEquivalent: false
  },
  // {
  //     pic: logos.tap_square,
  //     displayName: "Square",
  //     tap: "tap-square",
  //     stable: true,
  //     hasNativeEquivalent: false
  // },
  {
    pic: logos.tap_stripe,
    displayName: 'Stripe',
    tap: 'tap-stripe',
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters('tap-stripe', {
      customConfig: [
        {
          displayName: 'Client Secret',
          id: 'client_secret',
          type: stringType,
          required: true,
          documentation: <>
                        Client secret ('sk_live_....')
          </>
        },
        {
          displayName: 'Account ID',
          id: 'account_id',
          type: stringType,
          required: true,
          documentation: <>
                        Account ID ('acct_....')
          </>
        },
        {
          displayName: 'Start Date',
          id: 'start_date',
          type: isoUtcDateType,
          required: true,
          defaultValue: '2020-01-01T00:00:00.000Z',
          documentation: <>
                        Start date
          </>
        }
      ]
    })
  },
  {
    pic: logos.tap_surveymonkey,
    displayName: 'SurveyMonkey',
    tap: 'tap-surveymonkey',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_taboola,
    displayName: 'Taboola',
    tap: 'tap-taboola',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_toggl,
    displayName: 'Toggl',
    tap: 'tap-toggl',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_trello,
    displayName: 'Trello',
    tap: 'tap-trello',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_typeform,
    displayName: 'Typeform',
    tap: 'tap-typeform',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_urban_airship,
    displayName: 'Urban Airship',
    tap: 'tap-urban-airship',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_uservoice,
    displayName: 'Uservoice',
    tap: 'tap-uservoice',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_wootric,
    displayName: 'Wootric',
    tap: 'tap-wootric',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_workday_raas,
    displayName: 'Workday RaaS',
    tap: 'tap-workday-raas',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_xero,
    displayName: 'Xero',
    tap: 'tap-xero',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_yotpo,
    displayName: 'Yotpo',
    tap: 'tap-yotpo',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_zendesk_chat,
    displayName: 'Zendesk Chat',
    tap: 'tap-zendesk-chat',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_zendesk_support,
    displayName: 'Zendesk Support',
    tap: 'tap-zendesk',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_zoom,
    displayName: 'Zoom',
    tap: 'tap-zoom',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_zuora,
    displayName: 'Zuora',
    tap: 'tap-zuora',
    stable: true,
    hasNativeEquivalent: false
  },
  {
    pic: logos.tap_ilevel,
    displayName: 'iLEVEL',
    tap: 'tap-ilevel',
    stable: true,
    hasNativeEquivalent: false
  }]

