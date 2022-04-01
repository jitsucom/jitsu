import CheckCircleOutlined from "@ant-design/icons/lib/icons/CheckCircleOutlined"
import CloseCircleOutlined from "@ant-design/icons/lib/icons/CloseCircleOutlined"
import InfoCircleOutlined from "@ant-design/icons/lib/icons/InfoCircleOutlined"
import WarningOutlined from "@ant-design/icons/lib/icons/WarningOutlined"
import { message, notification, Spin, Typography } from "antd"
import CloseOutlined from "@ant-design/icons/lib/icons/CloseOutlined"
import React, { ReactNode } from "react"
import styles from "./ActionNotification.less"
import { randomId } from "../../../utils/numbers"

export type ActionNotificationType = "success" | "error" | "info" | "warn" | "loading"

type NotificationActionMethod = (ActionNotificationType) => void

function messageFactory(type: ActionNotificationType): NotificationActionMethod {
  const iconsByType = {
    success: <CheckCircleOutlined className="text-success" />,
    error: <CloseCircleOutlined className="text-error" />,
    info: <InfoCircleOutlined className="text-success" />,
    warn: <WarningOutlined className="text-warning" />,
    loading: <Spin className="text-loading mr-2" />,
  }
  return (content: ReactNode) => {
    message.destroy()
    const key = randomId()
    let destroyMessage = () => message.destroy()
    let msg = {
      key: key,
      content: (
        <span className="inline-block flex flex-nowrap space-x-2">
          <div className="cursor-pointer" onClick={destroyMessage}>
            {iconsByType[type]}
          </div>
          <div
            className="text-wrap flex-shrink"
            style={{
              maxWidth: "30rem",
            }}
          >
            {content}
          </div>
          <div className="cursor-pointer close-btn" onClick={destroyMessage}>
            <CloseOutlined />
          </div>
        </span>
      ),
      type: type,
      duration: 7,
      className: styles.message,
      prefixCls: "jitsu-message",
    }
    message[type](msg)
  }
}

/**
 * Notifies user with the result of action. Use it instead of antd message
 */
export const actionNotification: Record<ActionNotificationType, NotificationActionMethod> = {
  success: messageFactory("success"),
  error: messageFactory("error"),
  info: messageFactory("info"),
  warn: messageFactory("warn"),
  loading: messageFactory("loading"),
}
