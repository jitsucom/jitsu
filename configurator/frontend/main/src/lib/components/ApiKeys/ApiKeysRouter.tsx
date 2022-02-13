import { Route, Switch } from "react-router-dom"
import { ApiKeyEditor, apiKeysRoutes } from "./ApiKeyEditor"
import ApiKeys from "./ApiKeys"

const ApiKeysRouter: React.FC<{}> = () => {
  return <Switch>
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
}

export default ApiKeysRouter;