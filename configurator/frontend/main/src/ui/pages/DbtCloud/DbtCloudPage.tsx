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
import { PageProps } from "navigation"
import { BreadcrumbsProps } from "ui/components/Breadcrumbs/Breadcrumbs"
import { useState } from "react"
import { useForceUpdate } from "../../../hooks/useForceUpdate"
import dbtcloud from "@jitsu/catalog/destinations/lib/dbtcloud"
import { EntitiesStoreState } from "stores/types.enums"

export interface CollectionDestinationData {
  destinations: DestinationData[]
  _lastUpdated?: string
}

export interface CommonDestinationPageProps {
  setBreadcrumbs: (breadcrumbs: BreadcrumbsProps) => void
  editorMode?: "edit" | "add"
}

const DbtCloudPageComponent: React.FC<PageProps> = ({ setBreadcrumbs }) => {
  const [dbtCloudData, setDbtCloudData] = useState(
    destinationsStore.listHidden.find(value => value._type == "dbtcloud")
  )
  const [editorMode, setEditorMode] = useState((dbtCloudData ? "edit" : "add") as "edit" | "add")

  const forceUpdate = useForceUpdate()

  if (destinationsStore.state === EntitiesStoreState.GLOBAL_ERROR) {
    return <CenteredError error={destinationsStore.error} />
  } else if (
    destinationsStore.state === EntitiesStoreState.GLOBAL_LOADING ||
    sourcesStore.state === EntitiesStoreState.GLOBAL_LOADING
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
          setBreadcrumbs,
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
          setBreadcrumbs,
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
