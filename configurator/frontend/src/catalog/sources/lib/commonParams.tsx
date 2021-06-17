import { jsonType, Parameter, selectionType, stringType } from './../types';
import * as React from 'react';

const oauthParamDocumentation = <>
  Use <a href="https://github.com/jitsucom/oauthcli">Jitsu OAuth CLI Util</a> to obtain oauth credentials
</>;

export type GoogleParametersNodes = {
  clientId?: string,
  clientSecret?: string,
  refreshToken?: string,
  type?: string
  disableOauth?: boolean
  disableServiceAccount?: boolean,
  serviceAccountKey?: string
}

/**
 * If props is ['a', 'b', 'c'] (or 'a.b.c'), result is the equivalent to obj?.a?.b?.c
 */
function resolve(obj: any, props: string[] | string) {
  return (typeof props === 'string' ? props.split('.') : props as string[])
    .reduce((current, prop) => current ? current[prop] : undefined, obj);
}

function removeNulls(arr: any[]) {
  return arr.filter(el => !!el);
}

export const googleAuthConfigParameters: (param?: GoogleParametersNodes) => Parameter[] = ({
  clientId = 'config.auth.client_id',
  clientSecret = 'config.auth.client_secret',
  refreshToken = 'config.auth.refresh_token',
  type = 'config.auth.type',
  disableOauth = false,
  disableServiceAccount = false,
  serviceAccountKey = 'config.auth.service_account_key'
}: GoogleParametersNodes = {}) => removeNulls([
  {
    displayName: 'Authorization Type',
    id: type,
    type: selectionType(removeNulls([ !disableOauth && 'OAuth', !disableServiceAccount && 'Service Account'] ), 1),
    required: true,
    defaultValue: removeNulls([ !disableOauth && 'OAuth', !disableServiceAccount && 'Service Account'] )[0],
    documentation:
      <>
        Jitsu provides two types for authorizing access to Google Services:
        <ul>
          <li><b>OAuth</b> — you'll need to provide Client Secret / Client Id (you can obtain in in Google Cloud Console) and get a refresh token. Jitsu developed
            a small <a href="https://github.com/jitsucom/oauthcli">CLI utility to obtain those tokens</a></li>
          <li><b>Service Account</b> — you'll a) <a href="https://cloud.google.com/iam/docs/creating-managing-service-account-keys">create a service account in Google Cloud Console</a>
            {' '} b) share google resource (such as ocument or analytics property) with this account (account email look like <code>[username]@jitsu-customers.iam.gserviceaccount.com</code>) c)
            {' '} put Service Account Key JSON (available in Google Cloud Console) in the field below</li>
        </ul>
      </>
  },
  !disableOauth && {
    displayName: 'OAuth Client ID',
    id: clientId,
    type: stringType,
    constant: (config) => {
      //hack to make it work for singer based sources (which prefixes all fields with config. later on)
      let typeResolved = resolve(config, type) || resolve(config, 'config.config.' + type);
      return typeResolved  !== 'OAuth' ? '' : undefined
    },
    required: true,
    documentation: oauthParamDocumentation
  },
  !disableOauth && {
    displayName: 'OAuth Client Secret',
    id: clientSecret,
    type: stringType,
    constant: (config) => {
      //hack to make it work for singer based sources (which prefixes all fields with config. later on)
      let typeResolved = resolve(config, type) || resolve(config, 'config.config.' + type);
      return typeResolved !== 'OAuth' ? '' : undefined;
    },
    required: true,
    documentation: oauthParamDocumentation
  },
  !disableOauth && {
    displayName: 'Refresh Token',
    id: refreshToken,
    type: stringType,
    constant: (config) => {
      //hack to make it work for singer based sources (which prefixes all fields with config. later on)
      let typeResolved = resolve(config, type) || resolve(config, 'config.config.' + type);
      return typeResolved !== 'OAuth' ? '' : undefined;
    },
    required: true,
    documentation: oauthParamDocumentation
  },
  !disableServiceAccount && {
    displayName: 'Auth (Service account key JSON)',
    id: serviceAccountKey,
    type: jsonType,
    constant: (config) => {
      //hack to make it work for singer based sources (which prefixes all fields with config. later on)
      let typeResolved = resolve(config, type) || resolve(config, 'config.config.' + type);
      return typeResolved !== 'Service Account' ? null : undefined;
    },
    required: true,
    documentation:
      <>
        <a href="https://cloud.google.com/iam/docs/creating-managing-service-account-keys">Use Google Cloud Console to create Service Account get Service Key JSON</a>
      </>
  }
]);
