// @Libs
import React from "react"
import { Button, Popover, Tooltip } from "antd"
// @Components
import { PopoverTitle } from "ui/components/Popover/PopoverTitle"
import { PopoverErrorsContent } from "ui/components/Popover/PopoverErrorsContent"
// @Icons
import { ApiOutlined, AreaChartOutlined } from "@ant-design/icons"
// @Types
import { Tab } from "ui/components/Tabs/TabsConfigurator"
import useProject from "../../../hooks/useProject"
import { allPermissions } from "../../../lib/services/permissions"
import { ProjectPermission } from "../../../generated/conf-openapi"

interface ButtonProps {
  isPopoverVisible: boolean
  isRequestPending: boolean
  handlePress: () => void
  handlePopoverClose: () => void
  titleText: string
  tabsList: Tab[]
  disabled?: boolean | string
}

export interface Props {
  save: ButtonProps
  test: ButtonProps
  handleCancel: VoidFunction
}

const EditorButtons = ({ test, save, handleCancel }: Props) => {
  const project = useProject()
  const disableEdit = !(project.permissions || allPermissions).includes(ProjectPermission.MODIFY_CONFIG)
  return (
    <>
      {!disableEdit && (
        <Tooltip title={typeof save.disabled === "string" ? save.disabled : undefined}>
          <Popover
            content={<PopoverErrorsContent tabsList={save.tabsList} />}
            title={<PopoverTitle title={save.titleText} handleClose={save.handlePopoverClose} />}
            trigger="click"
            visible={save.isPopoverVisible}
          >
            <Button
              type="primary"
              size="large"
              className="mr-3"
              htmlType="button"
              loading={save.isRequestPending}
              onClick={save.handlePress}
              disabled={!!save.disabled}
            >
              Save
            </Button>
          </Popover>
        </Tooltip>
      )}

      {!disableEdit && (
        <Tooltip title={typeof save.disabled === "string" ? test.disabled : undefined}>
          <Popover
            content={<PopoverErrorsContent tabsList={test.tabsList} />}
            title={<PopoverTitle title={test.titleText} handleClose={test.handlePopoverClose} />}
            trigger="click"
            visible={test.isPopoverVisible}
          >
            <Button
              size="large"
              className="mr-3"
              type="dashed"
              loading={test.isRequestPending}
              onClick={test.handlePress}
              icon={<ApiOutlined />}
              disabled={!!test.disabled}
            >
              Test connection
            </Button>
          </Popover>
        </Tooltip>
      )}

      {handleCancel && (
        <Button type="default" size="large" onClick={handleCancel} danger>
          {disableEdit ? "Close" : "Cancel"}
        </Button>
      )}
    </>
  )
}

EditorButtons.displayName = "EditorButtons"

export { EditorButtons }
