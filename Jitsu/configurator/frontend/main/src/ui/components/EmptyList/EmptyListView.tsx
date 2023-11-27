// @Libs
import React, { memo, ReactElement, ReactNode, useState } from "react"
import { Button, Dropdown } from "antd"
// @Styles
import styles from "./EmptyList.module.less"
// @Icons
import PlusOutlined from "@ant-design/icons/lib/icons/PlusOutlined"
import CheckOutlined from "@ant-design/icons/lib/icons/CheckOutlined"
import { handleError } from "lib/components/components"

type CommonProps = {
  title: ReactNode
  list?: ReactElement
  handleAddClick?: () => void
  unit: string
}

type LayoutProps = {
  centered?: boolean
  dropdownOverlayPlacement?: "bottomLeft" | "bottomCenter" | "bottomRight" | "topLeft" | "topCenter" | "topRight"
}

type FreeDatabaseProps = {
  hideFreeDatabaseSeparateButton?: boolean
  handleCreateFreeDatabase?: () => Promise<void>
}

type Props = CommonProps & LayoutProps & FreeDatabaseProps

const EmptyListViewComponent: React.FC<Props> = ({
  title,
  list,
  unit,
  handleAddClick = () => {},
  centered = true,
  dropdownOverlayPlacement = "bottomCenter",
  hideFreeDatabaseSeparateButton = false,
  handleCreateFreeDatabase,
}) => {
  const [creating, setCreating] = useState(false)
  return (
    <div className={centered ? styles.centered : styles.bare}>
      <h3 className="text-2xl">{title}</h3>
      <div className="flex flex-row justify-center items center">
        <div className={`${centered ? "h-32" : ""} w-80`}>
          {list ? (
            <Dropdown placement={dropdownOverlayPlacement} trigger={["click"]} overlay={list}>
              <Button type="primary" className="w-80" size="large" icon={<PlusOutlined />}>{`Add ${unit}`}</Button>
            </Dropdown>
          ) : (
            <Button
              type="primary"
              onClick={handleAddClick}
              className="w-80"
              size="large"
              icon={<PlusOutlined />}
            >{`Add ${unit}`}</Button>
          )}
        </div>
        {!hideFreeDatabaseSeparateButton && handleCreateFreeDatabase && (
          <>
            <div className={`${centered ? "h-32" : ""}  px-3 pt-2`}>or</div>
            <div className={`${centered ? "h-32" : ""}  w-80`}>
              <Button
                loading={creating}
                type="primary"
                className="w-80"
                size="large"
                icon={<CheckOutlined />}
                onClick={async () => {
                  setCreating(true)
                  try {
                    await handleCreateFreeDatabase()
                  } catch (e) {
                    handleError(e)
                  }
                }}
              >
                Create a free database
              </Button>
              <div className="text-xs text-secondaryText text-center mt-2">
                Create a free PostgresSQL database with 10,000 row limit
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

EmptyListViewComponent.displayName = "EmptyListView"

export const EmptyListView = memo(EmptyListViewComponent)
