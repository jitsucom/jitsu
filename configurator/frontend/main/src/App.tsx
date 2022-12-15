// @Libs
import React, { ComponentType, ExoticComponent, useEffect, useState } from "react"
import { Redirect, Route, Switch, useLocation, NavLink } from "react-router-dom"
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
import { ApplicationPage, SlackChatWidget } from "./Layout"
import { CenteredSpin, Preloader } from "./lib/components/components"
import { actionNotification } from "ui/components/ActionNotification/ActionNotification"
import { SetNewPasswordModal } from "lib/components/SetNewPasswordModal/SetNewPasswordModal"
import { BillingGlobalGuard } from "lib/components/BillingGlobalGuard/BillingGlobalGuard"
import { OnboardingTourLazyLoader } from "./lib/components/Onboarding/OnboardingTourLazyLoader"
import { ErrorCard } from "./lib/components/ErrorCard/ErrorCard"
import { LoginLink } from "./lib/components/LoginLink/LoginLink"
// @Icons
import { ExclamationCircleOutlined, ReloadOutlined } from "@ant-design/icons"
// @Hooks
import { useServices } from "./hooks/useServices"
// @Utils
import { createError, reloadPage, setDebugInfo } from "./lib/commons/utils"
// @Types
import { Project, ProjectWithPermissions } from "./generated/conf-openapi"
// @Pages
import LoginPage from "./ui/pages/GetStartedPage/LoginPage"
import SignupPage from "./ui/pages/GetStartedPage/SignupPage"
import { StatusPage } from "./lib/components/StatusPage/StatusPage"
import { UserSettings } from "./lib/components/UserSettings/UserSettings"
import { Settings } from "./lib/services/UserSettingsService"

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
const ChangePasswordOnResetForm = React.lazy(
  () => import(/* webpackPrefetch: true */ "./lib/components/ChangePasswordOnResetForm/ChangePasswordOnResetForm")
)
const DownloadConfig = React.lazy(
  () => import(/* webpackPrefetch: true */ "./lib/components/DownloadConfig/DownloadConfig")
)

export const initializeApplication = async (setDescription: (d: string) => void): Promise<ApplicationServices> => {
  const services = ApplicationServices.get()
  await services.init()
  await services.loadPluginScript()
  setDescription("Authenticating...")
  await services.userService.waitForUser()
  if (services.userService.hasUser()) {
    setDebugInfo("user", services.userService.getUser())
    services.analyticsService.onUserKnown(services.userService.getUser())
  }
  return services
}

const initializeBilling = async (services: ApplicationServices, projectId: string) => {
  let currentSubscription: CurrentSubscription
  if (services.userService.hasUser() && services.features.billingEnabled && projectId) {
    currentSubscription = await getCurrentSubscription(
      projectId,
      services.backendApiClient,
      destinationsStore,
      sourcesStore
    )
  } else {
    currentSubscription = {
      subscriptionIsManagedByStripe: false,
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
  services.currentSubscription = currentSubscription
}

const initializeProject = async (
  projectId: string,
  projects: ProjectWithPermissions[]
): Promise<ProjectWithPermissions | null> => {
  const project = projects.find(project => project.id === projectId) ?? null
  if (project) {
    const services = ApplicationServices.get()
    services.activeProject = project
  }
  return project
}

export const Application: React.FC = function () {
  const [services, setServices] = useState<ApplicationServices>()
  const [projects, setProjects] = useState<Project[]>(null)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<Error>()
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  const [preloaderText, setPreloader] = useState("Loading application, please be patient...")

  useEffect(() => {
    ;(async () => {
      try {
        const application = await initializeApplication(description => {
          setPreloader(description)
        })
        if (application.userService.hasUser()) {
          const projects = await application.projectService.getAvailableProjects()
          if (projects.length === 0) {
            const newProject = await application.projectService.createProject(
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
        const msg = `Can't initialize application with backend ${
          process.env.BACKEND_API_BASE || " (BACKEND_API_BASE is not set)"
        }: ${e?.message || "unknown error"}`
        console.log(msg, e)
        setError(createError(msg, e))
      }
    })()
  }, [projectId])

  useEffect(() => {
    ;(async () => {
      const isAppOutdated = await services?.isAppVersionOutdated()
      if (isAppOutdated) {
        actionNotification.warn(
          <>
            New version of Jitsu available! Please reload the page to get the latest update.
            <br />
            <Button
              className="mt-5 mb-2"
              size="large"
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>{" "}
          </>,
          { duration: 0, className: "app-update-notice box-shadow-base" }
        )
      }
    })()
  }, [location, services])

  if (!error && !initialized) {
    return <Preloader />
  } else if (error) {
    console.error("Initialization error", error)
    if (services?.analyticsService) {
      services.analyticsService.onGlobalError(error, true)
    } else {
      console.error("Failed to send error to analytics service, it's not defined yet")
    }
    return (
      <div className="w-full flex items-center justify-center">
        <div className="w-3/4">
          <ErrorCard title={"Failed to initialize application"} description={error.message} stackTrace={error.stack} />
        </div>
      </div>
    )
  }

  if (!services.userService.hasUser()) {
    return (
      <React.Suspense fallback={<CenteredSpin />}>
        {services.showSelfHostedSignUp() && <SetupForm />}
        {!services.showSelfHostedSignUp() && (
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
              render={pageOf(ChangePasswordOnResetForm, { pageTitle: "Jitsu : Reset Password" })}
            />
            <Redirect to="/" />
          </Switch>
        )}
      </React.Suspense>
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
                    ← Back to Jitsu
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
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [project, setProject] = useState<Project | undefined | null>()
  const { projectId } = useParams<{ projectId: string }>()

  useEffect(() => {
    setInitialized(false)
    ;(async () => {
      let project = await initializeProject(projectId, projects)
      if (!project) {
        if (!projects || projects.length === 0) {
          services.userService.removeAuth(reloadPage)
        }
        const lastUsedProject = services.userSettingsService.get(Settings.ActiveProject)?.id || projects[0]?.id
        setProjectIdRedirectedFrom(projectId)
        window.location.replace(window.location.href.replace(projectId, lastUsedProject))
        return
      }
      setProject(project)
      try {
        await initializeAllStores(services.analyticsService)
        await initializeBilling(services, projectId)
        setInitialized(true)
      } catch (e) {
        setError(e)
      }
    })()
  }, [projectId])

  /** Show a message to user if they were redirected from a different project */
  useEffect(() => {
    const redirectedFromProjectId = getProjectIdRedirectedFrom()
    if (redirectedFromProjectId && project?.name) {
      window.sessionStorage.removeItem("redirectedFromProjectId")
      actionNotification.warn(
        <>
          Project with ID <b>{redirectedFromProjectId}</b> not found. Redirected to <b>{project.name}</b> project.
        </>
      )
    }
  }, [])

  /** Saves the last successfully initialized project to local storage */
  useEffect(() => {
    if (initialized && !error && project?.id) {
      services.userSettingsService.set({ [Settings.ActiveProject]: project })
    }
  }, [error, initialized, project?.id])

  if (!error && !initialized) {
    return <Preloader text="Loading project data..." />
  } else if (error) {
    return (
      <div className="flex items-start pt-12 justify-center w-full">
        <ErrorCard title={"Failed to load project data"} description={error.message} stackTrace={error.stack} />
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
      <SlackChatWidget />
      {project.requiresSetup && <OnboardingTourLazyLoader project={project} />}
      {services.userService.getUser().forcePasswordChange && (
        <SetNewPasswordModal onCompleted={async () => reloadPage()} />
      )}
    </>
  )
}

const ProjectRedirect: React.FC<{ projects: Project[] }> = ({ projects }) => {
  const location = useLocation()
  const services = useServices()
  const lastUsedProject = services.userSettingsService.get(Settings.ActiveProject)?.id
  if (!projects?.length) {
    return <ErrorCard title="Invalid state" description="projects.length should be greater than zero" />
  }
  return <Redirect to={`/prj-${lastUsedProject ?? projects[0].id}${location.pathname}`} />
}

function getProjectIdRedirectedFrom(): string | null | undefined {
  return window.sessionStorage.getItem("redirectedFromProjectId")
}

function setProjectIdRedirectedFrom(id: string): void {
  window.sessionStorage.setItem("redirectedFromProjectId", id)
}
