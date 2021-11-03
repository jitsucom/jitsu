import { Modal } from "antd"
import ExclamationCircleOutlined from "@ant-design/icons/lib/icons/ExclamationCircleOutlined"
import { sourcesStore } from "../../stores/sources"
import { actionNotification } from "../../ui/components/ActionNotification/ActionNotification"
import React from "react"

export function confirmDelete({
  action,
  entityName,
  notification,
}: {
  //the name of entity we delete
  entityName: string
  action: () => Promise<any>
  notification?: string
}) {
  Modal.confirm({
    title: "Confirm to delete",
    icon: <ExclamationCircleOutlined />,
    content: `Are you sure you want to delete ${entityName}?  This action cannot be undone.`,
    okText: "Confirm",
    cancelText: "Cancel",
    onCancel: () => {},
    onOk: async () => {
      await action()
      if (notification) {
        actionNotification.success("Sources list successfully updated")
      }
    },
  })
}
