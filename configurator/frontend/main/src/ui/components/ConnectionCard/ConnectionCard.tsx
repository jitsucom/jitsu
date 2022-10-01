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
export type ConnectionCardAction = string | (() => void) | undefined

/**
 * Returns link (if action is string, meaning URL), or Button
 */
function ActionLink({
  action,
  children,
  ...rest
}: {
  action: ConnectionCardAction
  children: ReactNode
  [key: string]: any
}) {
  if (!action) {
    return <span {...rest}>{children}</span>
  } else if (typeof action === "string") {
    return (
      <NavLink to={action} {...rest} style={{ color: "unset" }}>
        {children}
      </NavLink>
    )
  } else {
    return (
      <a className="text-text" onClick={action} {...rest}>
        {children}
      </a>
    )
  }
}

export type ConnectionCardProps = {
  //icon of connection
  icon: ReactNode
  disabled: boolean

  deleteAction: ConnectionCardAction
  editAction: ConnectionCardAction
  menuOverlay: ReactElement | undefined

  title: string
  rename: (newName: string) => Promise<any>

  subtitle: ReactNode

  status: ReactNode

  //If connection card is loading - we're waiting something from the
  //server which changes the state of the card
  loading?: boolean
}

export function ConnectionCard(props: ConnectionCardProps) {
  return (
    <div className={`${styles.connectionCard} ${props.loading && styles.connectionCardLoading}`}>
      <div className="w-full flex justify-between items-start">
        <div className="flex items-center">
          <div className="h-12 w-12">
            <ActionLink action={props.editAction}>{props.icon}</ActionLink>
          </div>
          <div className="pl-4 h-12 h-full flex flex-col justify-between ">
            <ActionLink action={props.editAction}>
              <EditableName disabled={props.disabled} className="text-base font-bold" name={props.title} update={props.rename} />
            </ActionLink>
            <div className="text-secondaryText">{props.subtitle}</div>
          </div>
        </div>
        {props.menuOverlay && (
          <Dropdown trigger={["click"]} overlay={props.menuOverlay}>
            <div className="text-lg px-3 hover:bg-splitBorder cursor-pointer rounded-full text-center">⋮</div>
          </Dropdown>
        )}
      </div>
      <div className="pt-6 flex items-end">
        <div className="flex-grow">{props.status}</div>
        <div className="flex justify-end flex-grow items-end space-x-2 pr-2">
          {props.editAction && !props.disabled && (
            <ActionLink action={props.editAction}>
              <EditOutlined />
            </ActionLink>
          )}
        </div>
      </div>
    </div>
  )
}
