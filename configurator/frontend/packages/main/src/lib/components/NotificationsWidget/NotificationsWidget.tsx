// @Libs
import { useCallback, useState } from "react"
import { Badge, Drawer, Button } from "antd"
import { observer } from "mobx-react-lite"
// @Components
import { Notifications } from "../Notifications/Notifications"
// @Store
import { inAppNotificationsStore } from "stores/inAppNotifications"
// @Icons
import { BellOutlined } from "@ant-design/icons"
// @Styles
import styles from "./NotificationsWidget.module.less"

const NotificationsWidgetComponent: React.FC = () => {
  const hasNotifications = inAppNotificationsStore.hasNotifications
  const [showDrawer, setShowDrawer] = useState<boolean>(false)
  const handleOpenDrawer = useCallback<(...args: any) => void>(() => setShowDrawer(true), [])
  const handleCloseDrawer = useCallback<(...args: any) => void>(() => setShowDrawer(false), [])
  return (
    <>
      <Button
        type="text"
        shape="circle"
        icon={
          <Badge dot={hasNotifications} className="text-lg">
            <BellOutlined className={hasNotifications && styles.iconRed} />
          </Badge>
        }
        onClick={handleOpenDrawer}
      />
      <Drawer
        visible={showDrawer}
        closable={false}
        className={styles.drawer}
        onClose={handleCloseDrawer}
        contentWrapperStyle={{ width: "80%", maxWidth: "300px" }}
        bodyStyle={{ padding: 0 }}
      >
        <div className="h-full overflow-y-auto">
          <div className="box-border px-4 py-2">
            <Notifications handleCloseContainer={handleCloseDrawer} />
          </div>
        </div>
      </Drawer>
    </>
  )
}

const NotificationsWidget = observer(NotificationsWidgetComponent)

NotificationsWidget.displayName = "NotificationsWidget"

export { NotificationsWidget }
