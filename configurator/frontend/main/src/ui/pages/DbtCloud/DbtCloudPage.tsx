// @Libs
import { observer } from "mobx-react-lite"
// @Pages
import { DestinationEditor } from "../DestinationsPage/partials/DestinationEditor/DestinationEditor"
// @Store
import { destinationsStore } from "stores/destinations"
import { sourcesStore } from "stores/sources"
// @Components
import { CenteredError, CenteredSpin } from "lib/components/components"
// @Types
import { useState } from "react"
import { useForceUpdate } from "../../../hooks/useForceUpdate"
import { EntitiesStoreStatus } from "stores/entitiesStore"

export interface CollectionDestinationData {
  destinations: DestinationData[]
  _lastUpdated?: string
}

export interface CommonDestinationPageProps {
  editorMode?: "edit" | "add"
}

const DbtCloudPageComponent: React.FC = () => {
  const [dbtCloudData, setDbtCloudData] = useState(
    destinationsStore.listHidden.find(value => value._type == "dbtcloud")
  )
  const [editorMode, setEditorMode] = useState((dbtCloudData ? "edit" : "add") as "edit" | "add")

  const forceUpdate = useForceUpdate()

  if (destinationsStore.status === EntitiesStoreStatus.GLOBAL_ERROR) {
    return <CenteredError error={destinationsStore.errorMessage} />
  } else if (
    destinationsStore.status === EntitiesStoreStatus.GLOBAL_LOADING ||
    sourcesStore.status === EntitiesStoreStatus.GLOBAL_LOADING
  ) {
    return <CenteredSpin />
  }
  const onSaveSucceded = function () {
    setDbtCloudData(destinationsStore.listHidden.find(value => value._type == "dbtcloud"))
    setEditorMode("edit")
    forceUpdate()
  }

  if (dbtCloudData) {
    return (
      <DestinationEditor
        {...{
          editorMode: editorMode,
          onAfterSaveSucceded: onSaveSucceded,
          paramsByProps: { type: "dbtcloud", standalone: "true", id: dbtCloudData._id },
        }}
      />
    )
  } else {
    return (
      <DestinationEditor
        {...{
          editorMode: editorMode,
          onAfterSaveSucceded: onSaveSucceded,
          paramsByProps: { type: "dbtcloud", standalone: "true" },
        }}
      />
    )
  }
}

const DestinationsPage = observer(DbtCloudPageComponent)

export default DestinationsPage
