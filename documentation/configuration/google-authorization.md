import {CodeInTabs, CodeTab} from "../../../components/Code";
import {Hint} from '../../../components/documentationComponents'

# Google Authorization

This page about Google Authorization configuration.
EventNative works with a number of services provided by Google. They all have the same authorization mechanics. You could use one of the following

* **Service Account** is a special account with id that look like [NAME@PROJECT.iam.gserviceaccount.com](https://console.cloud.google.com/iam-admin/serviceaccounts/details/107095565645971338726?project=exalted-cogency-279115). The account can have a key \(or several keys\) which is represented by JSON. Please note, to use Service Account as an authorization mechanism, the resource \(google doc, analytics account, add account etc\) should be shared with that account
* **OAuth2** is a mechanism for running a user-initiated auth

<Hint>
    If EventNative is configured manually, <b>Service Account</b> is the best way to do auth. If the config is generated and end-users grants access to the resource, it's better to use <b>OAuth</b>
</Hint>

<CodeInTabs>
    <CodeTab title="Service Account authorization" lang="yaml">
        {`
       sources:
  google_analytics:
    config:
      auth:
               service_account_key: {
                 "type": "service_account",
                 "project_id": "<PROJECT_ID>",
                 "private_key_id": "<PK_ID>",
                 "private_key": "<PRIVATE_KEY>",
                 "client_email": "<EMAIL>",
                 "client_id": "CID",
                 "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                 "token_uri": "https://oauth2.googleapis.com/token",
                 "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                 "client_x509_cert_url": "<CERT_URL>"
               }
        `}
    </CodeTab>
    <CodeTab title="OAuth2 authorization" lang="yaml">
        {`
       sources:
  google_play:
    config:
      auth:
               client_id: <CLIENT_ID>
               client_secret: <CLIENT_SECRET>
               refresh_token: <REFRESH_TOKEN>
        `}
    </CodeTab>
</CodeInTabs>


| Parameter | Description |
| :--- | :--- |
| `client_id` | Client ID (see [below](/docs/configuration/google-authorization#oauth2-configuration)) at Google Cloud Platform credentials |
| `client_secret` | Client secret (see [below](/docs/configuration/google-authorization#oauth2-configuration)) at Google Cloud Platform credentials |
| `refresh_token` | A refresh token with access to the required service that was obtained during oauth flow |

### Service account configuration

The easiest way to create Service Account is through [**Google Cloud Console**](https://console.cloud.google.com/)**:** go to Navigation ("burger" at top right corner) → IAM & Admin → Service account. Create service account and download key JSON.

There a few other ways (including console utils), please see [documentation](https://cloud.google.com/iam/docs/creating-managing-service-account-keys)

Service Account key can be referred in a few ways in EventNative configuration:

<CodeInTabs>
    <CodeTab title="As a JSON object" lang="yaml">
        {`
        auth:
  service_account_key: {
    "type": "service_account",
    "project_id": "<PROJECT_ID>",
    "private_key_id": "<PK_ID>",
    "private_key": "<PRIVATE_KEY>",
    "client_email": "<EMAIL>",
    "client_id": "CID",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "<CERT_URL>"
  }
        `}
    </CodeTab>
    <CodeTab title="As a JSON string" lang="yaml">
        {`
        auth:
          service_account_key: '{"type":"service_account","project_id":"<PROJECT_ID>","private_key_id":"<PK_ID>","private_key":"<PRIVATE_KEY>","client_email":"<EMAIL>","client_id":"CID","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"<CERT_URL>"}'
        `}
    </CodeTab>
    <CodeTab title="As a path to file" lang="yaml">
        {`
        auth:
          service_account_key: '/path/to/file.json'
        `}
    </CodeTab>
</CodeInTabs>

### OAuth2 configuration

<Hint>
    Use <a href="https://github.com/jitsucom/oauth-cli">oauth-cli</a> utility to get OAuth tokens for command-line applications
</Hint>

Please see [**Documentation on getting OAuth2 tokens**](https://developers.google.com/identity/protocols/oauth2/web-server#httprest) for Google products \(you need _refresh\_token_ parameter from the last response\). Generally, speaking you'll need to develop an app which handles the oauth flow. However,  you can use [**a small command-line utility we developed**](https://github.com/jitsucom/oauth-cli) to get an access credentials

<Hint>
    Pay attention that refresh tokens may expire on different conditions (see <a href="https://developers.google.com/identity/protocols/oauth2#expiration">documentation</a>). Unlike OAuth2 tokens, service account settings don't expire, so, it's preferable to use the service account keys.
</Hint>