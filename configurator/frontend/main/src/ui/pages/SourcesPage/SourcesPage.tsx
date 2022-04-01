// @Libs
import { useCallback } from "react"
import { Route, Switch, useParams } from "react-router-dom"
import { observer } from "mobx-react-lite"
// @Routes
import { sourcesPageRoutes } from "./SourcesPage.routes"
// @Services
import { useServices } from "hooks/useServices"
// @Components
import { SourcesList } from "./partials/SourcesList/SourcesList"
import { AddSourceDialog } from "./partials/AddSourceDialog/AddSourceDialog"
import { CenteredSpin } from "lib/components/components"
import { BillingCheckRedirect } from "lib/components/BillingCheckRedirect/BillingCheckRedirect"
// @Store
import { sourcesStore } from "stores/sources"
// @Styles
import "./SourcesPage.less"
// @Types
import { ErrorBoundary } from "lib/components/ErrorBoundary/ErrorBoundary"
import { SourceEditor } from "./partials/SourceEditor/SourceEditor/SourceEditor"
import { CurrentSubscription } from "lib/services/billing"
import { EntitiesStoreStatus } from "stores/entitiesStore"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { TaskLogsPage } from "../TaskLogs/TaskLogsPage"
import { TaskLogViewer } from "../TaskLogs/TaskLogViewer"

export interface CollectionSourceData {
  sources: SourceData[]
  _lastUpdated?: string
}

export interface CommonSourcePageProps {
  editorMode?: "edit" | "add"
}

const SourcesPageComponent: React.FC<CommonSourcePageProps> = () => {
  const params = useParams<unknown>()
  const services = useServices()

  const isSourcesLimitReached = useCallback<(subscription?: CurrentSubscription) => boolean>(
    subscription => sourcesStore.list.length >= (subscription?.currentPlan.quota.sources ?? 999),
    [sourcesStore.list.length]
  )

  if (sourcesStore.status === EntitiesStoreStatus.GLOBAL_ERROR) {
    throw new Error(
      sourcesStore.errorMessage ??
        `Internal error occured in sources management tool. Please, contact support or file an issue.`
    )
  } else if (sourcesStore.status === EntitiesStoreStatus.GLOBAL_LOADING) {
    return <CenteredSpin />
  }

  return (
    <ErrorBoundary>
      <Switch>
        <Route path={sourcesPageRoutes.root} exact>
          <SourcesList />
        </Route>
        <Route path={sourcesPageRoutes.editExact} strict={false} exact>
          <SourceEditor key={params?.["sourceId"] || "static_key"} editorMode="edit" />
        </Route>
        <Route path={sourcesPageRoutes.logs} strict={false} exact>
          <TaskLogsPage />
        </Route>
        <Route path={sourcesPageRoutes.task} strict={false} exact>
          <TaskLogViewer />
        </Route>
        <BillingCheckRedirect
          quotaExceededRedirectTo={projectRoute(sourcesPageRoutes.root)}
          quotaExceedeMessage={
            <>You current plan allows to have only {services.currentSubscription.currentPlan.quota.sources} sources</>
          }
          isQuotaExceeded={isSourcesLimitReached}
        >
          <Switch>
            <Route path={sourcesPageRoutes.addExact} strict={false} exact>
              <SourceEditor editorMode="add" />
            </Route>
            <Route path={sourcesPageRoutes.add} strict={false} exact>
              <AddSourceDialog />
            </Route>
          </Switch>
        </BillingCheckRedirect>
      </Switch>
    </ErrorBoundary>
  )
}

const SourcesPage = observer(SourcesPageComponent)

SourcesPage.displayName = "SourcesPage"

export default SourcesPage
