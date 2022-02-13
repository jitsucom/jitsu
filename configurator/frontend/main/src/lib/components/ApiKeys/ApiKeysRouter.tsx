import { Route, Switch } from "react-router-dom"
import { apiKeysRoutes } from "./ApiKeyEditor"
import ApiKeys from "./ApiKeys"

const ApiKeysRouter: React.FC<{}> = () => {
  return <Switch>
    <Route exact path={apiKeysRoutes.listExact}>
      <ApiKeys />
    </Route>
  </Switch>
}

export default ApiKeysRouter;