import { Route, Switch } from "react-router-dom"
import { ApiKeyEditor } from "./ApiKeyEditor"
import ApiKeys from "./ApiKeys"

export const apiKeysRoutes = {
  newExact: "/prj-:projectId/api-keys/new",
  listExact: "/prj-:projectId/api-keys",
  editExact: "/prj-:projectId/api-keys/:id",
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
    </Switch>
  )
}

export default ApiKeysRouter
