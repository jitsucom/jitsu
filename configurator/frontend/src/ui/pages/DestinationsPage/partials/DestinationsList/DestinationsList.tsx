// @Libs
import { useCallback, useEffect, useMemo, useState } from "react"
import { generatePath, useHistory } from "react-router-dom"
import { Button, Dropdown, Modal } from "antd"
import { observer } from "mobx-react-lite"
// @Services
import { destinationsReferenceList, destinationsReferenceMap } from "catalog/destinations/lib"
// @Store
import { destinationsStore } from "stores/destinations"
// @Components
import { handleError } from "lib/components/components"
import { DropDownList } from "ui/components/DropDownList/DropDownList"
import { EmptyList } from "ui/components/EmptyList/EmptyList"
// @Icons
import PlusOutlined  from "@ant-design/icons/lib/icons/PlusOutlined"
// @Styles
import styles from "./DestinationsList.module.less"
// @Utils
import { withHome } from "ui/components/Breadcrumbs/Breadcrumbs"
// @Routes
import { destinationPageRoutes } from "ui/pages/DestinationsPage/DestinationsPage.routes"
// @Types
import { CommonDestinationPageProps } from "ui/pages/DestinationsPage/DestinationsPage"
import { Destination } from "catalog/destinations/types"
import { useServices } from "../../../../../hooks/useServices"
import { showQuotaLimitModal } from "../../../../../lib/services/billing"
import { DestinationCard } from "../../../../components/DestinationCard/DestinationCard"

const DestinationsListComponent = ({ setBreadcrumbs }: CommonDestinationPageProps) => {
  const history = useHistory()
  const subscription = useServices().currentSubscription


  const dropDownList = useMemo(
    () => (
      <DropDownList
        hideFilter
        list={destinationsReferenceList
          .filter(v => !v.hidden)
          .map((dst: Destination) => ({
            title: dst.displayName,
            id: dst.id,
            icon: dst.ui.icon,
            handleClick: () => {
              if (destinationsStore.allDestinations.length >= subscription?.currentPlan.quota.destinations ?? 999) {
                showQuotaLimitModal(
                  subscription,
                  <>You current plan allows to have only {subscription.currentPlan.quota.destinations} destinations</>
                )
                return
              }
              const link = generatePath(destinationPageRoutes.newExact, {
                type: dst.id,
              })
              history.push(link)
            },
          }))}
      />
    ),
    []
  )

  useEffect(() => {
    setBreadcrumbs(
      withHome({
        elements: [
          { title: "Destinations", link: destinationPageRoutes.root },
          {
            title: "Destinations List",
          },
        ],
      })
    )
  }, [setBreadcrumbs])

  if (destinationsStore.destinations.length === 0) {
    return <EmptyList list={dropDownList} title="Destinations list is still empty" unit="destination" />
  }

  return (
    <>
      <div className="mb-5">
        <Dropdown trigger={["click"]} overlay={dropDownList}>
          <Button type="primary" icon={<PlusOutlined />}>
            Add destination
          </Button>
        </Dropdown>
      </div>

      <div className="flex flex-wrap justify-center">
        {destinationsStore.destinations.map((dst: DestinationData) => {
          const statLink = generatePath(destinationPageRoutes.statisticsExact, { id: dst._id })
          return <DestinationCard dst={dst} />
        })}
      </div>
    </>
  )
}

export const DestinationsList = observer(DestinationsListComponent)
