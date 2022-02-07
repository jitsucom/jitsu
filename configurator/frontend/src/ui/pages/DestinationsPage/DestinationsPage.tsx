// @Libs
import { useCallback } from "react"
import { Route, Switch, useParams } from "react-router-dom"
import { observer } from "mobx-react-lite"
// @Pages
import { DestinationsList } from "./partials/DestinationsList/DestinationsList"
import { DestinationEditor } from "./partials/DestinationEditor/DestinationEditor"
// @Store
import { destinationsStore, DestinationsStoreState } from "stores/destinations"
import { sourcesStore, SourcesStoreState } from "stores/sources"
// @Routes
import { destinationPageRoutes } from "./DestinationsPage.routes"
// @Components
import { CenteredError, CenteredSpin } from "lib/components/components"
// @Hooks
import { useServices } from "hooks/useServices"
// @Types
import { PageProps } from "navigation"
import { BreadcrumbsProps } from "ui/components/Breadcrumbs/Breadcrumbs"
import { DestinationStatistics } from "./partials/DestinationStatistics/DestinationStatistics"
import { ErrorBoundary } from "../../../lib/components/ErrorBoundary/ErrorBoundary"
import { AddDestinationDialog } from "./partials/AddDestinationDialog/AddDestinationDialog"
import { CurrentSubscription } from "lib/services/billing"
import { BillingCheckRedirect } from "lib/components/BillingCheckRedirect/BillingCheckRedirect"

export interface CollectionDestinationData {
  destinations: DestinationData[]
  _lastUpdated?: string
}

export interface CommonDestinationPageProps {
  setBreadcrumbs: (breadcrumbs: BreadcrumbsProps) => void
  editorMode?: "edit" | "add"
}

const DestinationsPageComponent: React.FC<PageProps> = ({ setBreadcrumbs }) => {
  const params = useParams<unknown>()
  const services = useServices()

  const isDestinationsLimitReached = useCallback<(subscription?: CurrentSubscription) => boolean>(
    subscription => destinationsStore.destinations.length >= (subscription?.currentPlan.quota.destinations ?? 999),
    [destinationsStore.destinations.length]
  )

  if (destinationsStore.state === DestinationsStoreState.GLOBAL_ERROR) {
    return <CenteredError error={destinationsStore.error} />
  } else if (
    destinationsStore.state === DestinationsStoreState.GLOBAL_LOADING ||
    sourcesStore.state === SourcesStoreState.GLOBAL_LOADING
  ) {
    return <CenteredSpin />
  }

  return (
    <ErrorBoundary>
      <Switch>
        <Route path={destinationPageRoutes.root} exact>
          <DestinationsList setBreadcrumbs={setBreadcrumbs} />
        </Route>
        <Route path={destinationPageRoutes.editExact} strict={false} exact>
          <DestinationEditor
            /**
             * Changing `key` forces react to re-mount the component and
             * to assemble a fresh form
             */
            key={params?.["id"] || "static_key"}
            {...{ setBreadcrumbs, editorMode: "edit" }}
          />
        </Route>
        <Route path={destinationPageRoutes.statisticsExact} strict={false} exact>
          <DestinationStatistics setBreadcrumbs={setBreadcrumbs} />
        </Route>
        <BillingCheckRedirect
          quotaExceededRedirectTo={destinationPageRoutes.root}
          quotaExceedeMessage={
            <>
              You current plan allows to have only {services.currentSubscription.currentPlan.quota.destinations}{" "}
              destinations
            </>
          }
          isQuotaExceeded={isDestinationsLimitReached}
        >
          <Switch>
            <Route path={destinationPageRoutes.add} strict={false} exact>
              <AddDestinationDialog />
            </Route>
            <Route path={destinationPageRoutes.newExact} strict={false} exact>
              <DestinationEditor {...{ setBreadcrumbs, editorMode: "add" }} />
            </Route>
          </Switch>
        </BillingCheckRedirect>
      </Switch>
    </ErrorBoundary>
  )
}

const DestinationsPage = observer(DestinationsPageComponent)

DestinationsPage.displayName = "DestinationsPage"

export default DestinationsPage
