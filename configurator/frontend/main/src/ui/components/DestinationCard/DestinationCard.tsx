import { ConnectionCard } from "../ConnectionCard/ConnectionCard"
import { destinationsReferenceMap } from "@jitsu/catalog"
import { Badge, Menu, Modal } from "antd"
import { ExclamationCircleOutlined } from "@ant-design/icons"
import { destinationsStore } from "../../../stores/destinations"
import { handleError } from "../../../lib/components/components"
import { NavLink } from "react-router-dom"
import { destinationPageRoutes } from "../../pages/DestinationsPage/DestinationsPage.routes"
import Tooltip from "antd/es/tooltip"
import EditOutlined from "@ant-design/icons/lib/icons/EditOutlined"
import DeleteOutlined from "@ant-design/icons/lib/icons/DeleteOutlined"
import CodeOutlined from "@ant-design/icons/lib/icons/CodeOutlined"
import { flowResult } from "mobx"
import { DestinationsUtils } from "../../../utils/destinations.utils"
import { projectRoute } from "../../../lib/components/ProjectLink/ProjectLink"
import { connectionsHelper } from "stores/helpers"
import useProject from "../../../hooks/useProject"
import { allPermissions } from "../../../lib/services/permissions"
import { ProjectPermission } from "../../../generated/conf-openapi"

export type DestinationCardProps = {
  dst: DestinationData
}

export function DestinationCard({ dst }: DestinationCardProps) {
  const project = useProject()
  const disableEdit = !(project.permissions || allPermissions).includes(ProjectPermission.MODIFY_CONFIG)

  const reference = destinationsReferenceMap[dst._type]
  const rename = async (newName: string) => {
    await flowResult(destinationsStore.patch(dst._uid, { displayName: newName }))
  }
  let deleteAction = () => {
    Modal.confirm({
      title: "Please confirm deletion of destination",
      icon: <ExclamationCircleOutlined />,
      content: "Are you sure you want to delete " + dst._id + " destination?",
      okText: "Delete",
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await flowResult(destinationsStore.delete(dst._uid))
          await connectionsHelper.unconnectDeletedDestination(dst._uid)
        } catch (errors) {
          handleError(errors, "Unable to delete destination")
        }
      },
    })
  }
  let editLink = projectRoute(destinationPageRoutes.editExact, { id: dst._id })
  const statLink = projectRoute(destinationPageRoutes.statisticsExact, { id: dst._id })
  return (
    <ConnectionCard
      disabled={disableEdit}
      title={DestinationsUtils.getDisplayName(dst)}
      icon={reference?.ui.icon}
      deleteAction={deleteAction}
      editAction={editLink}
      rename={rename}
      menuOverlay={
        <Menu>
          {!disableEdit && (
            <Menu.Item icon={<EditOutlined />}>
              <NavLink to={editLink}>Edit</NavLink>
            </Menu.Item>
          )}
          {!disableEdit && (
            <Menu.Item icon={<DeleteOutlined />} onClick={deleteAction}>
              Delete
            </Menu.Item>
          )}
          <Menu.Item icon={<CodeOutlined />}>
            <NavLink to={statLink}>Statistics</NavLink>
          </Menu.Item>
        </Menu>
      }
      subtitle={dst._formData?.mode ? <>mode: {dst._formData?.mode}</> : <>{reference?.ui.title(dst)}</>}
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
              <>
                <span className={`text-${dst._connectionTestOk ? "success" : "error"}`}>
                  {dst._connectionTestOk ? "Active" : "Connection test failed"}
                </span>
                {reference?.deprecated ? <span className={"text-warning"}> (Deprecated)</span> : <></>}
              </>
            }
          />
        </Tooltip>
      }
    />
  )
}
