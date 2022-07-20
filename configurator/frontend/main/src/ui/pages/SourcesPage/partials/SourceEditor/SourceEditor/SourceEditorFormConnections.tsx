// @Libs
import { useCallback, useEffect, useMemo } from "react"
import { observer } from "mobx-react-lite"
// @Store
import { destinationsStore } from "stores/destinations"
// @Catalog
import { destinationsReferenceMap } from "@jitsu/catalog"
// @Components
import { SourceEditorFormConnectionsView } from "./SourceEditorFormConnectionsView"
// @Types
import { Destination } from "@jitsu/catalog"
import { SetSourceEditorState } from "./SourceEditor"
// @Utils
import { cloneDeep } from "lodash"

type Props = {
  initialSourceData: Optional<Partial<SourceData>>
  setSourceEditorState: SetSourceEditorState
}

export interface ConnectedItem {
  id: string
  disabled?: boolean
  title: React.ReactNode
  description?: React.ReactNode
}

const CONNECTIONS_SOURCEDATA_PATH = "destinations"

const SourceEditorFormConnectionsComponent: React.FC<Props> = ({ initialSourceData, setSourceEditorState }) => {
  const destinations = destinationsStore.list

  const destinationsList = useMemo<ConnectedItem[]>(
    () =>
      destinations?.map((dst: DestinationData) => {
        const reference = destinationsReferenceMap[dst._type]
        return {
          id: dst._uid,
          disabled: reference?.syncFromSourcesStatus !== "supported",
          title: (
            <NameWithPicture icon={reference?.ui.icon}>
              <b>{reference?.displayName}</b>: {dst.displayName || dst._id}
            </NameWithPicture>
          ),
          description: <i className="text-xs">{getDescription(reference)}</i>,
        }
      }) ?? [],
    [destinations]
  )

  const preparedInitialValue = useMemo(() => initialSourceData?.destinations ?? [], [initialSourceData])

  const handleChange = useCallback(
    (connections: string[]) => {
      setConnections(setSourceEditorState, CONNECTIONS_SOURCEDATA_PATH, connections)
    },
    [setConnections]
  )

  useEffect(() => {
    setConnections(setSourceEditorState, CONNECTIONS_SOURCEDATA_PATH, preparedInitialValue, {
      doNotSetStateChanged: true,
    })
  }, [])

  return (
    <SourceEditorFormConnectionsView
      itemsList={destinationsList}
      initialValues={preparedInitialValue}
      handleItemChange={handleChange}
    />
  )
}

const SourceEditorFormConnections = observer(SourceEditorFormConnectionsComponent)

SourceEditorFormConnections.displayName = "SourceEditorFormConnections"

export { SourceEditorFormConnections }

/** */

/**
 * Helpers
 */

/** */

const setConnections = (
  setSourceEditorState: SetSourceEditorState,
  sourceDataPath: string,
  connectionsIds: string[],
  options?: {
    doNotSetStateChanged?: boolean
  }
): void => {
  setSourceEditorState(state => {
    const newState = cloneDeep(state)
    newState.connections.connections[sourceDataPath] = connectionsIds
    if (!options?.doNotSetStateChanged) newState.stateChanged = true
    return newState
  })
}

function getDescription(reference: Destination) {
  if (reference?.syncFromSourcesStatus === "supported") {
    return null
  } else if (reference?.syncFromSourcesStatus === "coming_soon") {
    return `${reference?.displayName} synchronization is coming soon! At the moment, it's not available`
  } else {
    return `${reference?.displayName} synchronization is not supported`
  }
}

const NameWithPicture: React.FC<{
  icon: React.ReactNode
  children: React.ReactNode
}> = ({ icon, children }) => {
  return (
    <span>
      <span className="w-6 inline-block align-middle">
        <span className="flex items-center justify-center pr-1">{icon}</span>
      </span>
      <span className="inline-block align-middle">{children}</span>
    </span>
  )
}
