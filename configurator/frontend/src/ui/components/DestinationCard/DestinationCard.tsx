import { ConnectionCard } from "../ConnectionCard/ConnectionCard"
import { destinationsReferenceMap } from "../../../catalog/destinations/lib"
import { Badge, Menu, Modal } from "antd"
import { ExclamationCircleOutlined } from "@ant-design/icons"
import { destinationsStore } from "../../../stores/destinations"
import { handleError } from "../../../lib/components/components"
import { generatePath, NavLink } from "react-router-dom"
import { destinationPageRoutes } from "../../pages/DestinationsPage/DestinationsPage.routes"
import { useServices } from "../../../hooks/useServices"
import React from "react"
import Tooltip from "antd/es/tooltip"
import EditOutlined from "@ant-design/icons/lib/icons/EditOutlined"
import DeleteOutlined from "@ant-design/icons/lib/icons/DeleteOutlined"
import CodeOutlined from "@ant-design/icons/lib/icons/CodeOutlined"
import SubMenu from "antd/lib/menu/SubMenu"
import SyncOutlined from "@ant-design/icons/lib/icons/SyncOutlined"
import { flowResult } from "mobx"

export type DestinationCardProps = {
  dst: DestinationData
}

export function DestinationCard({ dst }: DestinationCardProps) {
  const reference = destinationsReferenceMap[dst._type]
  const services = useServices()
  const rename = async (newName: string) => {
    await services.storageService.table("destinations").patch(dst._uid, { displayName: newName })
    await flowResult(destinationsStore.pullDestinations())
  }
  let deleteAction = () => {
    Modal.confirm({
      title: "Please confirm deletion of destination",
      icon: <ExclamationCircleOutlined />,
      content: "Are you sure you want to delete " + dst._id + " destination?",
      okText: "Delete",
      cancelText: "Cancel",
      onOk: () => {
        const destinationToDelete = destinationsStore.getDestinationById(dst._id)

        try {
          destinationsStore.deleteDestination(destinationToDelete)
        } catch (errors) {
          handleError(errors, "Unable to delete destination at this moment, please try later.")
        }
      },
    })
  }
  let editLink = generatePath(destinationPageRoutes.editExact, { id: dst._id })
  const statLink = generatePath(destinationPageRoutes.statisticsExact, { id: dst._id })
  return (
    <ConnectionCard
      title={dst.displayName || dst._id}
      icon={reference.ui.icon}
      deleteAction={deleteAction}
      editAction={editLink}
      rename={rename}
      menuOverlay={
        <Menu>
          <Menu.Item icon={<EditOutlined />}>
            <NavLink to={editLink}>Edit</NavLink>
          </Menu.Item>
          <Menu.Item icon={<DeleteOutlined />} onClick={deleteAction}>
            Delete
          </Menu.Item>
          <Menu.Item icon={<CodeOutlined />}>
            <NavLink to={statLink}>Statistics</NavLink>
          </Menu.Item>
        </Menu>
      }
      subtitle={<>mode: {dst._formData?.mode}</>}
      status={
        <Tooltip
          overlay={
            dst._connectionTestOk ? "Connection successful" : `Connection failed: ${dst._connectionErrorMessage}`
          }
        >
          <Badge
            size="default"
            status={dst._connectionTestOk ? "success" : "error"}
            text={
              <span className={`text-${dst._connectionTestOk ? "success" : "error"}`}>
                {dst._connectionTestOk ? "Active" : "Connection test failed"}
              </span>
            }
          />
        </Tooltip>
      }
    />
  )
}
