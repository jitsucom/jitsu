/* eslint-disable */
import * as React from 'react';
import { ExoticComponent, ReactNode, useState } from 'react';

import {NavLink, Redirect, Route, Switch} from 'react-router-dom';
import {Button, Col, Dropdown, Form, Input, Layout, Menu, message, Modal, Row, Tooltip} from 'antd';


import './App.less';
import ApplicationServices, {setDebugInfo} from './lib/services/ApplicationServices';
import {Align, CenteredSpin, GlobalError, handleError, Preloader} from './lib/components/components';
import {reloadPage} from './lib/commons/utils';
import {User} from './lib/services/model';
import OnboardingForm from './lib/components/OnboardingForm/OnboardingForm';
import { PRIVATE_PAGES, PUBLIC_PAGES, SELFHOSTED_PAGES} from './navigation';

import PapercupsWrapper from './lib/commons/papercups';
import { ApplicationPageWrapper, SlackChatWidget } from './Layout';
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
            if (loginStatus.user && this.services.features.chatSupportType === 'chat') {
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
                return <>
                    <Switch>
                        {pages.map((route) => {
                            let Component = route.component as ExoticComponent;
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
                                        return <Component {...(routeProps as any)} />;
                                    }}
                                />
                            );
                        })}
                        <Redirect key="rootRedirect" to="/"/>
                    </Switch>
                </>;
            case AppLifecycle.APP:
                return <>
                    {this.appLayout()}
                    {this.services.features.chatSupportType === 'slack' && <SlackChatWidget />}
                    </>;
            case AppLifecycle.ERROR:
                return <GlobalError/>;
            case AppLifecycle.LOADING:
                return <Preloader/>;
        }
    }

    public render() {
        return <React.Suspense fallback={<CenteredSpin/>}>{this.getRenderComponent()}</React.Suspense>;
    }


    appLayout() {
        let routes = PRIVATE_PAGES.map((route) => {
            if (!this.state.showOnboardingForm) {
                let Component = route.component as ExoticComponent;
                return <Route
                        key={route.pageTitle}
                        path={route.getPrefixedPath()}
                        exact={true}
                        render={(routeProps) => {
                            this.services.analyticsService.onPageLoad({
                                pagePath: routeProps.location.hash
                            });
                            document.title = route.pageTitle;
                            return route.doNotWrap ?
                              <Component {...(routeProps as any)} /> :
                              <ApplicationPageWrapper user={this.state.user} page={route} {...routeProps} />;
                        }}
                    />;
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
