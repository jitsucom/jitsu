// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Button, Col, Dropdown, Layout, Menu, message, Modal, Row } from 'antd';
import AreaChartOutlined from '@ant-design/icons/lib/icons/AreaChartOutlined';
import { NavLink } from 'react-router-dom';
import UnlockOutlined from '@ant-design/icons/lib/icons/UnlockOutlined';
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';
import NotificationOutlined from '@ant-design/icons/lib/icons/NotificationOutlined';
import CloudOutlined from '@ant-design/icons/lib/icons/CloudOutlined';
import DownloadOutlined from '@ant-design/icons/lib/icons/DownloadOutlined';
import * as React from 'react';
import { useEffect, useState } from 'react';
import Icon from '@ant-design/icons';
import logo from '@./icons/logo.svg';
import WechatOutlined from '@ant-design/icons/lib/icons/WechatOutlined';
import { Align, handleError } from '@./lib/components/components';
import UserOutlined from '@ant-design/icons/lib/icons/UserOutlined';
import classNames from 'classnames';
import { Permission, User } from '@service/model';
import SlidersOutlined from '@ant-design/icons/lib/icons/SlidersOutlined';
import UserSwitchOutlined from '@ant-design/icons/lib/icons/UserSwitchOutlined';
import LogoutOutlined from '@ant-design/icons/lib/icons/LogoutOutlined';
import { reloadPage } from '@./lib/commons/utils';
import { useServices } from '@hooks/useServices';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
import { Page, usePageLocation } from '@./navigation';
import { BreadcrumbsProps, withHome, Breadcrumbs } from '@component/Breadcrumbs/Breadcrumbs';
import { CurrentPlan } from '@component/CurrentPlan/CurrentPlan';
import { PaymentPlan, PaymentPlanStatus } from '@service/billing';
import styles from './Layout.module.less';
import { getIntercom } from '@service/intercom-wrapper';

export const ApplicationMenu: React.FC<{}> = () => {
  const location = usePageLocation().canonicalPath;
  const services = useServices();

  let key = location === '/' || location === '' ?
    'dashboard' :
    location;

  if (key.charAt(0) === '/') {
    key = key.substr(1);
  }
  return <Menu selectable={false} focusable={false} mode="inline" selectedKeys={[key]} className="border-0">
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
  const services = useServices();
  const intercom = getIntercom();
  return <div className={styles.sideBarContent} >
    <div>
      <a href="https://jitsu.com" className="text-center block pt-5 h-14">
        <img src={logo} alt="[logo]" className="w-32 mx-auto"/>
      </a>
      <ApplicationMenu/>
    </div>
    <div className="flex justify-center pb-4"><Button type="link" size="large"
      onClick={() => {
        if (services.features.chatSupportType === 'chat') {
          intercom('show');
        } else {
          document.getElementById('jitsuSlackWidget').click();
        }
      }}><WechatOutlined/> Chat with us!
    </Button>
    </div>
  </div>
}

export type PageHeaderProps = {
  user: User
  plan: PaymentPlanStatus
}

function abbr(user: User) {
  return user.name.split(' ').filter(part => part.length > 0).map(part => part[0]).join('').toUpperCase();
}

export const PageHeader: React.FC<PageHeaderProps> = ({ plan, user, children }) => {
  const [dropdownVisible, setDropdownVisible] = useState(false);
  return <div className="border-b border-splitBorder mb-4 h-12 flex flex-nowrap">
    <div className="flex-grow">
      <div className="h-12 flex items-center">
        {children}
      </div>
    </div>
    <div className="flex-shrink">
      <Dropdown
        trigger={['click']}
        onVisibleChange={(vis) => setDropdownVisible(vis)}
        visible={dropdownVisible}
        overlay={<DropdownMenu user={user} plan={plan} hideMenu={() => setDropdownVisible(false)} />}>
        <Button className="ml-1 border-primary border-2 hover:border-text text-text hover:text-text" size="large" shape="circle">
          {abbr(user)}
        </Button>
      </Dropdown>
    </div>
  </div>
}

export const DropdownMenu: React.FC<{user: User, plan: PaymentPlanStatus, hideMenu: () => void}> = ({ plan, user , hideMenu }) => {
  const services = useServices();

  const passwordReset = () => {
    Modal.confirm({
      title: 'Password reset',
      icon: <ExclamationCircleOutlined/>,
      content: 'Please confirm password reset. Instructions will be sent to your email',
      okText: 'Reset password',
      cancelText: 'Cancel',
      onOk: async() => {
        try {
          await services.userService.sendPasswordReset();
          message.info('Reset password instructions has been sent. Please, check your mailbox');
        } catch (error) {
          message.error("Can't reset password: " + error.message);
          console.log("Can't reset password", error);
        }
      },
      onCancel: () => {
      }
    });
  };

  const becomeUser = async() => {
    let email = prompt('Please enter e-mail of the user', '');
    if (!email) {
      return;
    }
    try {
      await services.userService.becomeUser(email);
    } catch (e) {
      handleError(e, "Can't login as other user");
    }
  };

  return (
    <div className="bg-bgSecondary border rounded-xl mr-2">
      <div className="py-5 border-b border-main px-5 flex flex-col items-center">
        <div className="text-center text-text text-lg">{user.name}</div>
        <div className="text-secondaryText text-xs underline">{user.email}</div>
      </div>
      <div className="py-2 border-b border-main px-5 flex flex-col items-start">
        <div>Project: <b>{services.activeProject.name || 'Unspecified'}</b></div>
      </div>
      {services.features.billingEnabled &&<div className="py-5 border-b border-main px-5 flex flex-col items-start">
        <CurrentPlan
          limit={plan.currentPlan.events_limit}
          usage={plan.eventsThisMonth}
          planTitle={plan.currentPlan.name}
          onPlanChangeModalOpen={hideMenu}
          planId={plan.currentPlan.id}
        />
      </div>}
      <div className="p-2 flex flex-col items-stretch">
        <Button type="text" className="text-left" key="profile" icon={<SlidersOutlined/>} onClick={passwordReset}>Reset Password</Button>
        {services.userService.getUser().hasPermission(Permission.BECOME_OTHER_USER) &&
        <Button className="text-left" type="text" key="become" icon={<UserSwitchOutlined/>} onClick={becomeUser}>Become User</Button>}
        <Button
          className="text-left"
          type="text"
          key="logout"
          icon={<LogoutOutlined/>}
          onClick={() => services.userService.removeAuth(reloadPage)
          }>Logout</Button>
      </div>
    </div>
  );
}

export type ApplicationPageWrapperProps = {
  page: Page
  user: User
  plan: PaymentPlanStatus
  [propName: string]: any
}

export const ApplicationPage: React.FC<ApplicationPageWrapperProps> = ({ plan, page, user, ...rest }) => {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbsProps>(withHome({ elements: [{ title: page.pageHeader }] }));

  let Component = page.component as React.ExoticComponent;
  let props = { setBreadcrumbs }
  return <div className={styles.applicationPage}>
    <div className={classNames(styles.sidebar)}>
      <ApplicationSidebar />
    </div>
    <div className={classNames(styles.rightbar)}>
      <PageHeader user={user} plan={plan}><Breadcrumbs {...breadcrumbs} /></PageHeader>
      <div className={styles.applicationPageComponent}>
        <Component {...(props as any)} />
      </div>
    </div>
  </div>;
}

export const SlackChatWidget: React.FC<{}> = () => {
  const services = useServices();
  const [modalVisible, setModalVisible] = useState(false);
  return <><div id="jitsuSlackWidget"
    onClick={() => {
      services.analyticsService.track('slack_invitation_open');
      setModalVisible(true)
    }}
    className="fixed bottom-5 right-5 rounded-full bg-primary text-text w-12 h-12 flex justify-center items-center cursor-pointer hover:bg-primaryHover">
    <svg className="h-6 w-6" fill="currentColor"  viewBox="0 0 24 24">
      <path d="M 4 3 C 2.9 3 2 3.9 2 5 L 2 15.792969 C 2 16.237969 2.5385156 16.461484 2.8535156 16.146484 L 5 14 L 14 14 C 15.1 14 16 13.1 16 12 L 16 5 C 16 3.9 15.1 3 14 3 L 4 3 z M 18 8 L 18 12 C 18 14.209 16.209 16 14 16 L 8 16 L 8 17 C 8 18.1 8.9 19 10 19 L 19 19 L 21.146484 21.146484 C 21.461484 21.461484 22 21.237969 22 20.792969 L 22 10 C 22 8.9 21.1 8 20 8 L 18 8 z"/>
    </svg>
  </div>
  <SlackInvitationModal visible={modalVisible} hide={() => {
    setModalVisible(false);
  }}/></>
}

export const SlackInvitationModal: React.FC<{visible: boolean, hide: () => void}> = ({ visible , hide }) => {

  return <Modal
    title="Join Jitsu Slack"
    visible={visible}
    onCancel={() => {
      hide();
    }}
    footer={null}
  >
    <div className="text-lg">
      We'd be delighted to assist you with any issues in our <b>public Slack</b>! 100+ members
      already received help from our community
    </div>
    <div className="flex justify-center pt-6">
      <Button
        onClick={() => {
          window.open('https://jitsu.com/slack', '_blank')
          hide();
        }}

        size="large" type="primary" icon={<Icon component={() => <svg className="fill-current" viewBox="0 0 24 24" height="1em" width="1em">
          <path d="m8.843 12.651c-1.392 0-2.521 1.129-2.521 2.521v6.306c0 1.392 1.129 2.521 2.521 2.521s2.521-1.129 2.521-2.521v-6.306c-.001-1.392-1.13-2.521-2.521-2.521z"/>
          <path d="m.019 15.172c0 1.393 1.13 2.523 2.523 2.523s2.523-1.13 2.523-2.523v-2.523h-2.521c-.001 0-.001 0-.002 0-1.393 0-2.523 1.13-2.523 2.523z"/>
          <path d="m8.846-.001c-.001 0-.002 0-.003 0-1.393 0-2.523 1.13-2.523 2.523s1.13 2.523 2.523 2.523h2.521v-2.523c0-.001 0-.003 0-.005-.001-1.391-1.128-2.518-2.518-2.518z"/>
          <path d="m2.525 11.37h6.318c1.393 0 2.523-1.13 2.523-2.523s-1.13-2.523-2.523-2.523h-6.318c-1.393 0-2.523 1.13-2.523 2.523s1.13 2.523 2.523 2.523z"/>
          <path d="m21.457 6.323c-1.391 0-2.518 1.127-2.518 2.518v.005 2.523h2.521c1.393 0 2.523-1.13 2.523-2.523s-1.13-2.523-2.523-2.523c-.001 0-.002 0-.003 0z"/>
          <path d="m12.641 2.522v6.325c0 1.392 1.129 2.521 2.521 2.521s2.521-1.129 2.521-2.521v-6.325c0-1.392-1.129-2.521-2.521-2.521-1.392 0-2.521 1.129-2.521 2.521z"/>
          <g>
            <path d="m17.682 21.476c0-1.392-1.129-2.521-2.521-2.521h-2.521v2.523c.001 1.391 1.129 2.519 2.521 2.519s2.521-1.129 2.521-2.521z"/>
            <path d="m21.479 12.649h-6.318c-1.393 0-2.523 1.13-2.523 2.523s1.13 2.523 2.523 2.523h6.318c1.393 0 2.523-1.13 2.523-2.523s-1.13-2.523-2.523-2.523z"/>
          </g>
        </svg>} />}>Join Jitsu Slack</Button>
    </div>
  </Modal>
}

