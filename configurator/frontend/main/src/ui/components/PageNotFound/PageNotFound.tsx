import { Button } from "antd"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { useHistory } from "react-router-dom"
import { NotFound } from "../NotFound/NotFound"

type Props = {
  homeUrl: string
}

export const PageNotFound: React.FC<Props> = ({ homeUrl }) => {
  const history = useHistory()
  return (
    <NotFound
      body={"Page not found"}
      footer={
        <Button type="primary" size="large" onClick={() => history.push(projectRoute(homeUrl))}>
          {`Go to the Homepage`}
        </Button>
      }
    />
  )
}
