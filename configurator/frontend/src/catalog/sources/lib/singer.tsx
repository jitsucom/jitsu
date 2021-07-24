import * as logos from './logos';
import {
  booleanType,
  dashDateType,
  intType,
  isoUtcDateType,
  stringType
} from '../types';
import { customParameters, SingerTap } from './helper';
import { googleServiceAuthDocumentation } from '../lib/documentation';
import { googleAuthConfigParameters } from '../lib/commonParams';

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
          documentation: (
            <>
              Access Token. Generate it{' '}
              <a href="https://github.com/settings/tokens">here</a>
            </>
          )
        },
        {
          displayName: 'Repository',
          id: 'repository',
          type: stringType,
          required: true,
          documentation: <>Repository as org/repo such as jitsucom/jitsu</>
        },
        {
          displayName: 'Start Date',
          id: 'start_date',
          type: isoUtcDateType,
          defaultValue: '2018-01-01T00:00:00.000Z',
          required: true
        }
      ]
    }),

    stable: true,
    hasNativeEquivalent: false,
    documentation: {
      overview: (
        <>
          The GitHub Connector pulls the following data from the repository
          {': '}
          <a href="https://developer.github.com/v3/issues/assignees/#list-assignees">
            assignees
          </a>
          {', '}
          <a href="https://developer.github.com/v3/repos/collaborators/#list-collaborators">
            collaborators
          </a>
          {', '}
          <a href="https://developer.github.com/v3/repos/commits/#list-commits-on-a-repository">
            commits
          </a>
          {', '}
          <a href="https://developer.github.com/v3/issues/#list-issues-for-a-repository">
            issues
          </a>
          {', '}
          <a href="https://developer.github.com/v3/pulls/#list-pull-requests">
            pull requests
          </a>
          {', '}
          <a href="https://developer.github.com/v3/issues/comments/#list-comments-in-a-repository">
            comments
          </a>
          {', '}
          <a href="https://developer.github.com/v3/pulls/reviews/#list-reviews-on-a-pull-request">
            reviews
          </a>
          {', '}
          <a href="https://developer.github.com/v3/pulls/comments/">
            review comments
          </a>
          {', '}
          <a href="https://developer.github.com/v3/activity/starring/#list-stargazers">
            stargazers
          </a>
        </>
      ),
      connection: (
        <>
          <ul>
            <li>
              Go to the{' '}
              <a href="https://github.com/settings/tokens">GitHub tokens</a>{' '}
              page
            </li>
            <li>
              Create a new token with at <code>repo</code> scope.
            </li>
            <li>Save created token. It is used as Access Token in Jitsu UI</li>
          </ul>
        </>
      )
    }
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
    displayName: 'Google Ads (AdWords)',
    tap: 'tap-adwords',
    stable: false,
    hasNativeEquivalent: false,
    parameters: customParameters('tap-adwords', {
      customConfig: [
        {
          displayName: 'Developer Token',
          id: 'developer_token',
          required: true,
          documentation: (
            <>
              API Developer token.{' '}
              <a href="https://services.google.com/fb/forms/newtoken/">
                Apply here
              </a>
            </>
          )
        },
        {
          displayName: 'OAuth Client ID',
          id: 'oauth_client_id',
          required: true
        },
        {
          displayName: 'OAuth Client Secret',
          id: 'oauth_client_secret',
          required: true
        },
        {
          displayName: 'Refresh Token',
          id: 'refresh_token',
          required: true
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
    hasNativeEquivalent: false,
    parameters: customParameters('tap-google-sheets', {
      customConfig: [
        ...googleAuthConfigParameters({
          type: 'type',
          clientId: 'client_id',
          refreshToken: 'refresh_token',
          clientSecret: 'client_secret',
          disableServiceAccount: true
        }),
        {
          displayName: 'Google Spreadsheet ID',
          id: 'spreadsheet_id',
          type: stringType,
          required: true
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
    }),
    documentation: {
      overview: (
        <>
          The Google Sheets connector pulls data from Google Sheets. Each sheet
          is treated as separate collection and being synced to separate table
        </>
      ),
      connection: googleServiceAuthDocumentation({
        serviceName: 'Google Sheets',
        scopes: [
          'https://www.googleapis.com/auth/drive.metadata.readonly',
          'https://www.googleapis.com/auth/spreadsheets.readonly'
        ],
        apis: ['Google Sheets API', 'Google Drive API'],
        oauthEnabled: true,
        serviceAccountEnabled: false
      })
    }
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
          documentation: (
            <>
              Intercom API Access Token.{' '}
              <a href="https://developers.intercom.com/building-apps/docs/authentication-types#section-access-tokens">
                Read how to get it
              </a>
            </>
          )
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
    }),
    documentation: {
      overview: (
        <>
          The Intercom Connector pulls the following entities:{' '}
          <a href="https://developers.intercom.com/intercom-api-reference/v2.0/reference">
            Intercom v2.0 API
          </a>
          {': '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-admins">
            Admins
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-companies">
            Companies
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-conversations">
            Conversations
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#get-a-single-conversation">
            Conversation Parts
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#data-attributes">
            Data Attributes
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-customer-data-attributes">
            Customer Attributes
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-company-data-attributes">
            Company Attributes
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-leads">
            Leads
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-segments">
            Segments
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-segments">
            Company Segments
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-tags-for-an-app">
            Tags
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-teams">
            Teams
          </a>
          {', '}
          <a href="https://developers.intercom.com/intercom-api-reference/reference#list-users">
            Users
          </a>
          {', '}
        </>
      ),
      connection: (
        <ul>
          <li>
            Go to the{' '}
            <a href="https://app.intercom.com/a/developer-signup">
              Intercom Apps
            </a>{' '}
            page
          </li>
          <li>Click "New app"</li>
          <li>Select a clear name e.g. "Jitsu Connector"</li>
          <li>Select "Internal integration"</li>
          <li>Click "Create app"</li>
          <li>
            Go to the "Configure" tab and save Access Token value from
            "Authentication" section. It is used as API Access Token in Jitsu UI
          </li>
        </ul>
      )
    }
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
    hasNativeEquivalent: false,
    parameters: customParameters('tap-mixpanel', {
      customConfig: [
        {
          displayName: 'API Secret',
          id: 'api_secret',
          type: stringType,
          required: true,
          documentation: (
            <>MixPanel API Secret. Obtain it in MixPanel UI project settings.</>
          )
        },
        {
          displayName: 'Date Window Size',
          id: 'date_window_size',
          type: intType,
          required: true,
          defaultValue: 30,
          documentation: (
            <>
              Number of days for date window looping through transactional
              endpoints with from_date and to_date. Clients with large volumes
              of events may want to decrease this to 14, 7, or even down to 1-2
              days.
            </>
          )
        },
        {
          displayName: 'Attribution Window',
          id: 'attribution_window',
          type: intType,
          required: true,
          defaultValue: 5,
          documentation: (
            <>
              Latency minimum number of days to look-back to account for delays
              in attributing accurate results.
            </>
          )
        },
        {
          displayName: 'Project Timezone',
          id: 'project_timezone',
          type: stringType,
          required: true,
          defaultValue: 'UTC',
          documentation: (
            <>
              Time zone in which integer date times are stored. The project
              timezone may be found in the project settings in the Mixpanel
              console.{' '}
              <a href="https://help.mixpanel.com/hc/en-us/articles/115004547203-Manage-Timezones-for-Projects-in-Mixpanel">
                More info about timezones
              </a>
              .
            </>
          )
        },
        {
          displayName: 'Select properties by default',
          id: 'select_properties_by_default',
          type: booleanType,
          defaultValue: true,
          required: true,
          documentation: (
            <>
              Setting this config parameter to true ensures that new properties
              on events and engage records are captured. Otherwise new
              properties will be ignored.
            </>
          )
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
    }),
    documentation: {
      overview: (
        <>
          The MixPanel Connector pulls the following data entities from{' '}
          <a href="https://mixpanel.com">MixPanel</a>
          {': '}
          <a href="https://developer.mixpanel.com/docs/exporting-raw-data#section-export-api-reference">
            Export (Events)
          </a>
          {', '}
          <a href="https://developer.mixpanel.com/docs/data-export-api#section-engage">
            Engage (People/Users)
          </a>
          {', '}
          <a href="https://developer.mixpanel.com/docs/data-export-api#section-funnels">
            Funnels
          </a>
          {', '}
          <a href="https://developer.mixpanel.com/docs/data-export-api#section-annotations">
            Annotations
          </a>
          {', '}
          <a href="https://developer.mixpanel.com/docs/cohorts#section-list-cohorts">
            Cohorts
          </a>
          {', '}
          <a href="https://developer.mixpanel.com/docs/data-export-api#section-engage">
            Cohort Members
          </a>
          {', '}
          <a href="https://developer.mixpanel.com/docs/data-export-api#section-hr-span-style-font-family-courier-revenue-span">
            Revenue
          </a>
        </>
      ),
      connection: (
        <>
          <ul>
            <li>
              Go to the{' '}
              <a href="https://mixpanel.com/report">
                MixPanel Project settings
              </a>{' '}
              page
            </li>
            <li>
              Save API Secret value from "Access Keys" section of Overview tab.
              It is used as API Secret in Jitsu UI
            </li>
          </ul>
        </>
      )
    }
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
    pic: logos.tap_mysql,
    displayName: 'MySQL',
    tap: 'tap-mysql',
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
    hasNativeEquivalent: false,
    parameters: customParameters('tap-shopify', {
      customConfig: [
        {
          displayName: 'API Key',
          id: 'api_key',
          type: stringType,
          required: true,
          documentation: (
            <>
              Read more about{' '}
              <a href="https://shopify.dev/tutorials/generate-api-credentials">
                How to obtain API Key
              </a>
            </>
          )
        },
        {
          displayName: 'Start Date',
          id: 'start_date',
          required: true,
          type: dashDateType,
          defaultValue: '2018-01-01'
        },
        {
          displayName: 'Shop',
          id: 'shop',
          type: stringType,
          required: true,
          documentation: (
            <>
              Name of your Shopify shop from URL: https://{'<YOUR_SHOP_NAME>'}
              .myshopify.com
            </>
          )
        }
      ]
    }),
    documentation: {
      overview: (
        <>
          The Shopify Connector pulls the following entities from{' '}
          <a href="https://help.shopify.com/en/api/reference">Shopify API</a>{' '}
          {': '}
          <a href="https://help.shopify.com/en/api/reference/orders/abandoned_checkouts">
            Abandoned Checkouts
          </a>
          {', '}
          <a href="https://help.shopify.com/en/api/reference/products/collect">
            Collects
          </a>
          {', '}
          <a href="https://help.shopify.com/en/api/reference/products/customcollection">
            Custom Collections
          </a>
          {', '}
          <a href="https://help.shopify.com/en/api/reference/customers">
            Customers
          </a>
          {', '}
          <a href="https://help.shopify.com/en/api/reference/metafield">
            Metafields
          </a>
          {', '}
          <a href="https://help.shopify.com/en/api/reference/orders">Orders</a>
          {', '}
          <a href="https://help.shopify.com/en/api/reference/products">
            Products
          </a>
          {', '}
          <a href="https://help.shopify.com/en/api/reference/orders/transaction">
            Transactions
          </a>
        </>
      ),
      connection: (
        <>
          Follow this instruction to obtain an API key{' '}
          <a href="https://shopify.dev/tutorials/generate-api-credentials">
            How to obtain API Key
          </a>
        </>
      )
    }
  },
  {
    pic: logos.tap_slack,
    displayName: 'Slack',
    tap: 'tap-slack',
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters('tap-slack', {
      customConfig: [
        {
          displayName: 'Access Token',
          id: 'token',
          type: stringType,
          required: true,
          documentation: (
            <>
              You can obtain a token for a single workspace by creating a new{' '}
              <a href="https://api.slack.com/apps?new_app=1">Slack App</a> in
              your workspace and assigning it the relevant{' '}
              <a href="https://api.slack.com/docs/oauth-scopes">scopes</a>. As
              of right now, the minimum required scopes for this App are:{' '}
              channels:history, channels:join, channels:read, files:read,
              groups:read, reactions:read, remote_files:read, team:read,
              usergroups:read, users.profile:read, users:read, users:read.email
            </>
          )
        },
        {
          displayName: 'Start Date',
          id: 'start_date',
          required: true,
          type: isoUtcDateType,
          defaultValue: '2018-01-01T00:00:00.000Z'
        },
        {
          displayName: 'Exclude Archive Channels',
          id: 'exclude_archived',
          type: booleanType,
          defaultValue: false
        },
        {
          displayName: 'Join Public Channels',
          id: 'join_public_channels',
          type: booleanType,
          defaultValue: false
        },
        {
          displayName: 'Join Private Channels',
          id: 'private_channels',
          type: booleanType,
          defaultValue: false
        }
      ]
    }),
    documentation: {
      overview: (
        <>
          The Slack Connector pulls the following data via Slack App (Slack bot)
          from <a href="https://api.slack.com/">Slack API</a> {': '}
          <a href="https://api.slack.com/methods/conversations.list">
            Channels
          </a>
          {', '}
          <a href="https://api.slack.com/methods/conversations.members">
            Channel Members
          </a>
          {', '}
          <a href="https://api.slack.com/methods/users.list">Users</a>
          {', '}
          <a href="https://api.slack.com/methods/conversations.replies">
            Threads (Channel replies)
          </a>
          {', '}
          <a href="https://api.slack.com/methods/usergroups.list">
            User Groups
          </a>
          {', '}
          <a href="https://api.slack.com/methods/files.list">Files</a>
          {', '}
          <a href="https://api.slack.com/methods/files.remote.list">
            Remote Files
          </a>
        </>
      ),
      connection: (
        <ul>
          <li>
            Go to the{' '}
            <a href="https://api.slack.com/apps?new_app=1">
              creating Slack Apps
            </a>{' '}
            page
          </li>
          <li>
            Choose clear app name (e.g. "Jitsu Sync") and select Slack workspace
            to download data from
          </li>
          <li>Go to the "OAuth & Permissions" page of created Slack app</li>
          <li>
            Add the following Bot Token{' '}
            <a href="https://api.slack.com/docs/oauth-scopes">Scopes</a>:
            channels:history, channels:join, channels:read, files:read,
            groups:read, reactions:read, remote_files:read, team:read,
            usergroups:read, users.profile:read, users:read, users:read.email
          </li>
          <li>
            Click "Install to Workspace" in the top of of the OAuth &
            Permissions page and click "Confirm"
          </li>
          <li>
            Save Bot User OAuth Token. It is used as Access Token in Jitsu UI
          </li>
        </ul>
      )
    }
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
          documentation: <>Client secret ('sk_live_....')</>
        },
        {
          displayName: 'Account ID',
          id: 'account_id',
          type: stringType,
          required: true,
          documentation: <>Account ID ('acct_....')</>
        },
        {
          displayName: 'Start Date',
          id: 'start_date',
          type: isoUtcDateType,
          required: true,
          defaultValue: '2020-01-01T00:00:00.000Z',
          documentation: <>Jitsu will sync Stipe data since Start Date</>
        }
      ]
    }),
    documentation: {
      overview: (
        <>
          The Stripe Connector pulls the following entities from{' '}
          <a href="https://stripe.com/docs/api">Stripe API</a>{' '}
          {': '}
          <a href="https://stripe.com/docs/api/balance_transactions/list">
            Balance Transactions
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/charges/list">
            Charges
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/coupons/list">
            Coupons
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/customers/list">
            Customers
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/disputes/list">
            Disputes
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/events/list">
            Events
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/invoices/list">
            Invoices
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/invoiceitems/list">
            Invoice Items
          </a>
          <a href="https://stripe.com/docs/api/invoices/invoice_lines">
            Invoice Line Items
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/payouts/list">
            Payouts
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/plans/list">
            Plans
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/products/list">
            Products
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/subscriptions/list">
            Subscriptions
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/subscription_items/list">
            Subscription Items
          </a>
          {', '}
          <a href="https://stripe.com/docs/api/transfers/list">
            Transfers
          </a>
          {', '}
          <a href="https://api.slack.com/methods/usergroups.list">
            User Groups
          </a>
        </>
      ),
      connection: (
        <ul>
          <li>
            Go to the{' '}
            <a href="https://dashboard.stripe.com/apikeys">
              Stripe Dashboard
            </a>{' '}
            page
          </li>
          <li>
            Save your Account ID (in format: acct_....) and Secret Key (in format: sk_live_....)
          </li>
        </ul>
      )
    }
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
  }
];
