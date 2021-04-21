// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Button, Col, Dropdown, Layout, Menu, message, Modal, Row, Tooltip } from 'antd';
import AreaChartOutlined from '@ant-design/icons/lib/icons/AreaChartOutlined';
import { NavLink } from 'react-router-dom';
import UnlockOutlined from '@ant-design/icons/lib/icons/UnlockOutlined';
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';
import NotificationOutlined from '@ant-design/icons/lib/icons/NotificationOutlined';
import CloudOutlined from '@ant-design/icons/lib/icons/CloudOutlined';
import DownloadOutlined from '@ant-design/icons/lib/icons/DownloadOutlined';
import * as React from 'react';

import { useLocation } from 'react-router-dom';
import Icon from '@ant-design/icons';
import logo from '@./icons/logo.svg';
import PapercupsWrapper from '@./lib/commons/papercups';
import WechatOutlined from '@ant-design/icons/lib/icons/WechatOutlined';
import { Align, handleError } from '@./lib/components/components';
import UserOutlined from '@ant-design/icons/lib/icons/UserOutlined';
import classNames from 'classnames';
import { memo, ReactNode, useState } from 'react';
import { Permission, User } from '@service/model';
import SlidersOutlined from '@ant-design/icons/lib/icons/SlidersOutlined';
import UserSwitchOutlined from '@ant-design/icons/lib/icons/UserSwitchOutlined';
import LogoutOutlined from '@ant-design/icons/lib/icons/LogoutOutlined';
import { reloadPage } from '@./lib/commons/utils';
import { useServices } from '@hooks/useServices';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
import { Page, usePageLocation } from '@./navigation';
import { BreadcrumbsProps, withHome } from '@molecule/Breadcrumbs/Breadcrumbs.types';
import { Breadcrumbs } from '@molecule/Breadcrumbs';

export const ApplicationMenu: React.FC<{}> = () => {
  const location = usePageLocation().canonicalPath;
  const services = useServices();

  let key = location === '/' || location === '' ?
    'dashboard' :
    location;

  if (key.charAt(0) === '/') {
    key = key.substr(1);
  }
  return <Menu selectable={false} focusable={false} mode="inline" selectedKeys={[key]} className="app-layout-sidebar-menu">
    <Menu.Item key="dashboard" icon={<AreaChartOutlined/>}>
      <NavLink to="/dashboard" activeClassName="selected">
        Dashboard
      </NavLink>
    </Menu.Item>
    <Menu.Item key="api_keys" icon={<UnlockOutlined/>}>
      <NavLink to="/api_keys" activeClassName="selected">
        Events API
      </NavLink>
    </Menu.Item>
    <Menu.Item key="sources" icon={<ApiOutlined/>}>
      <NavLink to="/sources" activeClassName="selected">
        Connectors
      </NavLink>
    </Menu.Item>
    <Menu.Item key="destinations" icon={<NotificationOutlined/>}>
      <NavLink to="/destinations" activeClassName="selected">
        Destinations
      </NavLink>
    </Menu.Item>
    {services.features.enableCustomDomains && <Menu.Item key="domains" icon={<CloudOutlined/>}>
      <NavLink to="/domains" activeClassName="selected">
        Tracking Domains
      </NavLink>
    </Menu.Item>}
    <Menu.Item key="cfg_download" icon={<DownloadOutlined/>}>
      <NavLink to="/cfg_download" activeClassName="selected">
        Generate Config
      </NavLink>
    </Menu.Item>
  </Menu>
}

export const ApplicationSidebar: React.FC<{}> = () => {
  return <Layout.Sider key="sider" className="app-layout-side-bar">
    <div className="app-layout-side-bar-top">
      <a className="app-logo-wrapper" href="https://jitsu.com">
        <img className="app-logo" src={logo} alt="[logo]"/>
      </a>
      <ApplicationMenu/>
    </div>
    <div className="app-layout-side-bar-bottom">
      <a className="app-layout-side-bar-bottom-item"
        onClick={() => {
          PapercupsWrapper.focusWidget();
        }}><WechatOutlined/> Chat with us!
      </a>
    </div>
  </Layout.Sider>
}

export type PageHeaderProps = {
  user: User
}

export const PageHeader: React.FC<PageHeaderProps> = ({ user, children }) => {

  return <Row className="internal-page-header-container">
    <Col span={12}>
      <div className="h-12 flex items-center">
        {children}
      </div>
    </Col>
    <Col span={12}>
      <Align horizontal="right">
        <Dropdown trigger={['click']} overlay={<DropdownMenu user={user} />}>
          <Button className={'user-drop-down-button'} icon={<UserOutlined/>}>
            {user.name}
          </Button>
        </Dropdown>
      </Align>
    </Col>
  </Row>
}

export const DropdownMenu: React.FC<{user: User}> = ({ user }) => {
  const services = useServices();
  return (
    <div>
      <div className="user-dropdown-info-panel">{user.email}</div>
      <Menu selectable={false}>
        <Menu.Item key="profile" icon={<SlidersOutlined/>} onClick={() => {
          Modal.confirm({
            title: 'Password reset',
            icon: <ExclamationCircleOutlined/>,
            content: 'Please confirm password reset. Instructions will be sent to your email',
            okText: 'Reset password',
            cancelText: 'Cancel',
            onOk: async() => {
              try {
                await services.userService.sendPasswordReset()
                message.info('Reset password instructions has been sent. Please, check your mailbox')
              } catch (error) {
                message.error("Can't reset password: " + error.message);
                console.log("Can't reset password", error);
              }
            },
            onCancel: () => {
            }
          });
        }}>
          Reset Password
        </Menu.Item>
        {services.userService.getUser().hasPermission(Permission.BECOME_OTHER_USER) && <Menu.Item key="become" icon={<UserSwitchOutlined/>} onClick={async() => {
          let email = prompt('Please enter e-mail of the user', '');
          if (!email) {
            return;
          }
          try {
            await services.userService.becomeUser(email);
          } catch (e) {
            handleError(e, "Can't login as other user");
          }
        }}>Become User</Menu.Item>
        }
        <Menu.Item
          key="logout"
          icon={<LogoutOutlined/>}
          onClick={() => services.userService.removeAuth(reloadPage)
          }>Logout</Menu.Item>
      </Menu>
    </div>
  );
}

export type ApplicationPageWrapperProps = {
  page: Page
  user: User
  [propName: string]: any
}

export const ApplicationPageWrapper: React.FC<ApplicationPageWrapperProps> = ({ page, user, ...rest }) => {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbsProps>(withHome({ elements: [{ title: page.pageHeader }] }));
  const pageId = usePageLocation().id;

  let Component = page.component as React.ExoticComponent;
  let props = { setBreadcrumbs }
  return <>
    <ApplicationSidebar />
    <Layout.Content key="content" className="app-layout-content">
      <div className={classNames('internal-page-wrapper', 'page-' + pageId + '-wrapper')}>
        <PageHeader user={user}><Breadcrumbs {...breadcrumbs} /></PageHeader>
        <div className="internal-page-content-wrapper">
          <Component {...(props as any)} />
        </div>
      </div>
    </Layout.Content>
  </>;
}

export const SlackChatWidget: React.FC<{}> = () => {
  const icon = <Icon component={() => <svg fill="currentColor"  width="1em" height="1em" viewBox="0 0 24 24">
    <path d="M 4 3 C 2.9 3 2 3.9 2 5 L 2 15.792969 C 2 16.237969 2.5385156 16.461484 2.8535156 16.146484 L 5 14 L 14 14 C 15.1 14 16 13.1 16 12 L 16 5 C 16 3.9 15.1 3 14 3 L 4 3 z M 18 8 L 18 12 C 18 14.209 16.209 16 14 16 L 8 16 L 8 17 C 8 18.1 8.9 19 10 19 L 19 19 L 21.146484 21.146484 C 21.461484 21.461484 22 21.237969 22 20.792969 L 22 10 C 22 8.9 21.1 8 20 8 L 18 8 z"/>
  </svg>} />;
  return <div className="fixed bottom-5 right-5">
    <Button type="primary" shape="round" icon={icon} size="large" />
  </div>
}