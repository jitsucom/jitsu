/* eslint-disable */
import React, { ComponentType, ExoticComponent, useEffect, useState } from "react"

import { Redirect, Route, Switch, useLocation } from "react-router-dom"
import { Button, Card, Form, Input, Modal, Typography } from "antd"

import "./App.less"
import ApplicationServices from "./lib/services/ApplicationServices"
import { CenteredSpin, handleError, Preloader } from "./lib/components/components"
import { reloadPage, setDebugInfo } from "./lib/commons/utils"

import { ApplicationPage } from "./Layout"
import { CurrentSubscription, getCurrentSubscription, paymentPlans } from "lib/services/billing"
import { initializeAllStores } from "stores/_initializeAllStores"
import { destinationsStore } from "./stores/destinations"
import { sourcesStore } from "./stores/sources"
import moment from "moment"
import { UpgradePlan } from "./ui/components/CurrentPlan/CurrentPlan"
import { useServices } from "./hooks/useServices"
import { ErrorCard } from "./lib/components/ErrorCard/ErrorCard"
import { LoginLink } from "./lib/components/LoginLink/LoginLink"
import { useParams } from "react-router"
import LoginPage from "./ui/pages/GetStartedPage/LoginPage"
import SignupPage from "./ui/pages/GetStartedPage/SignupPage"
import { StatusPage } from "./lib/components/StatusPage/StatusPage"
import ExclamationCircleOutlined from "@ant-design/icons/ExclamationCircleOutlined"
import { UserSettings } from "./lib/components/UserSettings/UserSettings"
import { currentPageHeaderStore } from "./stores/currentPageHeader"

const ApiKeysRouter = React.lazy(() => import(/* webpackPrefetch: true */ "./lib/components/ApiKeys/ApiKeysRouter"))
const CustomDomains = React.lazy(
  () => import(/* webpackPrefetch: true */ "./lib/components/CustomDomains/CustomDomains")
)
const DestinationsPage = React.lazy(
  () => import(/* webpackPrefetch: true */ "ui/pages/DestinationsPage/DestinationsPage")
)
const DbtCloudPage = React.lazy(() => import(/* webpackPrefetch: true */ "ui/pages/DbtCloud/DbtCloudPage"))
const ProjectSettingsPage = React.lazy(
  () => import(/* webpackPrefetch: true */ "ui/pages/ProjectSettingsPage/ProjectSettingsPage")
)
const GeoDataResolver = React.lazy(
  () => import(/* webpackPrefetch: true */ "./lib/components/GeoDataResolver/GeoDataResolver")
)

const EventsStream = React.lazy(() => import(/* webpackPrefetch: true */ "./lib/components/EventsStream/EventsStream"))
const SetupForm = React.lazy(() => import(/* webpackPrefetch: true */ "ui/pages/SetupPage/SetupForm"))
const SourcesPage = React.lazy(() => import(/* webpackPrefetch: true */ "ui/pages/SourcesPage/SourcesPage"))
const ConnectionsPage = React.lazy(() => import(/* webpackPrefetch: true */ "ui/pages/ConnectionsPage/ConnectionsPage"))
const PasswordForm = React.lazy(() => import(/* webpackPrefetch: true */ "./lib/components/PasswordForm/PasswordForm"))
const DownloadConfig = React.lazy(
  () => import(/* webpackPrefetch: true */ "./lib/components/DownloadConfig/DownloadConfig")
)

export const initializeApplication = async (): Promise<ApplicationServices> => {
  const services = ApplicationServices.get()
  await services.init()
  const { user } = await services.userService.waitForUser()
  setDebugInfo("user", user)
  if (user) {
    services.analyticsService.onUserKnown(user)
  }

  let paymentPlanStatus: CurrentSubscription
  await Promise.all([
    initializeAllStores(),
    (async () => {
      if (user && services.features.billingEnabled) {
        if (services.activeProject) {
          paymentPlanStatus = await getCurrentSubscription(
            services.activeProject,
            services.backendApiClient,
            destinationsStore,
            sourcesStore
          )
        } else {
          /** project is not initialized yet, return mock result */
          paymentPlanStatus = {
            autorenew: false,
            expiration: moment().add(1, "M"),
            usage: {
              events: 0,
              sources: 0,
              destinations: 0,
            },
            currentPlan: paymentPlans.free,
            quotaPeriodStart: moment(),
            doNotBlock: true,
          }
        }
      } else {
        /** for opensource (self-hosted) only */
        paymentPlanStatus = {
          autorenew: false,
          expiration: moment().add(1, "M"),
          usage: {
            events: 0,
            sources: 0,
            destinations: 0,
          },
          currentPlan: paymentPlans.opensource,
          quotaPeriodStart: moment(),
          doNotBlock: true,
        }
      }
    })(),
  ])
  services.currentSubscription = paymentPlanStatus
  return services
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : "/" + path
}

export const Application: React.FC = function () {
  const [services, setServices] = useState<ApplicationServices>()
  const [error, setError] = useState<Error>()
  useEffect(() => {
    initializeApplication().then(setServices).catch(setError)
  })
  if (!error && !services) {
    return <Preloader />
  } else if (error) {
    services.analyticsService.onGlobalError(new Error("Failed to initialize application: " + error.message))
    return <ErrorCard description={"Failed to load Jitsu application:" + error.message} stackTrace={error.stack} />
  }

  if (!services.userService.hasUser()) {
    return (
      <>
        {services.showSelfHostedSignUp() && <SetupForm />}
        {!services.showSelfHostedSignUp() && (
          <Switch>
            <Route
              key="login"
              path="/login-link/:emailEncoded?"
              exact
              render={pageOf(LoginLink, { pageTitle: "Jitsu : login with magic link" })}
            />
            <Route
              key="signin"
              path={["/", "/dashboard", "/login", "/signin"]}
              exact
              render={pageOf(LoginPage, { pageTitle: "Jitsu : login with magic link" })}
            />
            <Route
              key="signup"
              path={["/register", "/signup"]}
              exact
              render={pageOf(SignupPage, { pageTitle: "Jitsu : Sign Up" })}
            />
            <Route
              key="reset"
              path={["/reset_password/:resetId"]}
              exact
              render={pageOf(PasswordForm, { pageTitle: "Jitsu : Reset Password" })}
            />
            <Redirect to="/" />
          </Switch>
        )}
      </>
    )
  }

  return (
    <>
      <Switch>
        <Route path={"/prj_:projectId"} exact={false}>
          <ProjectRoute />
        </Route>
        <Route>
          <ProjectRedirect />
        </Route>
      </Switch>
    </>
  )
}

function pageOf(component: React.ComponentType<any>, opts: { pageTitle: string }) {
  return page => {
    ApplicationServices.get().analyticsService.onPageLoad({
      pagePath: page.location.key || "/unknown",
    })
    document["title"] = opts.pageTitle
    let Component = component as ExoticComponent
    return <Component {...(page as any)} />
  }
}

type ProjectRoute = {
  pageTitle: string
  path: string | string[]
  component: React.ComponentType
  isPrefix?: boolean
}

const projectRoutes: ProjectRoute[] = [
  { pageTitle: "Connections", path: ["/", "/connections"], component: ConnectionsPage },
  { pageTitle: "Live Events", path: "/events_stream", component: EventsStream, isPrefix: true },
  { pageTitle: "Dashboard", path: "/dashboard", component: StatusPage },
  { pageTitle: "DBT Cloud", path: "/dbtcloud", component: DbtCloudPage },
  { pageTitle: "Dashboard", path: "/geo_data_resolver", component: GeoDataResolver },
  { pageTitle: "Config Download", path: "/cfg_download", component: DownloadConfig },
  { pageTitle: "Project Settings", path: "/project_settings", component: ProjectSettingsPage },
  { pageTitle: "Api Keys", path: "/api-keys", component: ApiKeysRouter, isPrefix: true },
  { pageTitle: "Custom Domains", path: "/domains", component: CustomDomains },

  { pageTitle: "Sources", path: "/sources", component: EventsStream, isPrefix: true },
  { pageTitle: "Destinations", path: "/destinations", component: EventsStream, isPrefix: true },
  { pageTitle: "Task Logs", path: "/sources/logs", component: EventsStream, isPrefix: true },

  { pageTitle: "User Settings", path: "/settings/user", component: UserSettings, isPrefix: true },
]

function RouteNotFound() {
  useEffect(() => {
    currentPageHeaderStore.breadcrumbs = [{title: "Not found"}];
  })
  return (
    <div className="flex justify-center pt-12">
      <Card bordered={false}>
        <Card.Meta
          description={
            <>
              This page does not exist. If you got here by clicking a link within Jitsu interface, try to contact us:{" "}
              <Typography.Paragraph copyable={{ tooltips: false }} className="inline">
                {"support@jitsu.com"}
              </Typography.Paragraph>
            </>
          }
          avatar={
            <span className="text-error">
              <ExclamationCircleOutlined />
            </span>
          }
          title={"Page Not Found"}
        />
      </Card>
    </div>
  )
}

const PageWrapper: React.FC<{pageTitle: string, component: ComponentType, pagePath: string}> = ({pageTitle, component, pagePath, ...rest}) => {
  const services = useServices();
  useEffect(() => {
    services.analyticsService.onPageLoad({
      pagePath: pagePath,
    })
    document["title"] = `Jitsu : ${pageTitle}`
  })
  let Component = component as ExoticComponent
  return <React.Suspense fallback={<CenteredSpin />}>
    <Component {...(rest as any)} />
  </React.Suspense>

}

const ProjectRoute: React.FC<{}> = () => {
  const services = useServices()
  const { projectId } = useParams<{ projectId: string }>()
  let project = services.availableProjects.find(project => project.id === projectId)

  if (!project) {
    return (
      <div className="flex items-start pt-12 justify-center w-full">
        <ErrorCard
          title={`Can't find project with id ${projectId}`}
          description={`The project either do not exist, or you don't have access to it. Available projects: ${JSON.stringify(
            services.availableProjects
          )}`}
        />
      </div>
    )
  }
  return (
    <>
      <ApplicationPage>
        <Switch>
          {projectRoutes.map(({ component, pageTitle, path, isPrefix }) => (
            <Route
              exact={!isPrefix}
              path={(typeof path === "string" ? [path] : path).map(path => `/prj_:projectId${path}`)}
              render={page => <PageWrapper pageTitle={pageTitle} component={component} pagePath={page.location.key} {...page} />}
              key={`${path}-${pageTitle}`}
            />
          ))}
          <Route>
            <RouteNotFound />
          </Route>
        </Switch>
      </ApplicationPage>
    </>
  )
}

const ProjectRedirect: React.FC = () => {
  const services = useServices()
  const location = useLocation()
  let projectId = services.availableProjects[0].id
  return <Redirect to={`/prj_${projectId}${location.pathname}`} />
}

const LOGIN_TIMEOUT = 5000
// export default class App extends React.Component<{ projectId?: string }, AppState> {
//   private readonly services: ApplicationServices
//
//   constructor(props: any, context: any) {
//     super(props, context)
//     this.services = ApplicationServices.get()
//     setDebugInfo("applicationServices", this.services, false)
//     this.state = {
//       lifecycle: AppLifecycle.LOADING,
//       extraControls: null,
//     }
//   }
//
//   componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
//     this.services.analyticsService.onGlobalError(error)
//   }
//
//   public async componentDidMount() {
//     try {
//       const { user, paymentPlanStatus } = await initializeApplication(this.services)
//
//       this.setState({
//         lifecycle: user ? AppLifecycle.APP : AppLifecycle.REQUIRES_LOGIN,
//         user: user,
//         paymentPlanStatus: paymentPlanStatus,
//       })
//
//       if (user) {
//         const email = await this.services.userService.getUserEmailStatus()
//         email.needsConfirmation && !email.isConfirmed && message.warn(emailIsNotConfirmedMessageConfig)
//       }
//     } catch (error) {
//       console.error("Failed to initialize ApplicationServices", error)
//       if (this.services.analyticsService) {
//         this.services.analyticsService.onGlobalError(error, true)
//       } else {
//         console.error("Failed to send error to analytics service, it's not defined yet")
//       }
//       this.setState({ lifecycle: AppLifecycle.ERROR })
//       return
//     }
//
//     window.setTimeout(() => {
//       if (this.state.lifecycle == AppLifecycle.LOADING) {
//         this.services.analyticsService.onGlobalError(new Error("Login timeout"))
//         this.setState({ lifecycle: AppLifecycle.ERROR, globalErrorDetails: "Timeout" })
//       }
//     }, LOGIN_TIMEOUT)
//   }
//
//   private getRenderComponent() {
//     alert(this.props)
//     switch (this.state.lifecycle) {
//       case AppLifecycle.REQUIRES_LOGIN:
//         let pages = this.services.showSelfHostedSignUp() ? SELFHOSTED_PAGES : PUBLIC_PAGES
//         return (
//           <>
//             <Switch>
//               {pages.map(route => {
//                 let Component = route.component as ExoticComponent
//                 return (
//                   <Route
//                     key={route.getPrefixedPath().join("")}
//                     path={route.getPrefixedPath()}
//                     exact
//                     render={routeProps => {
//                       this.services.analyticsService.onPageLoad({
//                         pagePath: routeProps.location.key || "/unknown",
//                       })
//                       document["title"] = route.pageTitle
//                       return <Component {...(routeProps as any)} />
//                     }}
//                   />
//                 )
//               })}
//               <Redirect key="rootRedirect" to="/" />
//             </Switch>
//           </>
//         )
//       case AppLifecycle.APP:
//         return (
//           <>
//             {this.appLayout()}
//             {<SlackChatWidget />}
//           </>
//         )
//       case AppLifecycle.ERROR:
//         return <GlobalError />
//       case AppLifecycle.LOADING:
//         return <Preloader />
//     }
//   }
//
//   public render() {
//     return <React.Suspense fallback={<CenteredSpin />}>{this.getRenderComponent()}</React.Suspense>
//   }
//
//   appLayout() {
//     const extraForms = [<OnboardingSwitch key="onboardingTour" />]
//     if (this.services.userService.getUser().forcePasswordChange) {
//       return (
//         <SetNewPassword
//           onCompleted={async () => {
//             reloadPage()
//           }}
//         />
//       )
//     } else if (this.state.paymentPlanStatus) {
//       const quotasMessage = checkQuotas(this.state.paymentPlanStatus)
//       if (quotasMessage) {
//         extraForms.push(
//           <BillingBlockingModal
//             key="billingBlockingModal"
//             blockingReason={quotasMessage}
//             subscription={this.state.paymentPlanStatus}
//           />
//         )
//       } else if (this.state.paymentPlanStatus && window.location.search.indexOf("upgradeDialog=true") >= 0) {
//         extraForms.push(<UpgradePlanDialog subscription={this.state.paymentPlanStatus} />)
//       }
//     }
//     return (
//       <ApplicationPage
//         key="applicationPage"
//         user={this.state.user}
//         plan={this.state.paymentPlanStatus}
//         pages={PRIVATE_PAGES}
//         extraForms={extraForms}
//       />
//     )
//   }
// }

function UpgradePlanDialog({ subscription }) {
  const [visible, setVisible] = useState(true)
  return (
    <Modal
      destroyOnClose={true}
      visible={visible}
      width={800}
      onCancel={() => setVisible(false)}
      title={<h1 className="text-xl m-0 p-0">Upgrade subscription</h1>}
      footer={null}
    >
      <UpgradePlan planStatus={subscription} />
    </Modal>
  )
}

function SetNewPassword({ onCompleted }: { onCompleted: () => Promise<void> }) {
  let [loading, setLoading] = useState(false)
  let services = ApplicationServices.get()
  let [form] = Form.useForm()
  return (
    <Modal
      title="Please, set a new password"
      visible={true}
      closable={false}
      footer={
        <>
          <Button
            onClick={() => {
              services.userService.removeAuth(reloadPage)
            }}
          >
            Logout
          </Button>
          <Button
            type="primary"
            loading={loading}
            onClick={async () => {
              setLoading(true)
              let values
              try {
                values = await form.validateFields()
              } catch (e) {
                //error will be displayed on the form, not need for special handling
                setLoading(false)
                return
              }

              try {
                let newPassword = values["password"]
                await services.userService.changePassword(newPassword)
                await services.userService.login(services.userService.getUser().email, newPassword)
                let user = (await services.userService.waitForUser()).user
                user.forcePasswordChange = false
                //await services.userService.update(user);
                await onCompleted()
              } catch (e) {
                if ("auth/requires-recent-login" === e.code) {
                  services.userService.removeAuth(() => {
                    reloadPage()
                  })
                } else {
                  handleError(e)
                }
              } finally {
                setLoading(false)
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
              message: "Please input your password!",
            },
          ]}
          hasFeedback
        >
          <Input.Password />
        </Form.Item>

        <Form.Item
          name="confirm"
          label="Confirm Password"
          dependencies={["password"]}
          hasFeedback
          rules={[
            {
              required: true,
              message: "Please confirm your password!",
            },
            ({ getFieldValue }) => ({
              validator(rule, value) {
                if (!value || getFieldValue("password") === value) {
                  return Promise.resolve()
                }
                return Promise.reject("The two passwords that you entered do not match!")
              },
            }),
          ]}
        >
          <Input.Password />
        </Form.Item>
      </Form>
    </Modal>
  )
}
