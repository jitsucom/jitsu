/* eslint-disable */
import React, { ExoticComponent, useState } from 'react';

import {Redirect, Route, Switch} from 'react-router-dom';
import {Button, Form, Input, message, Modal} from 'antd';

import './App.less';
import ApplicationServices from './lib/services/ApplicationServices';
import {
  CenteredSpin,
  GlobalError,
  handleError,
  Preloader
} from './lib/components/components';
import { reloadPage, setDebugInfo } from './lib/commons/utils';
import {User} from './lib/services/model';
import { PRIVATE_PAGES, PUBLIC_PAGES, SELFHOSTED_PAGES} from './navigation';

import { ApplicationPage, emailIsNotConfirmedMessageConfig, SlackChatWidget } from './Layout';
import { checkQuotas, getCurrentSubscription, CurrentSubscription, paymentPlans } from 'lib/services/billing';
import { OnboardingTour } from 'lib/components/OnboardingTour/OnboardingTour';
import { initializeAllStores } from 'stores/_initializeAllStores';
import { destinationsStore } from './stores/destinations';
import { sourcesStore } from './stores/sources';
import BillingBlockingModal from './lib/components/BillingModal/BillingBlockingModal';
import moment, { Moment } from 'moment';

enum AppLifecycle {
  LOADING, //Application is loading
  REQUIRES_LOGIN, //Login form is displayed
  APP, //Application
  ERROR //Global error (maintenance)
}

type AppState = {
  lifecycle: AppLifecycle;
  globalErrorDetails?: string;
  extraControls?: React.ReactNode;
  user?: User;
  paymentPlanStatus?: CurrentSubscription;
};

export const initializeApplication = async (
  services: ApplicationServices = ApplicationServices.get()
): Promise<{
  user: User;
  paymentPlanStatus: CurrentSubscription;
}> => {
  await services.init();
  const { user } = await services.userService.waitForUser();
  setDebugInfo('user', user);
  if (user) {
    services.analyticsService.onUserKnown(user);
  }

  await initializeAllStores();

  let paymentPlanStatus: CurrentSubscription;
  if (user && services.features.billingEnabled) {
    if (services.activeProject) {
      paymentPlanStatus = await getCurrentSubscription(
        services.activeProject,
        services.backendApiClient,
        destinationsStore,
        sourcesStore
      );
    } else {
      /** project is not initialized yet, return mock result */
      paymentPlanStatus = {
        autorenew: false,
        expiration: moment().add(1, 'M'),
        usage: {
          events: 0,
          sources: 0,
          destinations: 0
        },
        currentPlan: paymentPlans.free,
        quotaPeriodStart: moment(),
        doNotBlock: true
      }
    }
  } else {
    /** for opensource (self-hosted) only */
    paymentPlanStatus = {
        autorenew: false,
        expiration: moment().add(1, 'M'),
        usage: {
            events: 0,
            sources: 0,
            destinations: 0
        },
        currentPlan: paymentPlans.opensource,
        quotaPeriodStart: moment(),
        doNotBlock: true
    }
  }
  services.currentSubscription = paymentPlanStatus;

  return { user, paymentPlanStatus };
};

const LOGIN_TIMEOUT = 5000;
export default class App extends React.Component<{}, AppState> {
    private readonly services: ApplicationServices;

    constructor(props: any, context: any) {
        super(props, context);
        this.services = ApplicationServices.get();
        setDebugInfo('applicationServices', this.services, false);
        this.state = {
            lifecycle: AppLifecycle.LOADING,
            extraControls: null
        };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        this.services.analyticsService.onGlobalError(error);
    }

    public async componentDidMount() {
        try {
            const { user, paymentPlanStatus } = await initializeApplication(this.services);

            this.setState({
              lifecycle: user ? AppLifecycle.APP : AppLifecycle.REQUIRES_LOGIN,
              user: user,
              paymentPlanStatus: paymentPlanStatus
            });

            if (user) {
              const email =
                await this.services.userService.getUserEmailStatus();
              email.needsConfirmation &&
                !email.isConfirmed &&
                message.warn(emailIsNotConfirmedMessageConfig);
            }
        } catch (error) {
            console.error('Failed to initialize ApplicationServices', error);
            if (this.services.analyticsService) {
                this.services.analyticsService.onGlobalError(error, true);
            } else {
                console.error("Failed to send error to analytics service, it's not defined yet");
            }
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
                                            pagePath: routeProps.location.key || '/unknown'
                                        });
                                        document['title'] = route.pageTitle;
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
                    {<SlackChatWidget />}
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
    const extraForms = [<OnboardingTour key="onboardingTour" />];
    if (this.services.userService.getUser().forcePasswordChange) {
        return (
            <SetNewPassword
                onCompleted={async () => {
                    reloadPage();
                }}
            />
        );
    } else if (this.state.paymentPlanStatus) {
      const quotasMessage = checkQuotas(this.state.paymentPlanStatus);
      if (quotasMessage) {
        extraForms.push(<BillingBlockingModal key="billingBlockingModal" blockingReason={quotasMessage} subscription={this.state.paymentPlanStatus}/>)
      }

    }
        return <ApplicationPage key="applicationPage" user={this.state.user} plan={this.state.paymentPlanStatus} pages={PRIVATE_PAGES} extraForms={extraForms} />
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
