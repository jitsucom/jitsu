// @Libs
import React, { ExoticComponent, LazyExoticComponent, ReactNode } from "react"
import { useLocation } from "react-router-dom"
// @Routes
import { destinationPageRoutes } from "ui/pages/DestinationsPage/DestinationsPage.routes"
// @???
import ComponentTest from "./lib/components/componentTest"
import { TaskLogsPage, taskLogsPageRoute } from "ui/pages/TaskLogs/TaskLogsPage"
import { SettingsPage, settingsPageRoutes } from "ui/pages/SettingsPage/SettingsPage"
import { taskLogsViewerRoute, TaskLogViewer } from "ui/pages/TaskLogs/TaskLogViewer"
import { sourcesPageRoutes } from "ui/pages/SourcesPage/SourcesPage.routes"
import { LoginLink } from "lib/components/LoginLink/LoginLink"
import SignupPage from "./ui/pages/GetStartedPage/SignupPage"
import LoginPage from "./ui/pages/GetStartedPage/LoginPage"
import { StatusPage } from "./lib/components/StatusPage/StatusPage"
import { apiKeysRoutes, ApiKeyEditor } from "./lib/components/ApiKeys/ApiKeyEditor"

// @Components

const ApiKeys = React.lazy(() => import(/* webpackPrefetch: true */ "./lib/components/ApiKeys/ApiKeys"))
const CustomDomains = React.lazy(
  () => import(/* webpackPrefetch: true */ "./lib/components/CustomDomains/CustomDomains")
)
const DestinationsPage = React.lazy(
  () => import(/* webpackPrefetch: true */ "ui/pages/DestinationsPage/DestinationsPage")
)
const DbtCloudPage = React.lazy(() => import(/* webpackPrefetch: true */ "ui/pages/DbtCloud/DbtCloudPage"))
const ProjectSettingsPage = React.lazy(() => import(/* webpackPrefetch: true */ "ui/pages/ProjectSettingsPage/ProjectSettingsPage"))
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

// const ApiKeys = null
// const CustomDomains = null
// const DestinationsPage = null
// const DbtCloudPage = null
// const GeoDataResolver = null

// const EventsStream = null
// const SetupForm = null
// const SourcesPage = null
// const ConnectionsPage = null
// const PasswordForm = null
// const DownloadConfig = null

// import ApiKeys from "./lib/components/ApiKeys/ApiKeys"
// import CustomDomains from "./lib/components/CustomDomains/CustomDomains"
// import DestinationsPage from "ui/pages/DestinationsPage/DestinationsPage"
// import DbtCloudPage from "ui/pages/DbtCloud/DbtCloudPage"

// import EventsStream from "./lib/components/EventsStream/EventsStream"
// import SetupForm from "ui/pages/SetupPage/SetupForm"
// import SourcesPage from "ui/pages/SourcesPage/SourcesPage"
// import ConnectionsPage from "ui/pages/ConnectionsPage/ConnectionsPage"
// import PasswordForm from "./lib/components/PasswordForm/PasswordForm"
// import DownloadConfig from "./lib/components/DownloadConfig/DownloadConfig"

export type PageLocation = {
  canonicalPath: string
  id: string
  mainMenuKey: string
}

export function usePageLocation(): PageLocation {
  const location = useLocation().pathname

  const canonicalPath = location === "/" || location === "" ? "/connections" : location

  const id = (canonicalPath.startsWith("/") ? canonicalPath.substr(1) : canonicalPath).replace("/", "")

  const mainMenuKey = canonicalPath.split("/")[1]

  return { canonicalPath, id, mainMenuKey }
}

export type PageProps = {
  setBreadcrumbs: (header: ReactNode) => void
  [propName: string]: any
}

type PageComponent = ExoticComponent | React.FC | React.Component
export class Page {
  readonly _component: PageComponent

  readonly pageTitle: string

  readonly path: string[]

  readonly pageHeader: React.ReactNode

  public getPrefixedPath(): string[] {
    return this.path.map(el => (el.startsWith("/") ? el : "/" + el))
  }

  constructor(pageTitle: string, path: string[] | string, component: PageComponent, pageHeader?: ReactNode) {
    this._component = component
    this.pageTitle = pageTitle
    this.pageHeader = pageHeader
    this.path = path instanceof Array ? path : [path]
  }

  get component(): PageComponent {
    return this._component
  }
}

export const SELFHOSTED_PAGES: Page[] = [new Page("Jitsu | setup", ["/", "/setup"], SetupForm)]

export const PUBLIC_PAGES: Page[] = [
  new Page("Jitsu | login with magic link", ["/login-link/:emailEncoded?"], LoginLink),
  new Page("Jitsu : Sign in", ["/", "/dashboard", "/login", "/signin"], LoginPage),
  new Page("Jitsu : Sign up", ["/register", "/signup"], SignupPage),
  new Page("Jitsu : reset password", ["/reset_password/:resetId"], PasswordForm),
]

export const PRIVATE_PAGES: Page[] = [
  new Page("Jitsu | connections", ["/connections", "/", ""], ConnectionsPage, "Connections"),
  new Page("Test Component", "/test", ComponentTest, "Component Test"),
  new Page("Jitsu | dashboard", "/dashboard", StatusPage, "Dashboard"),
  new Page("Jitsu | recent events", "/events_stream", EventsStream, "Recent events"),

  new Page(
    "Jitsu | edit destinations",
    Object.keys(destinationPageRoutes).map(key => destinationPageRoutes[key]),
    DestinationsPage,
    "Edit destinations"
  ),
  new Page("dbt Cloud integration", "/dbtcloud", DbtCloudPage, "dbt Cloud"),
  new Page("Jitsu | project settings", "/project_settings", ProjectSettingsPage, "Project settings"),
  new Page("Jitsu | geo data resolver", "/geo_data_resolver", GeoDataResolver, "Geo data resolver"),
  new Page("Jitsu | download config", "/cfg_download", DownloadConfig, "Download Jitsu Server configuration"),
  new Page("Jitsu | edit API keys", "/api-keys", ApiKeys, "API Keys"),
  new Page("Jitsu | edit custom domains", "/domains", CustomDomains, "Custom tracking domains"),
  new Page(
    "Jitsu | sources",
    Object.keys(sourcesPageRoutes).map(key => sourcesPageRoutes[key]),
    SourcesPage,
    "Sources"
  ),
  new Page(
    "Jitsu | sources",
    Object.keys(sourcesPageRoutes).map(key => sourcesPageRoutes[key]),
    SourcesPage,
    "Sources"
  ),
  new Page("Jitsu | task logs", taskLogsPageRoute, TaskLogsPage, "Task Logs"),
  new Page("Jitsu | Task Logs View", taskLogsViewerRoute, TaskLogViewer, "Task Logs"),
  new Page("Jitsu | Settings", settingsPageRoutes, SettingsPage, "Settings"),
  new Page("Edit API keys · Jitsu", [apiKeysRoutes.newExact, apiKeysRoutes.editExact], ApiKeyEditor, "Edit API Key"),
]
