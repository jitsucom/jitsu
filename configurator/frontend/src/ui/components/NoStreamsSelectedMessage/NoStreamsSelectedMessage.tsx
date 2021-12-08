import { Button } from "antd"
import { useHistory } from "react-router"

type Props = {
  editSourceLink?: string
}

export const NoStreamsSelectedMessage: React.FC<Props> = ({ editSourceLink }) => {
  const history = useHistory()
  return (
    <div className={`flex flex-col`}>
      <span className="mb-1">
        Can't perform sync because no data streams were selected for this source. Please, select at least one stream in
        the <b>Streams</b> section of source configuration.
      </span>
      {editSourceLink && (
        <Button
          className="self-center"
          onClick={() => {
            history.push(editSourceLink)
          }}
        >
          Edit Source
        </Button>
      )}
    </div>
  )
}
