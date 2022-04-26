import * as logos from "./logos"
import { booleanType, dashDateType, intType, isoUtcDateType, oauthSecretType, passwordType, stringType } from "../types"
import { customParameters } from "./helper"
import { SingerTap } from "../types"
import {
  githubDocumentation,
  googleServiceAuthDocumentation,
  googleSheetsDocumentation,
  intercomDocumentation,
  mixpanelDocumentation,
  mySqlDocumentation,
  shopifyDocumentation,
  slackDocumentation,
  stripeDocumentation,
} from "./documentation"
import { googleAuthConfigParameters } from "./commonParams"

export const allSingerTaps: SingerTap[] = [
  {
    pic: logos.tap_helpscout,
    displayName: "Helpscout",
    tap: "tap-helpscout",
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters("tap-helpscout", {
      customConfig: [
        {
          displayName: "Client ID",
          id: "client_id",
          type: oauthSecretType,
          required: true
        },
        {
          displayName: "Client Secret",
          id: "client_secret",
          type: oauthSecretType,
          required: true
        },
        {
          displayName: "Refresh Token",
          id: "refresh_token",
          type: stringType,
          required: true
        },
        {
          displayName: "User Agent",
          id: "user_agent",
          defaultValue: "Jitsu.Cloud (https://jitsu.com)",
          type: stringType,
          required: true
        },
        {
          displayName: "Start Date",
          id: "start_date",
          type: isoUtcDateType,
          defaultValue: "2021-01-01T00:00:00.000Z",
          required: true,
        },
      ],
    })
  },
  {
    pic: logos.tap_3plcentral,
    displayName: "3PL Central",
    tap: "tap-3plcentral",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_adroll,
    displayName: "AdRoll",
    tap: "tap-adroll",
    parameters: customParameters("tap-adroll", {
      customConfig: [
        {
          displayName: "Client ID",
          id: "client_id",
          type: oauthSecretType,
          required: false,
          documentation: (
            <>
              ID of the{" "}
              <a target="_blank" href="https://apidocs.nextroll.com/guides/get-started.html">
                NextRoll API
              </a>{" "}
              application
            </>
          ),
        },
        {
          displayName: "Client Secret",
          id: "client_secret",
          type: oauthSecretType,
          required: false,
          documentation: (
            <>
              Secret of the API key generated using the{" "}
              <a target="_blank" href="https://developers.nextroll.com/my-apps">
                NextRoll developer account
              </a>
            </>
          ),
        },
        {
          displayName: "Access Token",
          id: "access_token",
          type: stringType,
          required: true,
          documentation: (
            <>
              Access Token.{" "}
              <a
                target="_blank"
                href="https://apidocs.nextroll.com/guides/oauth.html?highlight=access%20token#your-first-api-call"
              >
                Learn how to generate it
              </a>{" "}
              using the NextRoll API
            </>
          ),
        },
        {
          displayName: "Refresh Token",
          id: "refresh_token",
          type: stringType,
          required: true,
          documentation: (
            <>
              Refresh Token.{" "}
              <a
                target="_blank"
                href="https://apidocs.nextroll.com/guides/oauth.html?highlight=access%20token#your-first-api-call"
              >
                Learn how to generate it
              </a>{" "}
              using the NextRoll API
            </>
          ),
        },
        {
          displayName: "Start Date",
          id: "start_date",
          type: isoUtcDateType,
          defaultValue: "2021-01-01T00:00:00.000Z",
          required: true,
        },
      ],
    }),
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_s3_csv,
    displayName: "Amazon S3 CSV",
    tap: "tap-s3-csv",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_amplitude,
    displayName: "Amplitude",
    tap: "tap-amplitude",
    stable: true,
    hasNativeEquivalent: true,
  },
  {
    pic: logos.tap_appsflyer,
    displayName: "AppsFlyer",
    tap: "tap-appsflyer",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_autopilot,
    displayName: "Autopilot",
    tap: "tap-autopilot",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_bigcommerce,
    displayName: "BigCommerce",
    tap: "tap-bigcommerce",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_bing_ads,
    displayName: "Bing Ads",
    tap: "tap-bing-ads",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_braintree,
    displayName: "Braintree",
    tap: "tap-braintree",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_bronto,
    displayName: "Bronto",
    tap: "tap-bronto",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_covid_19_public_data,
    displayName: "COVID-19 Public Data",
    tap: "tap-covid-19",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_campaign_manager,
    displayName: "Campaign Manager",
    tap: "tap-doubleclick-campaign-manager",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_campaign_monitor,
    displayName: "Campaign Monitor",
    tap: "tap-campaign-monitor",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_chargebee,
    displayName: "Chargebee",
    tap: "tap-chargebee",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_chargify,
    displayName: "Chargify",
    tap: "tap-chargify",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_close_io,
    displayName: "Close",
    tap: "tap-closeio",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_clubspeed,
    displayName: "Club Speed",
    tap: "tap-clubspeed",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: null,
    displayName: "Codat",
    tap: "tap-codat",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_darksky,
    displayName: "Dark Sky",
    tap: "tap-darksky",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_deputy,
    displayName: "Deputy",
    tap: "tap-deputy",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_dynamodb,
    displayName: "Dynamo DB",
    tap: "tap-dynamodb",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_ebay,
    displayName: "Ebay",
    tap: "tap-ebay",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_eloqua,
    displayName: "Eloqua",
    tap: "tap-eloqua",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_exchange_rates_api,
    displayName: "Exchange Rates API",
    tap: "tap-exchangeratesapi",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_facebook_ads,
    displayName: "Facebook Ads",
    tap: "tap-facebook",
    stable: true,
    hasNativeEquivalent: true,
  },
  {
    pic: null,
    displayName: "Freshdesk",
    tap: "tap-freshdesk",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_frontapp,
    displayName: "Front",
    tap: "tap-frontapp",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_fullstory,
    displayName: "FullStory",
    tap: "tap-fullstory",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_github,
    displayName: "GitHub",
    tap: "tap-github",
    parameters: customParameters("tap-github", {
      customConfig: [
        {
          displayName: "Access Token",
          id: "access_token",
          type: stringType,
          required: true,
          documentation: (
            <>
              Access Token. Generate it{" "}
              <a target="_blank" href="https://github.com/settings/tokens">
                here
              </a>
            </>
          ),
        },
        {
          displayName: "Repository",
          id: "repository",
          type: stringType,
          required: true,
          documentation: <>Repository as org/repo such as jitsucom/jitsu</>,
        },
        {
          displayName: "Start Date",
          id: "start_date",
          type: isoUtcDateType,
          defaultValue: "2021-01-01T00:00:00.000Z",
          required: true,
        },
      ],
    }),

    stable: true,
    hasNativeEquivalent: false,
    documentation: githubDocumentation,
  },
  {
    deprecated: true,
    pic: logos.tap_gitlab,
    displayName: "GitLab",
    tap: "tap-gitlab",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_google_ads,
    displayName: "Google Ads (AdWords)",
    tap: "tap-adwords",
    stable: false,
    hasNativeEquivalent: false,
    parameters: customParameters("tap-adwords", {
      customConfig: [
        {
          displayName: "Developer Token",
          id: "developer_token",
          required: true,
          documentation: (
            <>
              API Developer token.{" "}
              <a target="_blank" href="https://services.google.com/fb/forms/newtoken/">
                Apply here
              </a>
            </>
          ),
        },
        {
          displayName: "OAuth Client ID",
          id: "oauth_client_id",
          required: true,
        },
        {
          displayName: "OAuth Client Secret",
          id: "oauth_client_secret",
          required: true,
        },
        {
          displayName: "Refresh Token",
          id: "refresh_token",
          required: true,
        },
        {
          displayName: "Start Date",
          id: "start_date",
          type: isoUtcDateType,
          defaultValue: "2021-01-01T00:00:00.000Z",
          required: true,
        },
        {
          displayName: "User Agent",
          id: "user_agent",
          type: stringType,
          constant: "Jitsu Bot (https://jitsu.com)",
        },
      ],
    }),
  },
  {
    deprecated: true,
    pic: logos.tap_google_search_console,
    displayName: "Google Search Console",
    tap: "tap-google-search-console",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_google_sheets,
    displayName: "Google Sheets",
    tap: "tap-google-sheets",
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters("tap-google-sheets", {
      customConfig: [
        ...googleAuthConfigParameters({
          type: "type",
          clientId: "client_id",
          refreshToken: "refresh_token",
          clientSecret: "client_secret",
          disableServiceAccount: true,
          oauthSecretsRequired: false,
        }),
        {
          displayName: "Google Spreadsheet ID",
          id: "spreadsheet_id",
          type: stringType,
          required: true,
        },
        {
          displayName: "Start Date",
          id: "start_date",
          type: isoUtcDateType,
          defaultValue: "2021-01-01T00:00:00.000Z",
          required: true,
        },
        {
          displayName: "User Agent",
          id: "user_agent",
          type: stringType,
          constant: "Jitsu Bot (https://jitsu.com)",
        },
      ],
    }),
    documentation: googleSheetsDocumentation,
  },
  {
    deprecated: true,
    pic: logos.tap_harvest,
    displayName: "Harvest",
    tap: "tap-harvest",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_harvest_forecast,
    displayName: "Harvest Forecast",
    tap: "tap-harvest-forecast",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_heap,
    displayName: "Heap",
    tap: "tap-heap",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_hubspot,
    displayName: "HubSpot",
    tap: "tap-hubspot",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_ibm_db2,
    displayName: "IBM Db2",
    tap: "tap-db2",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_impact,
    displayName: "Impact",
    tap: "tap-impact",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_intercom,
    displayName: "Intercom",
    tap: "tap-intercom",
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters("tap-intercom", {
      customConfig: [
        {
          displayName: "API Access Token",
          id: "access_token",
          type: stringType,
          required: true,
          documentation: (
            <>
              Intercom API Access Token.{" "}
              <a
                target="_blank"
                href="https://developers.intercom.com/building-apps/docs/authentication-types#section-access-tokens"
              >
                Read how to get it
              </a>
            </>
          ),
        },
        {
          displayName: "Start Date",
          id: "start_date",
          type: isoUtcDateType,
          defaultValue: "2021-01-01T00:00:00.000Z",
          required: true,
        },
        {
          displayName: "User Agent",
          id: "user_agent",
          type: stringType,
          constant: "Jitsu Bot (https://jitsu.com)",
        },
      ],
    }),
    documentation: intercomDocumentation,
  },
  {
    pic: logos.tap_invoiced,
    displayName: "Invoiced",
    tap: "tap-invoiced",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_jira,
    displayName: "Jira",
    tap: "tap-jira",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_klaviyo,
    displayName: "Klaviyo",
    tap: "tap-klaviyo",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_kustomer,
    displayName: "Kustomer",
    tap: "tap-kustomer",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_lever,
    displayName: "Lever",
    tap: "tap-lever",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_linkedin_ads,
    displayName: "LinkedIn Ads",
    tap: "tap-linkedin-ads",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_listrak,
    displayName: "Listrak",
    tap: "tap-listrak",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_liveperson,
    displayName: "LivePerson",
    tap: "tap-liveperson",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_LookML,
    displayName: "LookML",
    tap: "tap-LookML",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_looker,
    displayName: "Looker",
    tap: "tap-looker",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_mailshake,
    displayName: "Mailshake",
    tap: "tap-mailshake",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_mambu,
    displayName: "Mambu",
    tap: "tap-mambu",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_marketo,
    displayName: "Marketo",
    tap: "tap-marketo",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_mixpanel,
    displayName: "Mixpanel",
    tap: "tap-mixpanel",
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters("tap-mixpanel", {
      customConfig: [
        {
          displayName: "API Secret",
          id: "api_secret",
          type: stringType,
          required: true,
          documentation: <>MixPanel API Secret. Obtain it in MixPanel UI project settings.</>,
        },
        {
          displayName: "Date Window Size",
          id: "date_window_size",
          type: intType,
          required: true,
          defaultValue: 30,
          documentation: (
            <>
              Number of days for date window looping through transactional endpoints with from_date and to_date. Clients
              with large volumes of events may want to decrease this to 14, 7, or even down to 1-2 days.
            </>
          ),
        },
        {
          displayName: "Attribution Window",
          id: "attribution_window",
          type: intType,
          required: true,
          defaultValue: 5,
          documentation: (
            <>Latency minimum number of days to look-back to account for delays in attributing accurate results.</>
          ),
        },
        {
          displayName: "Project Timezone",
          id: "project_timezone",
          type: stringType,
          required: true,
          defaultValue: "UTC",
          documentation: (
            <>
              Time zone in which integer date times are stored. The project timezone may be found in the project
              settings in the Mixpanel console.{" "}
              <a
                target="_blank"
                href="https://help.mixpanel.com/hc/en-us/articles/115004547203-Manage-Timezones-for-Projects-in-Mixpanel"
              >
                More info about timezones
              </a>
              .
            </>
          ),
        },
        {
          displayName: "Select properties by default",
          id: "select_properties_by_default",
          type: booleanType,
          defaultValue: true,
          required: true,
          documentation: (
            <>
              Setting this config parameter to true ensures that new properties on events and engage records are
              captured. Otherwise new properties will be ignored.
            </>
          ),
        },
        {
          displayName: "Start Date",
          id: "start_date",
          type: isoUtcDateType,
          defaultValue: "2021-01-01T00:00:00.000Z",
          required: true,
        },
        {
          displayName: "User Agent",
          id: "user_agent",
          type: stringType,
          constant: "Jitsu Bot (https://jitsu.com)",
        },
      ],
    }),
    documentation: mixpanelDocumentation,
  },
  {
    pic: logos.tap_onfleet,
    displayName: "Onfleet",
    tap: "tap-onfleet",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_oracle,
    displayName: "Oracle",
    tap: "tap-oracle",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_outbrain,
    displayName: "Outbrain",
    tap: "tap-outbrain",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_outreach,
    displayName: "Outreach",
    tap: "tap-outreach",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_pardot,
    displayName: "Pardot",
    tap: "tap-pardot",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_pendo,
    displayName: "Pendo",
    tap: "tap-pendo",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: null,
    displayName: "Pepperjam",
    tap: "tap-pepperjam",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_pipedrive,
    displayName: "Pipedrive",
    tap: "tap-pipedrive",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_platform_purple,
    displayName: "Platform Purple",
    tap: "tap-platformpurple",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_postgresql,
    displayName: "PostgreSQL",
    tap: "tap-postgres",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_mysql,
    displayName: "MySQL",
    tap: "tap-mysql",
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters("tap-mysql", {
      customConfig: [
        {
          id: "host",
          displayName: "Host",
          type: stringType,
          required: true,
        },
        {
          id: "port",
          displayName: "Port",
          type: intType,
          required: true,
          defaultValue: 3306,
        },
        {
          id: "user",
          displayName: "Username",
          type: stringType,
          required: true,
        },
        {
          id: "password",
          displayName: "Password",
          type: passwordType,
          required: true,
        },
      ],
    }),
    documentation: mySqlDocumentation,
  },
  {
    pic: logos.tap_quick_base,
    displayName: "Quick Base",
    tap: "tap-quickbase",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: null,
    displayName: "Recharge",
    tap: "tap-recharge",
    stable: false,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_recurly,
    displayName: "Recurly",
    tap: "tap-recurly",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_referral_saasquatch,
    displayName: "Referral SaaSquatch",
    tap: "tap-referral-saasquatch",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_responsys,
    displayName: "Responsys",
    tap: "tap-responsys",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_revinate,
    displayName: "Revinate",
    tap: "tap-revinate",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_sftp,
    displayName: "SFTP",
    tap: "tap-sftp",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_saasoptics,
    displayName: "SaaSOptics",
    tap: "tap-saasoptics",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_salesforce,
    displayName: "Salesforce",
    tap: "tap-salesforce",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_salesforce_marketing_cloud,
    displayName: "Salesforce Marketing Cloud",
    tap: "tap-exacttarget",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_selligent,
    displayName: "Selligent",
    tap: "tap-selligent",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_sendgrid_core,
    displayName: "SendGrid Core",
    tap: "tap-sendgrid",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_shiphero,
    displayName: "ShipHero",
    tap: "tap-shiphero",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_shippo,
    displayName: "Shippo",
    tap: "tap-shippo",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_shopify,
    displayName: "Shopify",
    tap: "tap-shopify",
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters("tap-shopify", {
      customConfig: [
        {
          displayName: "API Key",
          id: "api_key",
          type: stringType,
          required: true,
          documentation: (
            <>
              Read more about{" "}
              <a target="_blank" href="https://shopify.dev/tutorials/generate-api-credentials">
                How to obtain API Key
              </a>
            </>
          ),
        },
        {
          displayName: "Start Date",
          id: "start_date",
          required: true,
          type: dashDateType,
          defaultValue: "2018-01-01",
        },
        {
          displayName: "Shop",
          id: "shop",
          type: stringType,
          required: true,
          documentation: (
            <>
              Name of your Shopify shop from URL: https://{"<YOUR_SHOP_NAME>"}
              .myshopify.com
            </>
          ),
        },
      ],
    }),
    documentation: shopifyDocumentation,
  },
  {
    deprecated: true,
    pic: logos.tap_slack,
    displayName: "Slack",
    tap: "tap-slack",
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters("tap-slack", {
      customConfig: [
        {
          displayName: "Access Token",
          id: "token",
          type: stringType,
          required: true,
          documentation: (
            <>
              You can obtain a token for a single workspace by creating a new{" "}
              <a target="_blank" href="https://api.slack.com/apps?new_app=1">
                Slack App
              </a>{" "}
              in your workspace and assigning it the relevant{" "}
              <a target="_blank" href="https://api.slack.com/docs/oauth-scopes">
                scopes
              </a>
              . As of right now, the minimum required scopes for this App are: channels:history, channels:join,
              channels:read, files:read, groups:read, reactions:read, remote_files:read, team:read, usergroups:read,
              users.profile:read, users:read, users:read.email
            </>
          ),
        },
        {
          displayName: "Start Date",
          id: "start_date",
          required: true,
          type: isoUtcDateType,
          defaultValue: "2021-01-01T00:00:00.000Z",
        },
        {
          displayName: "Exclude Archive Channels",
          id: "exclude_archived",
          type: booleanType,
          defaultValue: false,
        },
        {
          displayName: "Join Public Channels",
          id: "join_public_channels",
          type: booleanType,
          defaultValue: false,
        },
        {
          displayName: "Join Private Channels",
          id: "private_channels",
          type: booleanType,
          defaultValue: false,
        },
      ],
    }),
    documentation: slackDocumentation,
  },
  // {
  //     pic: logos.tap_square,
  //     displayName: "Square",
  //     tap: "tap-square",
  //     stable: true,
  //     hasNativeEquivalent: false
  // },
  {
    deprecated: true,
    pic: logos.tap_stripe,
    displayName: "Stripe",
    tap: "tap-stripe",
    stable: true,
    hasNativeEquivalent: false,
    parameters: customParameters("tap-stripe", {
      customConfig: [
        {
          displayName: "Client Secret",
          id: "client_secret",
          type: stringType,
          required: true,
          documentation: <>Client secret ('sk_live_....')</>,
        },
        {
          displayName: "Account ID",
          id: "account_id",
          type: stringType,
          required: true,
          documentation: <>Account ID ('acct_....')</>,
        },
        {
          displayName: "Start Date",
          id: "start_date",
          type: isoUtcDateType,
          required: true,
          defaultValue: "2021-01-01T00:00:00.000Z",
          documentation: <>Jitsu will sync Stipe data since Start Date</>,
        },
      ],
    }),
    documentation: stripeDocumentation,
  },
  {
    deprecated: true,
    pic: logos.tap_surveymonkey,
    displayName: "SurveyMonkey",
    tap: "tap-surveymonkey",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_taboola,
    displayName: "Taboola",
    tap: "tap-taboola",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_toggl,
    displayName: "Toggl",
    tap: "tap-toggl",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_trello,
    displayName: "Trello",
    tap: "tap-trello",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_typeform,
    displayName: "Typeform",
    tap: "tap-typeform",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_urban_airship,
    displayName: "Urban Airship",
    tap: "tap-urban-airship",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_uservoice,
    displayName: "Uservoice",
    tap: "tap-uservoice",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_wootric,
    displayName: "Wootric",
    tap: "tap-wootric",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_workday_raas,
    displayName: "Workday RaaS",
    tap: "tap-workday-raas",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_xero,
    displayName: "Xero",
    tap: "tap-xero",
    // parameters: customParameters("tap-xero", {
    //   customConfig: [
    //     {
    //       displayName: "Client ID",
    //       id: "client_id",
    //       type: oauthSecretType,
    //       required: true
    //     },
    //     {
    //       displayName: "Client Secret",
    //       id: "client_secret",
    //       type: oauthSecretType,
    //       required: true
    //     },
    //     {
    //       displayName: "Refresh Token",
    //       id: "refresh_token",
    //       type: stringType,
    //       required: true
    //     },
    //     {
    //       displayName: "Tenant ID (ID of organization)",
    //       id: "tenant_id",
    //       type: stringType,
    //       required: true
    //     },
    //     {
    //       displayName: "Start Date",
    //       id: "start_date",
    //       type: isoUtcDateType,
    //       defaultValue: "2018-01-01T00:00:00.000Z",
    //       required: true,
    //     },
    //   ],
    // }),
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_yotpo,
    displayName: "Yotpo",
    tap: "tap-yotpo",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_zendesk_chat,
    displayName: "Zendesk Chat",
    tap: "tap-zendesk-chat",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_zendesk_support,
    displayName: "Zendesk Support",
    tap: "tap-zendesk",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_zoom,
    displayName: "Zoom",
    tap: "tap-zoom",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    deprecated: true,
    pic: logos.tap_zuora,
    displayName: "Zuora",
    tap: "tap-zuora",
    stable: true,
    hasNativeEquivalent: false,
  },
  {
    pic: logos.tap_ilevel,
    displayName: "iLEVEL",
    tap: "tap-ilevel",
    stable: true,
    hasNativeEquivalent: false,
  },
]
