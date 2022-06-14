import { Button, Card, Collapse, Typography } from "antd"
import { FC, Fragment, ReactNode } from "react"
// @Icons
import { CheckOutlined, CopyOutlined, ExclamationCircleOutlined, ReloadOutlined } from "@ant-design/icons"
// @Styles
import styles from "./ErrorCard.module.less"
import cn from "classnames"

type ErrorCardProps = {
  title?: string | ReactNode
  icon?: ReactNode
  description?: string | ReactNode
  descriptionWithContacts?: string | null
  stackTrace?: string
  className?: string
  error?: Error
  onReload?: VoidFunction
}

export const ErrorCard: FC<ErrorCardProps> = ({
  title,
  icon,
  error,
  description,
  descriptionWithContacts,
  stackTrace,
  className,
  onReload,
}) => {
  if (description === undefined && error !== undefined) {
    description = error.message
  }
  if (stackTrace === undefined && error !== undefined) {
    stackTrace = error.stack
  }
  return (
    <Card bordered={false} className={cn(className, "max-h-full")}>
      <Card.Meta
        avatar={icon || <ExclamationCircleOutlined className={styles.icon} />}
        title={title || "An Error Occured"}
        description={
          <>
            <Fragment key="description">
              {description !== undefined ? (
                description
              ) : (
                <span>
                  {descriptionWithContacts !== undefined ? (
                    <>
                      {descriptionWithContacts}
                      {descriptionWithContacts && <br />}
                    </>
                  ) : (
                    <>
                      {"The application component crashed because of an internal error."}
                      <br />
                    </>
                  )}
                  {"Please, try to reload the page first and if the problem is still present contact us at"}{" "}
                  <Typography.Paragraph copyable={{ tooltips: false }} className="inline">
                    {"support@jitsu.com"}
                  </Typography.Paragraph>{" "}
                  {"and our engineers will fix the problem asap."}
                </span>
              )}
            </Fragment>
            {stackTrace && (
              <Collapse key="stack-trace" bordered={false} className={`mt-2 ${styles.stackTraceCard}`}>
                <Collapse.Panel key={1} header="Technical details">
                  <div className="overflow-y-auto">
                    <Typography.Paragraph
                      copyable={{
                        text: stackTrace,
                        icon: [<CopyOutlined />, <CheckOutlined />],
                      }}
                      className={`flex flex-row ${styles.errorStackContainer}`}
                    >
                      <pre className="text-xs">{stackTrace}</pre>
                    </Typography.Paragraph>
                  </div>
                </Collapse.Panel>
              </Collapse>
            )}
            {onReload && (
              <div key="reload-button" className="flex justify-center items-center mt-2">
                <Button type="default" onClick={onReload} icon={<ReloadOutlined />}>{`Reload`}</Button>
              </div>
            )}
          </>
        }
      />
    </Card>
  )
}
