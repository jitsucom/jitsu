import { Button } from "antd"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { useHistory } from "react-router-dom"
import { destinationPageRoutes } from "../../DestinationsPage.routes"

type Props = {
  destinationId?: string
}

export const DestinationNotFound: React.FC<Props> = ({ destinationId }) => {
  const history = useHistory()
  return (
    <section className="flex flex-col justify-center items-center w-full h-full">
      <span className="text-7xl" role="img">
        {"🕵"}
      </span>
      <h3 className="text-4xl">
        Destination {destinationId && <span className="font-extrabold">{destinationId}</span>} not found
      </h3>
      <Button type="primary" size="large" onClick={() => history.push(projectRoute(destinationPageRoutes.root))}>
        {"Go to Destinations List"}
      </Button>
    </section>
  )
}
