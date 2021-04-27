// @Libs
import React, { ExoticComponent, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
// @Routes
import { sourcesPageRoutes } from '@page/SourcesPage/routes';
import { destinationPageRoutes } from '@page/DestinationsPage/DestinationsPage.routes';
// @???
import ComponentTest from './lib/components/componentTest';
// @Components
const ApiKeys = React.lazy(() => import('./lib/components/ApiKeys/ApiKeys'));
const CustomDomains = React.lazy(() => import('./lib/components/CustomDomains/CustomDomains'));
const DestinationsPage = React.lazy(() => import('@page/DestinationsPage/DestinationsPage'));
const EventsStream = React.lazy(() => import('./lib/components/EventsStream/EventsStream'));
const LoginForm = React.lazy(() => import('./lib/components/LoginForm/LoginForm'));
const SetupForm = React.lazy(() => import('@page/SetupPage/SetupForm'));
const SignupForm = React.lazy(() => import('./lib/components/SignupForm/SignupForm'));
const SourcesPage = React.lazy(() => import('./ui/pages/SourcesPage'));
const StatusPage = React.lazy(() => import('./lib/components/StatusPage/StatusPage'));
const PasswordForm = React.lazy(() => import('./lib/components/PasswordForm/PasswordForm'));
const DownloadConfig = React.lazy(() => import('./lib/components/DownloadConfig/DownloadConfig'));

export type PageLocation = {
  canonicalPath: string
  id: string
}

export function usePageLocation(): PageLocation {
  const location = useLocation().pathname;

  let canonicalPath = location === '/' || location === '' ?
    'dashboard' :
    location;

  let id = (canonicalPath.startsWith('/')
    ? canonicalPath.substr(1)
    : canonicalPath).replace('/', '');

  return { canonicalPath, id }
}

export type PageProps = {
  setBreadcrumbs?: (header: ReactNode) => void,
  [propName: string]: any
}

export class Page {
  readonly _component: ExoticComponent | React.Component | React.FC;

  readonly pageTitle: string;

  readonly path: string[];

  readonly pageHeader: React.ReactNode;

  readonly doNotWrap: boolean;

  public getPrefixedPath(): string[] {
    return this.path.map((el) => el.startsWith('/') ? el : '/' + el);
  }

  constructor(
    pageTitle: string,
    path: string[] | string,
    component: ExoticComponent | React.Component | React.FC,
    pageHeader?: ReactNode,
    doNotWrap?: boolean
  ) {
    this._component = component;
    this.pageTitle = pageTitle;
    this.pageHeader = pageHeader;
    this.path = path instanceof Array ? path : [path];
    this.doNotWrap = doNotWrap;
  }

  get component(): React.ExoticComponent | React.Component | React.FC {
    return this._component;
  }
}

export const SELFHOSTED_PAGES: Page[] = [new Page('Jitsu | setup', ['/', '/setup'], SetupForm)];

export const PUBLIC_PAGES: Page[] = [
  new Page('Jitsu | login', ['/', '/dashboard', '/login'], LoginForm),
  new Page('Jitsu | register', ['/register'], SignupForm),
  new Page('Jitsu | reset wpassword', ['/reset_password/:resetId'], PasswordForm)
];
export const PRIVATE_PAGES: Page[] = [
  new Page('Test Component', '/test', ComponentTest, 'Component Test'),
  new Page('Jitsu | recent events', '/events_stream', EventsStream, 'Recent events'),
  new Page('Jitsu | dashboard', ['/dashboard', ''], StatusPage, 'Dashboard'),
  new Page(
    'Jitsu | edit destinations',
    Object.keys(destinationPageRoutes).map((key) => destinationPageRoutes[key]),
    DestinationsPage,
    'Edit destinations'
  ),
  new Page(
    'Jitsu | download config',
    '/cfg_download',
    DownloadConfig,
    'Download Jitsu Server configuration'
  ),
  new Page('Jitsu | edit API keys', '/api_keys', ApiKeys, 'API Keys'),
  new Page(
    'Jitsu | edit custom domains',
    '/domains',
    CustomDomains,
    'Custom tracking domains'
  ),
  new Page('Jitsu | reset password', ['/reset_password/:resetId'], PasswordForm, '', true),
  new Page(
    'Jitsu | sources',
    Object.keys(sourcesPageRoutes).map((key) => sourcesPageRoutes[key]),
    SourcesPage,
    'Sources'
  )
];
