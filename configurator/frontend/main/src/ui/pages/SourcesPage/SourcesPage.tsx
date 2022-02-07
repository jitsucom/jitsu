// @Libs
import { Route, Switch, useParams } from "react-router-dom"
import { observer } from "mobx-react-lite"
// @Routes
import { sourcesPageRoutes } from "./SourcesPage.routes"
// @Components
import { SourcesList } from "./partials/SourcesList/SourcesList"
import { AddSourceDialog } from "./partials/AddSourceDialog/AddSourceDialog"
import { CenteredError, CenteredSpin } from "lib/components/components"
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

  if (sourcesStore.state === EntitiesStoreState.GLOBAL_ERROR) {
    return <CenteredError error={sourcesStore.error} />
  } else if (sourcesStore.state === EntitiesStoreState.GLOBAL_LOADING) {
    return <CenteredSpin />
  }

  return (
    <Switch>
      <Route path={sourcesPageRoutes.root} exact>
        <ErrorBoundary>
          <SourcesList {...{ setBreadcrumbs }} />
        </ErrorBoundary>
      </Route>
      <Route path={sourcesPageRoutes.addExact} strict={false} exact>
        <ErrorBoundary>
          <SourceEditor {...{ setBreadcrumbs, editorMode: "add" }} />
        </ErrorBoundary>
      </Route>
      <Route path={sourcesPageRoutes.add} strict={false} exact>
        <ErrorBoundary>
          <AddSourceDialog />
        </ErrorBoundary>
      </Route>
      <Route path={sourcesPageRoutes.editExact} strict={false} exact>
        <ErrorBoundary>
          <SourceEditor key={params?.["sourceId"] || "static_key"} {...{ setBreadcrumbs, editorMode: "edit" }} />
        </ErrorBoundary>
      </Route>
    </Switch>
  )
}

const SourcesPage = observer(SourcesPageComponent)

SourcesPage.displayName = "SourcesPage"

export default SourcesPage
