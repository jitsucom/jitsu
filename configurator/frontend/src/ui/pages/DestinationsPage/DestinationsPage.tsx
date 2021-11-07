// @Libs
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
// @Types
import { PageProps } from "navigation"
import { BreadcrumbsProps } from "ui/components/Breadcrumbs/Breadcrumbs"
import { DestinationStatistics } from "./partials/DestinationStatistics/DestinationStatistics"

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

  if (destinationsStore.state === DestinationsStoreState.GLOBAL_ERROR) {
    return <CenteredError error={destinationsStore.error} />
  } else if (
    destinationsStore.state === DestinationsStoreState.GLOBAL_LOADING ||
    sourcesStore.state === SourcesStoreState.GLOBAL_LOADING
  ) {
    return <CenteredSpin />
  }

  return (
    <Switch>
      <Route path={destinationPageRoutes.root} exact>
        <DestinationsList setBreadcrumbs={setBreadcrumbs} />
      </Route>
      <Route path={destinationPageRoutes.newExact} strict={false} exact>
        <DestinationEditor {...{ setBreadcrumbs, editorMode: "add" }} />
      </Route>
      <Route path={destinationPageRoutes.editExact} strict={false} exact>
        <DestinationEditor
          /**
           * key changes forcing react to re-mount the component and
           * to assemble a fresh form
           */
          key={params?.["id"] || "static_key"}
          {...{ setBreadcrumbs, editorMode: "edit" }}
        />
      </Route>
      <Route path={destinationPageRoutes.statisticsExact} strict={false} exact>
        <DestinationStatistics setBreadcrumbs={setBreadcrumbs} />
      </Route>
    </Switch>
  )
}

const DestinationsPage = observer(DestinationsPageComponent)

export default DestinationsPage
