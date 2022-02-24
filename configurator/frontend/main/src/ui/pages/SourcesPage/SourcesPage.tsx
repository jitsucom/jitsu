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
import { CenteredError, CenteredSpin } from "lib/components/components"
import { BillingCheckRedirect } from "lib/components/BillingCheckRedirect/BillingCheckRedirect"
// @Store
import { sourcesStore } from "stores/sources"
// @Styles
import "./SourcesPage.less"
// @Types
import { BreadcrumbsProps } from "ui/components/Breadcrumbs/Breadcrumbs"
import { PageProps } from "navigation"
import { ErrorBoundary } from "lib/components/ErrorBoundary/ErrorBoundary"
import { SourceEditor } from "./partials/SourceEditor/SourceEditor/SourceEditor"
import { EntitiesStoreState } from "stores/types.enums"
import { CurrentSubscription } from "lib/services/billing"

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
    subscription => sourcesStore.list.length >= (subscription?.currentPlan.quota.sources ?? 999),
    [sourcesStore.list.length]
  )

  if (sourcesStore.state === EntitiesStoreState.GLOBAL_ERROR) {
    throw new Error(
      sourcesStore.error ??
        `Internal error occured in sources management tool. Please, contact support or file an issue.`
    )
  } else if (sourcesStore.state === EntitiesStoreState.GLOBAL_LOADING) {
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
