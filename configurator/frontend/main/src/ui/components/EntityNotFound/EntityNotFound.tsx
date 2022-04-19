import { Button } from "antd"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { useHistory } from "react-router-dom"
import { NotFound } from "../NotFound/NotFound"

type Props = {
  entityDisplayType: "API Key" | "Source" | "Destination"
  entityId: string
  entitiesListRoute: string
}

export const EntityNotFound: React.FC<Props> = ({ entityDisplayType, entityId, entitiesListRoute }) => {
  const history = useHistory()
  return (
    <NotFound
      body={
        <>
          {entityDisplayType} with ID {entityId && <span className="font-extrabold">{entityId}</span>} not found
        </>
      }
      footer={
        <Button type="primary" size="large" onClick={() => history.push(projectRoute(entitiesListRoute))}>
          {`Go to ${entityDisplayType}s List`}
        </Button>
      }
    />
  )
}
