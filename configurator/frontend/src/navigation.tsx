/* eslint-disable */
import React, { ReactElement, ReactNode } from 'react';
import ComponentTest from './lib/components/componentTest';
import DownloadConfig from './lib/components/DownloadConfig/DownloadConfig';

import { routes as sourcesPageRoutes } from '@page/SourcesPage/routes';

const ApiKeys = React.lazy(() => import('./lib/components/ApiKeys/ApiKeys'));
const CustomDomains = React.lazy(() => import('./lib/components/CustomDomains/CustomDomains'));
const DestinationsList = React.lazy(() => import('./lib/components/DestinationsEditor/DestinationsList'));
const EventsStream = React.lazy(() => import('./lib/components/EventsStream/EventsStream'));
const LoginForm = React.lazy(() => import('./lib/components/LoginForm/LoginForm'));
const SetupForm = React.lazy(() => import('@page/SetupPage/SetupForm'));
const SignupForm = React.lazy(() => import('./lib/components/SignupForm/SignupForm'));
const SourcesPage = React.lazy(() => import('./ui/pages/SourcesPage'));
const StatusPage = React.lazy(() => import('./lib/components/StatusPage/StatusPage'));
const PasswordForm = React.lazy(() => import('./lib/components/PasswordForm/PasswordForm'));

export class Page {
  componentFactory: (props: any) => ReactElement;
  pageTitle: string;
  path: string[];
  pageHeader: React.ReactNode;
  doNotWrap: boolean;

  public getPrefixedPath(): string[] {
    return this.path.map((el) => (el.startsWith('/') ? el : '/' + el));
  }

  public get id() {
    let firstPath = this.path.find((p) => p && p.length > 0);
    if (!firstPath) {
      firstPath = 'root';
    }
    return firstPath.replace('/', '');
  }

  public getComponent(props?: any): ReactNode {
    return this.componentFactory(props || {});
  }

  constructor(
    pageTitle: string,
    path: string[] | string,
    component: (props: any) => ReactElement,
    pageHeader?: ReactNode,
    doNotWrap?: boolean
  ) {
    this.componentFactory = component;
    this.pageTitle = pageTitle;
    this.pageHeader = pageHeader;
    this.path = path instanceof Array ? path : [path];
    this.doNotWrap = doNotWrap;
  }
}

export const SELFHOSTED_PAGES: Page[] = [new Page('Jitsu | setup', ['/', '/setup'], () => <SetupForm />)];

export const PUBLIC_PAGES: Page[] = [
  new Page('Jitsu | login', ['/', '/dashboard', '/login'], () => <LoginForm />),
  new Page('Jitsu | register', ['/register'], () => <SignupForm />),
  new Page('Jitsu | reset wpassword', ['/reset_password/:resetId'], (props) => <PasswordForm {...props} />)
];
export const PRIVATE_PAGES: Page[] = [
  new Page('Test Component', '/test', (props) => <ComponentTest {...props} />, 'Component Test'),
  new Page('Jitsu | recent events', '/events_stream', (props) => <EventsStream {...props} />, 'Recent events'),
  new Page('Jitsu | dashboard', ['/dashboard', ''], (props) => <StatusPage {...props} />, 'Dashboard'),
  new Page(
      'Jitsu | edit destinations',
      '/destinations',
      (props) => <DestinationsList {...props} />,
      'Edit destinations'
  ),
  new Page(
    'Jitsu | download config',
    '/cfg_download',
    (props) => <DownloadConfig {...props} />,
    'Download Jitsu Server configuration'
  ),
  new Page('Jitsu | edit API keys', '/api_keys', (props) => <ApiKeys {...props} />, 'API Keys'),
  new Page(
    'Jitsu | edit custom domains',
    '/domains',
    (props) => <CustomDomains {...props} />,
    'Custom tracking domains'
  ),
  new Page('Jitsu | reset password', ['/reset_password/:resetId'], (props) => <PasswordForm {...props} />, '', true),
  new Page(
    'Jitsu | sources',
    Object.keys(sourcesPageRoutes).map((key) => sourcesPageRoutes[key]),
    (props) => <SourcesPage {...props} />,
    'Sources'
  )
];
