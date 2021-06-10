import * as React from 'react';

export const googleProjectCreation = <>
  At first, create or select Google project:
  <ul>
    <li>Go to the <a href="https://console.developers.google.com/">API Console page</a></li>
    <li>Click "Select Project" if you have already had a project or click "Create Project" if not</li>
  </ul>

  Read more about <a href="https://support.google.com/googleapi/answer/6251787?hl=en#zippy=%2Ccreate-a-project">How to create Google project</a>
</>

export const googleServiceAccountJSONDocumentation = <>
  Service Account is an Google authorization object with configurable permissions to different Google services and APIs.

  <h3>Getting Started</h3>
  {googleProjectCreation}
  Then create a new Google Service Account:
  <ul>
    <li>Go to the <a href="https://console.developers.google.com/iam-admin/serviceaccounts">Service Accounts page</a></li>
    <li>Click "+ Create Service Account"</li>
    <li>Give a clear name (How Service Account will be used. for example: "jitsu-integration")</li>
    <li>Click "Done"</li>
    <li>Click on created row in Service Accounts table</li>
    <li>Go to "KEYS" tab</li>
    <li>Click "ADD KEY" {'->'} "Create new key" {'->'} Select JSON {'->'} "CREATE"</li>
    <li>Service Account JSON (private key) will be in downloaded file</li>
  </ul>

    Read more about <a href="https://cloud.google.com/iam/docs/creating-managing-service-accounts">Managing Google Service Accounts</a>
</>

export const googleOAuthDocumentation = <>
  Google APIs use the <a href="https://tools.ietf.org/html/rfc6749">OAuth 2.0 protocol</a> for authentication and authorization.
  Jitsu uses 3 parameters for using Google APIs:
  <ul>
    <li><b>client_id</b> - An unique client identifier that is obtained from Google UI</li>
    <li><b>client_secret</b> - A client secret string that is obtained from Google UI</li>
    <li><b>refresh_token</b> - Generated token from <a href="https://github.com/jitsucom/oauthcli">jitsucom/oauthcli</a> script (see below)</li>
  </ul>

  <h3>Getting Started</h3>
  {googleProjectCreation}
  Then create a new Google OAuth Credentials:
  <ul>
    <li>Go to the <a href="https://console.cloud.google.com/apis/credentials">API Credentials page</a></li>
    <li>Click "+ Create Credentials" {'->'} "OAuth client ID"</li>
    <li>Note: If you haven't configured OAuth Consent Screen yet, Google asks to configure it.</li>
    <li>Configuring Consent Screen: Click "Configure Consent Screen" {'->'} Select "External" and click "Create"</li>
    <li>Configuring Consent Screen: Set App name, User support email, Developer contact email address and click "Save and Continue" 3 times</li>
    <li>Configuring Consent Screen: Click "Publish app" and get back to <a href="https://console.cloud.google.com/apis/credentials">API Credentials page</a> and Click "+ Create Credentials" {'->'} "OAuth client ID"</li>
    <li>Select Application type "Desktop app" and clear name (for example "jitsu-integration")</li>
    <li>Save Client ID and Client Secret parameters</li>
    <li>Generate a refresh token with <a href="https://github.com/jitsucom/oauthcli">jitsucom/oauthcli</a> script with right scopes (see below)</li>
  </ul>
</>

export function getOauthCliDocumentation(...scope: string[]) {
  let scopes = []
  scopes = scopes.concat(scope)
  let scopesStr = `'${scopes.join(' ')}'`;
  return <>
    Obtain Google refresh token with Jitsu CLI tool:
    <ul>
      <li>Open terminal</li>
      <li>Run git clone: "git clone https://github.com/jitsucom/oauthcli.git"</li>
      <li>cd oauthcli</li>
      <li>Install dependencies: "pip3 install -r requirements.txt"</li>
      <li>Run CLI: "./authorizer.py --client_id={'<YOUR CLIENT ID>'} --client_secret={'<YOUR CLIENT SECRET>'} --scope={scopesStr}"</li>
      <li>You will be redirected to selecting Google Account page. Select account that has access to Google Service/API to sync data with</li>
      <li>Click "Allow"</li>
      <li>Save "refresh_token" value from the final page</li>
    </ul>
  </>
}

export function getEnableGoogleAPIDocumentation(...service: string[]) {
  let services = []
  for (const [index, value] of service.entries()) {
    services.push(<li>Find {value}, click on it and click "Enable"</li>)
  }
  return <>
    Enable Google API for your Google project:
    <ul>
      <li>Go to the <a href="https://console.cloud.google.com/apis/library">Google APIs Library page</a></li>
      {services}
    </ul>
  </>
}