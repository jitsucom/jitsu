// @Libs
import { useCallback, useEffect } from "react"
import { useHistory } from "react-router-dom"
import { Button } from "antd"
import { observer } from "mobx-react-lite"
// @Store
import { destinationsStore } from "stores/destinations"
// @Components
import { EmptyList } from "ui/components/EmptyList/EmptyList"
// @Icons
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined"
// @Routes
import { destinationPageRoutes } from "ui/pages/DestinationsPage/DestinationsPage.routes"
// @Types
import { useServices } from "../../../../../hooks/useServices"
import { DestinationCard } from "../../../../components/DestinationCard/DestinationCard"
import { currentPageHeaderStore } from "../../../../../stores/currentPageHeader"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"

const DestinationsListComponent = () => {
  const history = useHistory()
  const subscription = useServices().currentSubscription

  const handleAddClick = useCallback(() => {
    history.push(projectRoute(destinationPageRoutes.add))
  }, [history, subscription])

  useEffect(() => {
    currentPageHeaderStore.setBreadcrumbs("Destinations")
  }, [])

  if (destinationsStore.list.length === 0) {
    return <EmptyList handleAddClick={handleAddClick} title="Destinations list is still empty" unit="destination" />
  }

  return (
    <>
      <div className="mb-5">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddClick}>
          Add destination
        </Button>
      </div>

      <div className="flex flex-wrap justify-center">
        {destinationsStore.list.map((dst: DestinationData) => {
          return <DestinationCard key={dst._uid} dst={dst} />
        })}
      </div>
    </>
  )
}

export const DestinationsList = observer(DestinationsListComponent)
