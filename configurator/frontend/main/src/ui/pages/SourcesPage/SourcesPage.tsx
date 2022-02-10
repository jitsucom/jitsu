// @Libs
import { Route, Switch, useParams } from "react-router-dom"
import { observer } from "mobx-react-lite"
// @Routes
import { sourcesPageRoutes } from "./SourcesPage.routes"
// @Components
import { SourcesList } from "./partials/SourcesList/SourcesList"
import { AddSourceDialog } from "./partials/AddSourceDialog/AddSourceDialog"
import { CenteredError, CenteredSpin } from "lib/components/components"
import { BillingCheckRedirect } from "lib/components/BillingCheckRedirect/BillingCheckRedirect"
// @Store
import { sourcesStore, SourcesStoreState } from "stores/sources"
// @Styles
import "./SourcesPage.less"
// @Types
import { BreadcrumbsProps } from "ui/components/Breadcrumbs/Breadcrumbs"
import { PageProps } from "navigation"
import { ErrorBoundary } from "lib/components/ErrorBoundary/ErrorBoundary"
import { SourceEditor } from "./partials/SourceEditor/SourceEditor/SourceEditor"
import { useServices } from "hooks/useServices"
import { CurrentSubscription } from "lib/services/billing"
import { useCallback } from "react"

export interface CollectionSourceData {
  sources: SourceData[]
  _lastUpdated?: string
}

export type SetBreadcrumbs = (breadcrumbs: BreadcrumbsProps) => void

export interface CommonSourcePageProps {
  setBreadcrumbs: SetBreadcrumbs
  editorMode?: "edit" | "add"
}

const SourcesPageComponent: React.FC<PageProps> = ({ setBreadcrumbs }) => {
  const params = useParams<unknown>()
  const services = useServices()

  const isSourcesLimitReached = useCallback<(subscription?: CurrentSubscription) => boolean>(
    subscription => sourcesStore.sources.length >= (subscription?.currentPlan.quota.sources ?? 999),
    [sourcesStore.sources.length]
  )

  if (sourcesStore.state === SourcesStoreState.GLOBAL_ERROR) {
    return <CenteredError error={sourcesStore.error} />
  } else if (sourcesStore.state === SourcesStoreState.GLOBAL_LOADING) {
    return <CenteredSpin />
  }

  return (
    <ErrorBoundary>
      <Switch>
        <Route path={sourcesPageRoutes.root} exact>
          <SourcesList {...{ setBreadcrumbs }} />
        </Route>
        <Route path={sourcesPageRoutes.editExact} strict={false} exact>
          <SourceEditor key={params?.["sourceId"] || "static_key"} {...{ setBreadcrumbs, editorMode: "edit" }} />
        </Route>
        <BillingCheckRedirect
          quotaExceededRedirectTo={sourcesPageRoutes.root}
          quotaExceedeMessage={
            <>You current plan allows to have only {services.currentSubscription.currentPlan.quota.sources} sources</>
          }
          isQuotaExceeded={isSourcesLimitReached}
        >
          <Switch>
            <Route path={sourcesPageRoutes.addExact} strict={false} exact>
              <SourceEditor {...{ setBreadcrumbs, editorMode: "add" }} />
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
