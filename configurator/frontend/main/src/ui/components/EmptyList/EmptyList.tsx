// @Libs
import { ReactElement, ReactNode, useCallback, useMemo } from "react"
import { Modal } from "antd"
import { flowResult } from "mobx"
import { observer } from "mobx-react-lite"
import { useHistory } from "react-router-dom"
// @Components
import { EmptyListView } from "./EmptyListView"
// @Commons
import { useServices } from "hooks/useServices"
import { destinationsStore } from "stores/destinations"

export interface Props {
  title: ReactNode
  list?: ReactElement
  handleAddClick?: () => void
  unit: string
}

const EmptyListComponent = ({ title, list, handleAddClick, unit }: Props) => {
  const router = useHistory()
  const services = useServices()

  const needShowCreateDemoDatabase = useMemo<boolean>(
    () => services.features.createDemoDatabase,
    [services.features.createDemoDatabase]
  )

  const handleCreateFreeDatabase = useCallback<() => Promise<void>>(async () => {
    await flowResult(destinationsStore.createFreeDatabase())
    const modal = Modal.info({
      title: "New destination has been created",
      content: (
        <>
          We have created a Postgres database for you. Also we made sure that{" "}
          <a
            onClick={() => {
              modal.destroy()
              router.push("/api_keys")
            }}
          >
            API key
          </a>{" "}
          has been created and linked to current destination.
          <br />
          Read more on how to send data to Jitsu with{" "}
          <a target="_blank" href="https://jitsu.com/docs/sending-data/js-sdk">
            JavaScript SDK
          </a>{" "}
          or{" "}
          <a target="_blank" href="https://jitsu.com/docs/sending-data/api">
            HTTP API
          </a>
        </>
      ),
      onOk: () => modal.destroy(),
    })
  }, [router])

  return (
    <EmptyListView
      title={title}
      list={list}
      handleAddClick={handleAddClick}
      unit={unit}
      hideFreeDatabaseSeparateButton={!needShowCreateDemoDatabase}
      handleCreateFreeDatabase={handleCreateFreeDatabase}
    />
  )
}

const EmptyList = observer(EmptyListComponent)
EmptyList.displayName = "EmptyList"

export { EmptyList }
