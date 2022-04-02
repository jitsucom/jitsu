import { Route, Switch } from "react-router-dom"
import { ApiKeyEditor } from "./ApiKeyEditor"
import ApiKeys from "./ApiKeys"
import { ApiKeyStatistics } from "./ApiKeyStatistics"

export const apiKeysRoutes = {
  newExact: "/prj-:projectId/api-keys/new",
  listExact: "/prj-:projectId/api-keys",
  editExact: "/prj-:projectId/api-keys/edit/:id",
  statisticsExact: "/prj-:projectId/api-keys/statistics/:id",
} as const

const ApiKeysRouter: React.FC<{}> = () => {
  return (
    <Switch>
      <Route exact path={apiKeysRoutes.listExact}>
        <ApiKeys />
      </Route>
      <Route exact path={apiKeysRoutes.newExact}>
        <ApiKeyEditor />
      </Route>
      <Route exact path={apiKeysRoutes.editExact}>
        <ApiKeyEditor />
      </Route>
      <Route exact path={apiKeysRoutes.statisticsExact}>
        <ApiKeyStatistics />
      </Route>
    </Switch>
  )
}

export default ApiKeysRouter
