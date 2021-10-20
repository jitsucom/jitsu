/**
 * Displays the 'connection' card - source, or destination or API key
 */

import React, { ReactElement, ReactNode } from "react"
import styles from "./ConnectionCard.module.less"
import { EditableName } from "../EditableName/EditableName"
import { Badge, Button, Dropdown, Menu, Tooltip } from "antd"
import EditOutlined from "@ant-design/icons/lib/icons/EditOutlined"
import { NavLink } from "react-router-dom"
import DeleteOutlined from "@ant-design/icons/lib/icons/DeleteOutlined"
import CodeOutlined from "@ant-design/icons/lib/icons/CodeOutlined"
import SubMenu from "antd/lib/menu/SubMenu"
import SyncOutlined from "@ant-design/icons/lib/icons/SyncOutlined"

/**
 * Action - link or onClick handler
 */
export type ConnectionCardAction = string | (() => void)

/**
 * Returns link (if action is string, meaning URL), or Button
 */
function ActionLink({ action, children }: { action: ConnectionCardAction; children: ReactNode }) {
  if (typeof action === "string") {
    return (
      <NavLink to={action}>
        <a className="text-text">{children}</a>
      </NavLink>
    )
  } else {
    return <Button onClick={action} icon={children} type="link" />
  }
}

export type ConnectionCardProps = {
  //icon of connection
  icon: ReactNode

  deleteAction: ConnectionCardAction
  editAction: ConnectionCardAction
  menuOverlay: ReactElement

  title: string
  rename: (newName: string) => Promise<any>

  subtitle: ReactNode

  status: ReactNode
}

export function ConnectionCard(props: ConnectionCardProps) {
  return (
    <div className={styles.connectionCard}>
      <div className="w-full flex justify-between items-start">
        <div className="flex items-center">
          <div className="h-12">{props.icon}</div>
          <div className="pl-4 h-12 h-full flex flex-col justify-between ">
            <div>
              <EditableName className="text-base font-bold" name={props.title} update={props.rename} />
            </div>
            <div className="text-secondaryText">{props.subtitle}</div>
          </div>
        </div>
        <Dropdown trigger={["click"]} overlay={props.menuOverlay}>
          <Button type="ghost" size="small">
            ···
          </Button>
        </Dropdown>
      </div>
      <div className="pt-6 flex items-center">
        <div>{props.status}</div>
        <div className="flex justify-end flex-grow items-center">
          <ActionLink action={props.editAction}>
            <EditOutlined />
          </ActionLink>
          <ActionLink action={props.deleteAction}>
            <DeleteOutlined />
          </ActionLink>
        </div>
      </div>
    </div>
  )
}
