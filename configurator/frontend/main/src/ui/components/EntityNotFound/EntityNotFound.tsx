import { Button } from "antd"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { useHistory } from "react-router-dom"

type Props = {
  entityDisplayType: "API Key" | "Source" | "Destination"
  entityId: string
  entitiesListRoute: string
}

export const EntityNotFound: React.FC<Props> = ({ entityDisplayType, entityId, entitiesListRoute }) => {
  const history = useHistory()
  return (
    <section className="flex flex-col justify-center items-center w-full h-full">
      <span className="text-7xl" role="img">
        {"🕵"}
      </span>
      <h3 className="text-4xl">
        {entityDisplayType} with ID {entityId && <span className="font-extrabold">{entityId}</span>} not found
      </h3>
      <Button type="primary" size="large" onClick={() => history.push(projectRoute(entitiesListRoute))}>
        {`Go to ${entityDisplayType}s List`}
      </Button>
    </section>
  )
}
