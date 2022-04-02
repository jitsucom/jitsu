// @Libs
import { useParams } from "react-router-dom"
// @Store
import { apiKeysStore } from "stores/apiKeys"
// @Components
import { StatusPage } from "lib/components/StatusPage/StatusPage"
import { EntityNotFound } from "ui/components/EntityNotFound/EntityNotFound"
import { apiKeysRoutes } from "./ApiKeysRouter"
import { projectRoute } from "../ProjectLink/ProjectLink"

type StatisticsPageParams = {
  id: string
}

export const ApiKeyStatistics: React.FC = () => {
  const params = useParams<StatisticsPageParams>()
  const apiKey = apiKeysStore.list.find(k => k.uid === params.id)

  return apiKey ? (
    // <StatusPage apiKeyId={apiKey.uid} />
    <StatusPage
      entityId={apiKey.uid}
      entityType="api_key"
      entitiesListRoute={projectRoute(apiKeysRoutes.listExact)}
      editEntityRoute={projectRoute(apiKeysRoutes.editExact, { id: apiKey.uid })}
    />
  ) : (
    <EntityNotFound entityDisplayType="API Key" entityId={params.id} entitiesListRoute={apiKeysRoutes.listExact} />
  )
}
