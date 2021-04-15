/* eslint-disable */
import * as React from 'react';
import {ReactNode, useState} from 'react';

import {NavLink, Redirect, Route, Switch} from 'react-router-dom';
import {Button, Col, Dropdown, Form, Input, Layout, Menu, message, Modal, Row, Tooltip} from 'antd';

import LogoutOutlined from '@ant-design/icons/lib/icons/LogoutOutlined';
import CloudOutlined from '@ant-design/icons/lib/icons/CloudOutlined';
import AreaChartOutlined from '@ant-design/icons/lib/icons/AreaChartOutlined';
import SlidersOutlined from '@ant-design/icons/lib/icons/SlidersOutlined';
import ExclamationCircleOutlined from '@ant-design/icons/lib/icons/ExclamationCircleOutlined';
import UserOutlined from '@ant-design/icons/lib/icons/UserOutlined';
import UnlockOutlined from '@ant-design/icons/lib/icons/UnlockOutlined';
import DownloadOutlined from '@ant-design/icons/lib/icons/DownloadOutlined';
import NotificationOutlined from '@ant-design/icons/lib/icons/NotificationOutlined';
import UserSwitchOutlined from '@ant-design/icons/lib/icons/UserSwitchOutlined';
import ApiOutlined from '@ant-design/icons/lib/icons/ApiOutlined';

import './App.less';
import ApplicationServices, {setDebugInfo} from './lib/services/ApplicationServices';
import {Align, CenteredSpin, GlobalError, handleError, Preloader} from './lib/components/components';
import {reloadPage} from './lib/commons/utils';
import {Permission, User} from './lib/services/model';
import OnboardingForm from './lib/components/OnboardingForm/OnboardingForm';
import {Page, PRIVATE_PAGES, PUBLIC_PAGES, SELFHOSTED_PAGES} from './navigation';

import logo from './icons/logo.svg';
import PapercupsWrapper from './lib/commons/papercups';
import WechatOutlined from '@ant-design/icons/lib/icons/WechatOutlined';
import QuestionCircleOutlined from "@ant-design/icons/lib/icons/QuestionCircleOutlined";
import { ApplicationContent, ApplicationMenu, ApplicationSidebar, PageHeader } from '@./Layout';
import classNames from 'classnames';

enum AppLifecycle {
    LOADING, //Application is loading
    REQUIRES_LOGIN, //Login form is displayed
    APP, //Application
    ERROR //Global error (maintenance)
}

type AppState = {
    showOnboardingForm: boolean;
    lifecycle: AppLifecycle;
    globalErrorDetails?: string;
    extraControls?: React.ReactNode;
    user?: User;
};

type AppProperties = {
    location: string;
};

const LOGIN_TIMEOUT = 5000;
export default class App extends React.Component<AppProperties, AppState> {
    private readonly services: ApplicationServices;

    constructor(props: AppProperties, context: any) {
        super(props, context);
        this.services = ApplicationServices.get();
        setDebugInfo('applicationServices', this.services, false);
        this.state = {
            lifecycle: AppLifecycle.LOADING,
            showOnboardingForm: false,
            extraControls: null
        };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        this.services.analyticsService.onGlobalError(error);
    }

    public async componentDidMount() {
        try {
            await this.services.init();
            const loginStatus = await this.services.userService.waitForUser();
            setDebugInfo('user', loginStatus.user);
            if (loginStatus.user) {
                this.services.analyticsService.onUserKnown(loginStatus.user);
                PapercupsWrapper.init(loginStatus.user);
            }

            this.setState({
                lifecycle: loginStatus.user ? AppLifecycle.APP : AppLifecycle.REQUIRES_LOGIN,
                user: loginStatus.user,
                showOnboardingForm: loginStatus.user && !loginStatus.user.onboarded,
            });
        } catch (error) {
            console.error('Failed to initialize ApplicationServices', error);
            this.services.analyticsService.onGlobalError(error, true);
            this.setState({lifecycle: AppLifecycle.ERROR});
            return;
        }

        window.setTimeout(() => {
            if (this.state.lifecycle == AppLifecycle.LOADING) {
                this.services.analyticsService.onGlobalError(new Error('Login timeout'));
                this.setState({lifecycle: AppLifecycle.ERROR, globalErrorDetails: 'Timeout'});
            }
        }, LOGIN_TIMEOUT);
    }

    private getRenderComponent() {
        switch (this.state.lifecycle) {
            case AppLifecycle.REQUIRES_LOGIN:
                let pages = this.services.showSelfHostedSignUp() ? SELFHOSTED_PAGES : PUBLIC_PAGES;
                return (
                    <Switch>
                        {pages.map((route) => {
                            return (
                                <Route
                                    key={route.getPrefixedPath().join('')}
                                    path={route.getPrefixedPath()}
                                    exact
                                    render={(routeProps) => {
                                        this.services.analyticsService.onPageLoad({
                                            pagePath: routeProps.location.key
                                        });
                                        document.title = route.pageTitle;
                                        return route.getComponent({...routeProps});
                                    }}
                                />
                            );
                        })}
                        <Redirect key="rootRedirect" to="/"/>
                    </Switch>
                );
            case AppLifecycle.APP:
                return this.appLayout();
            case AppLifecycle.ERROR:
                return <GlobalError/>;
            case AppLifecycle.LOADING:
                return <Preloader/>;
        }
    }

    public render() {
        return <React.Suspense fallback={<CenteredSpin/>}>{this.getRenderComponent()}</React.Suspense>;
    }

    public wrapInternalPage(route: Page, props: any): ReactNode {
        const [currentTitle, setCurrentTitle] = useState<ReactNode>(route.pageTitle)
        const pageId = use
        let component = route.getComponent({...props, onHeaderChange: header => {
            setCurrentTitle(header);
            }});
        return (
            <>
                <ApplicationSidebar />
                <Layout.Content key="content" className="app-layout-content">
                    <div className={classNames('internal-page-wrapper', 'page-' + pageId + '-wrapper')}>
                        <PageHeader user={this.state.user} title={currentTitle} />
                        <div className="internal-page-content-wrapper">{component}</div>
                    </div>
                </Layout.Content>
            </>
        );
    }

    appLayout() {
        let routes = PRIVATE_PAGES.map((route) => {
            if (!this.state.showOnboardingForm) {
                return (
                    <Route
                        key={route.id}
                        path={route.getPrefixedPath()}
                        exact={true}
                        render={(routeProps) => {
                            this.services.analyticsService.onPageLoad({
                                pagePath: routeProps.location.hash
                            });
                            document.title = route.pageTitle;
                            return route.doNotWrap ? route.getComponent({...routeProps}) : this.wrapInternalPage(route, {});
                        }}
                    />
                );
            } else {
                return <CenteredSpin/>;
            }
        });
        routes.push(<Redirect key="dashboardRedirect" to="/dashboard"/>);
        let extraForms = null;
        if (this.state.showOnboardingForm) {
            extraForms = (
                <OnboardingForm
                    user={this.state.user}
                    onCompleted={async () => {
                        await this.services.userService.waitForUser();
                        this.setState({showOnboardingForm: false});
                    }}
                />
            );
        } else if (this.services.userService.getUser().forcePasswordChange) {
            return (
                <SetNewPassword
                    onCompleted={async () => {
                        reloadPage();
                    }}
                />
            );
        }
        return (
            <>
                <Switch>{routes}</Switch>
                {extraForms}
            </>
        );
    }



    private headerComponent() {
        return (
            <Layout.Header className="app-layout-header">
                <Row>
                    <Col className="gutter-row" span={20}>
                        <div className="user-menu">
                            <Dropdown trigger={['click']} overlay={this.getUserDropDownMenu()}>
                                <Button icon={<UserOutlined/>}>{this.state.user.name}</Button>
                            </Dropdown>
                        </div>
                    </Col>
                </Row>
            </Layout.Header>
        );
    }

    private resetPassword() {
        Modal.confirm({
            title: 'Password reset',
            icon: <ExclamationCircleOutlined/>,
            content: 'Please confirm password reset. Instructions will be sent to your email',
            okText: 'Reset password',
            cancelText: 'Cancel',
            onOk: async () => {
                try {
                    await this.services.userService.sendPasswordReset()
                    message.info('Reset password instructions has been sent. Please, check your mailbox')
                } catch (error) {
                    message.error("Can't reset password: " + error.message);
                    console.log("Can't reset password", error);
                }
            },
            onCancel: () => {
            }
        });
    }

    private async becomeUser() {
        let email = prompt('Please enter e-mail of the user', '');
        if (!email) {
            return;
        }
        try {
            await this.services.userService.becomeUser(email);
        } catch (e) {
            handleError(e, "Can't login as other user");
        }
    }

    private getUserDropDownMenu() {
        return (
            <div>
                <div className="user-dropdown-info-panel">{this.state.user.email}</div>
                <Menu>
                    <Menu.Item key="profile" icon={<SlidersOutlined/>} onClick={() => this.resetPassword()}>
                        Reset Password
                    </Menu.Item>
                    {this.services.userService.getUser().hasPermission(Permission.BECOME_OTHER_USER) ? (
                        <Menu.Item key="become" icon={<UserSwitchOutlined/>} onClick={() => this.becomeUser()}>
                            Become User
                        </Menu.Item>
                    ) : (
                        ''
                    )}
                    <Menu.Item
                        key="logout"
                        icon={<LogoutOutlined/>}
                        onClick={() => this.services.userService.removeAuth(reloadPage)}
                    >
                        Logout
                    </Menu.Item>
                </Menu>
            </div>
        );
    }
}

function SetNewPassword({onCompleted}: { onCompleted: () => Promise<void> }) {
    let [loading, setLoading] = useState(false);
    let services = ApplicationServices.get();
    let [form] = Form.useForm();
    return (
        <Modal
            title="Please, set a new password"
            visible={true}
            closable={false}
            footer={
                <>
                    <Button
                        onClick={() => {
                            services.userService.removeAuth(reloadPage);
                        }}
                    >
                        Logout
                    </Button>
                    <Button
                        type="primary"
                        loading={loading}
                        onClick={async () => {
                            setLoading(true);
                            let values;
                            try {
                                values = await form.validateFields();
                            } catch (e) {
                                //error will be displayed on the form, not need for special handling
                                setLoading(false);
                                return;
                            }

                            try {
                                let newPassword = values['password'];
                                await services.userService.changePassword(newPassword);
                                await services.userService.login(services.userService.getUser().email, newPassword);
                                let user = (await services.userService.waitForUser()).user;
                                user.forcePasswordChange = false;
                                //await services.userService.update(user);
                                await onCompleted();
                            } catch (e) {
                                if ('auth/requires-recent-login' === e.code) {
                                    services.userService.removeAuth(() => {
                                        reloadPage();
                                    });
                                } else {
                                    handleError(e);
                                }
                            } finally {
                                setLoading(false);
                            }
                        }}
                    >
                        Set new password
                    </Button>
                </>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item
                    name="password"
                    label="Password"
                    rules={[
                        {
                            required: true,
                            message: 'Please input your password!'
                        }
                    ]}
                    hasFeedback
                >
                    <Input.Password/>
                </Form.Item>

                <Form.Item
                    name="confirm"
                    label="Confirm Password"
                    dependencies={['password']}
                    hasFeedback
                    rules={[
                        {
                            required: true,
                            message: 'Please confirm your password!'
                        },
                        ({getFieldValue}) => ({
                            validator(rule, value) {
                                if (!value || getFieldValue('password') === value) {
                                    return Promise.resolve();
                                }
                                return Promise.reject('The two passwords that you entered do not match!');
                            }
                        })
                    ]}
                >
                    <Input.Password/>
                </Form.Item>
            </Form>
        </Modal>
    );
}
