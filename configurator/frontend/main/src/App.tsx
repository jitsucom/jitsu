// @Libs
import React, { ComponentType, ExoticComponent, useEffect, useState } from "react"
import { Redirect, Route, Switch, useHistory, useLocation, NavLink } from "react-router-dom"
import { Button, Card, Typography } from "antd"
import { useParams } from "react-router"
import moment from "moment"
// @Services
import ApplicationServices from "./lib/services/ApplicationServices"
import { CurrentSubscription, getCurrentSubscription, paymentPlans } from "lib/services/billing"
// @Stores
import { initializeAllStores } from "stores/_initializeAllStores"
import { currentPageHeaderStore } from "./stores/currentPageHeader"
import { destinationsStore } from "./stores/destinations"
import { sourcesStore } from "./stores/sources"
// @Components
import { ApplicationPage } from "./Layout"
import { CenteredSpin, Preloader } from "./lib/components/components"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { SetNewPasswordModal } from "lib/components/SetNewPasswordModal/SetNewPasswordModal"
import { BillingGlobalGuard } from "lib/components/BillingGlobalGuard/BillingGlobalGuard"
import { OnboardingTourLazyLoader } from "./lib/components/Onboarding/OnboardingTourLazyLoader"
import { ErrorCard } from "./lib/components/ErrorCard/ErrorCard"
import { LoginLink } from "./lib/components/LoginLink/LoginLink"
// @Icons
import { ExclamationCircleOutlined } from "@ant-design/icons"
// @Hooks
import { useServices } from "./hooks/useServices"
// @Utils
import { reloadPage, setDebugInfo } from "./lib/commons/utils"
// @Types
import { Project } from "./generated/conf-openapi"
// @Pages
import LoginPage from "./ui/pages/GetStartedPage/LoginPage"
import SignupPage from "./ui/pages/GetStartedPage/SignupPage"
import { StatusPage } from "./lib/components/StatusPage/StatusPage"
import { UserSettings } from "./lib/components/UserSettings/UserSettings"
import { TaskLogsPage, taskLogsPageRoute } from "./ui/pages/TaskLogs/TaskLogsPage"
// @Styles
import "./App.less"
// @Unsorted

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

const LOGIN_TIMEOUT = 5000

export const initializeApplication = async (): Promise<ApplicationServices> => {
  const services = ApplicationServices.get()
  await services.init()
  console.log("Waiting for user")
  await services.userService.waitForUser()
  if (services.userService.hasUser()) {
    setDebugInfo("user", services.userService.getUser())
    services.analyticsService.onUserKnown(services.userService.getUser())
  }

  let currenSubscription: CurrentSubscription
  if (services.userService.hasUser() && services.features.billingEnabled && services.activeProject) {
    currenSubscription = await getCurrentSubscription(
      services.activeProject,
      services.backendApiClient,
      destinationsStore,
      sourcesStore
    )
  } else {
    currenSubscription = {
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
  services.currentSubscription = currenSubscription
  console.log("Services initialized", services)
  return services
}

export const Application: React.FC = function () {
  const [services, setServices] = useState<ApplicationServices>()
  const [projects, setProjects] = useState<Project[]>(null)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<Error>()

  useEffect(() => {
    ;(async () => {
      try {
        let application = await initializeApplication()
        if (application.userService.hasUser()) {
          let projects = await application.projectService.getAvailableProjects()
          if (projects.length === 0) {
            let newProject = await application.projectService.createProject(
              application.userService.getUser().suggestedCompanyName
            )
            setProjects([newProject])
          } else {
            setProjects(projects)
          }
        }
        setServices(application)
        setInitialized(true)
      } catch (e) {
        console.log("Error initialization", e)
        setError(e)
      }
    })()
  }, [])

  if (!error && !initialized) {
    return <Preloader />
  } else if (error) {
    console.error("Initialization error", error)
    if (services?.analyticsService) {
      services.analyticsService.onGlobalError(error, true)
    } else {
      console.error("Failed to send error to analytics service, it's not defined yet")
    }
    return <ErrorCard description={"Failed to load Jitsu application:" + error.message} stackTrace={error.stack} />
  }

  if (!services.userService.hasUser()) {
    return (
      <>
        {services.showSelfHostedSignUp() && <SetupForm />}
        {!services.showSelfHostedSignUp() && (
          <React.Suspense fallback={<CenteredSpin />}>
            <Switch>
              <Route
                key="login"
                path="/login-link/:emailEncoded?"
                exact
                render={pageOf(LoginLink, { pageTitle: "Jitsu : Sign In with magic link" })}
              />
              <Route
                key="signin"
                path={["/", "/dashboard", "/login", "/signin"]}
                exact
                render={pageOf(LoginPage, { pageTitle: "Jitsu : Sign In" })}
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
          </React.Suspense>
        )}
      </>
    )
  }

  return (
    <>
      <Switch>
        <Route
          path={"/user/settings"}
          exact={true}
          render={() => (
            <div className="flex flex-row justify-center pt-12 w-full">
              <div className="w-1/2">
                <NavLink to="/">
                  <Button size="large" type="primary">
                    Back to Jitsu →
                  </Button>
                </NavLink>

                <UserSettings />
              </div>
            </div>
          )}
        />
        <Route path={"/prj-:projectId"} exact={false}>
          <ProjectRoute projects={projects} />
        </Route>
        <Route>
          <ProjectRedirect projects={projects} />
        </Route>
      </Switch>
    </>
  )
}

/**
 * Component decorator that enables analytics services and sets a correct document title
 */
function pageOf(component: React.ComponentType<any>, opts: { pageTitle: string }) {
  return page => {
    ApplicationServices.get().analyticsService.onPageLoad({
      pagePath: page.location.key || "/unknown",
    })
    document["title"] = opts.pageTitle
    const Component = component as ExoticComponent
    return <Component {...(page as any)} />
  }
}

type ProjectRouteData = {
  pageTitle: string
  path: string | string[]
  component: React.ComponentType
  isPrefix?: boolean
}

const projectRoutes: ProjectRouteData[] = [
  { pageTitle: "Connections", path: ["/", "/connections", "/signup"], component: ConnectionsPage },
  { pageTitle: "Live Events", path: ["/events_stream", "/events-stream"], component: EventsStream, isPrefix: true },
  { pageTitle: "Dashboard", path: "/dashboard", component: StatusPage },
  { pageTitle: "DBT Cloud", path: "/dbtcloud", component: DbtCloudPage },
  { pageTitle: "Dashboard", path: ["/geo_data_resolver", "/geo-data-resolver"], component: GeoDataResolver },
  { pageTitle: "Config Download", path: ["/cfg-download", "/cfg_download"], component: DownloadConfig },
  { pageTitle: "Project Settings", path: ["/project-settings", "/project_settings"], component: ProjectSettingsPage },
  { pageTitle: "Api Keys", path: ["/api-keys"], component: ApiKeysRouter, isPrefix: true },
  { pageTitle: "Custom Domains", path: "/domains", component: CustomDomains },

  { pageTitle: "Sources", path: "/sources", component: SourcesPage, isPrefix: true },
  { pageTitle: "Destinations", path: "/destinations", component: DestinationsPage, isPrefix: true },
  { pageTitle: "Task Logs", path: taskLogsPageRoute, component: TaskLogsPage, isPrefix: true },

  { pageTitle: "User Settings", path: "/settings/user", component: UserSettings, isPrefix: true },
]

const RouteNotFound: React.FC = () => {
  useEffect(() => {
    currentPageHeaderStore.setBreadcrumbs("Not found")
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

const PageWrapper: React.FC<{ pageTitle: string; component: ComponentType; pagePath: string }> = ({
  pageTitle,
  component,
  pagePath,
  ...rest
}) => {
  const services = useServices()
  useEffect(() => {
    services.analyticsService.onPageLoad({
      pagePath: pagePath,
    })
    document["title"] = `Jitsu : ${pageTitle}`
    currentPageHeaderStore.setBreadcrumbs(pageTitle)
  }, [])
  const Component = component as ExoticComponent
  return (
    <React.Suspense fallback={<CenteredSpin />}>
      <Component {...(rest as any)} />
    </React.Suspense>
  )
}

const ProjectRoute: React.FC<{ projects: Project[] }> = ({ projects }) => {
  const services = useServices()
  const history = useHistory()
  const location = useLocation()
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [project, setProject] = useState<Project | undefined | null>()
  const { projectId } = useParams<{ projectId: string }>()

  useEffect(() => {
    ;(async () => {
      let project = projects.find(project => project.id === projectId)
      if (!project) {
        if (projects.length === 0) services.userService.removeAuth(reloadPage)
        actionNotification.warn(
          <>
            Project with ID <b>{projectId}</b> not found. Redirected to <b>{projects[0].name}</b> project.
          </>
        )
        history.push(`/${location.pathname.split("/").slice(2).join("/")}`) // removes `prj-{id}` from the path
        project = projects[0]
      }
      services.activeProject = project
      setProject(project)
      try {
        await initializeAllStores()
        setInitialized(true)
      } catch (e) {
        setError(e)
      }
    })()
  }, [])

  if (!error && !initialized) {
    return <Preloader text="Loading project data..." />
  } else if (error) {
    return (
      <div className="flex items-start pt-12 justify-center w-full">
        <ErrorCard title={"Failed to load project data"} description={error.message} stackTrace={error.stack} />
      </div>
    )
  }

  services.activeProject = project

  return (
    <>
      <ApplicationPage>
        <Switch>
          {projectRoutes.map(({ component, pageTitle, path, isPrefix }) => (
            <Route
              exact={!isPrefix}
              path={(typeof path === "string" ? [path] : path).map(path =>
                path.indexOf("/prj-") >= 0 ? path : `/prj-:projectId${path}`
              )}
              render={page => (
                <PageWrapper pageTitle={pageTitle} component={component} pagePath={page.location.key} {...page} />
              )}
              key={`${path}-${pageTitle}`}
            />
          ))}
          <Route>
            <RouteNotFound />
          </Route>
        </Switch>
      </ApplicationPage>
      <BillingGlobalGuard />
      {project.requiresSetup && <OnboardingTourLazyLoader project={project} />}
      {services.userService.getUser().forcePasswordChange && (
        <SetNewPasswordModal onCompleted={async () => reloadPage()} />
      )}
    </>
  )
}

const ProjectRedirect: React.FC<{ projects: Project[] }> = ({ projects }) => {
  const location = useLocation()
  if (!projects?.length) {
    return <ErrorCard title="Invalid state" description="projects.length should be greater than zero" />
  }
  return <Redirect to={`/prj-${projects[0].id}${location.pathname}`} />
}

// export default class App extends React.Component<{ projectId?: string }, AppState> {
//   private readonly services: ApplicationServices

//   constructor(props: any, context: any) {
//     super(props, context)
//     this.services = ApplicationServices.get()
//     setDebugInfo("applicationServices", this.services, false)
//     this.state = {
//       lifecycle: AppLifecycle.LOADING,
//       extraControls: null,
//     }
//   }

//   componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
//     this.services.analyticsService.onGlobalError(error)
//   }

//   public async componentDidMount() {
//     try {
//       const { user, paymentPlanStatus } = await initializeApplication(this.services)

//       this.setState({
//         lifecycle: user ? AppLifecycle.APP : AppLifecycle.REQUIRES_LOGIN,
//         user: user,
//         paymentPlanStatus: paymentPlanStatus,
//       })

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

//     window.setTimeout(() => {
//       if (this.state.lifecycle == AppLifecycle.LOADING) {
//         this.services.analyticsService.onGlobalError(new Error("Login timeout"))
//         this.setState({ lifecycle: AppLifecycle.ERROR, globalErrorDetails: "Timeout" })
//       }
//     }, LOGIN_TIMEOUT)
//   }

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

//   public render() {
//     return <React.Suspense fallback={<CenteredSpin />}>{this.getRenderComponent()}</React.Suspense>
//   }

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
