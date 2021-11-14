// @Libs
import { memo } from "react"
// @Styles
import styles from "./PageHeader.module.less"

export interface Props {
  icon: React.ReactNode
  title: string
  mode: "edit" | "add" | "statistics"
}

const PageHeaderComponent = ({ icon, title, mode }: Props) => (
  <div className="flex flex-row items-center space-x-1 text-text">
    <div className={styles.connectorPic}>{icon}</div>
    <div className="">
      {title} {mode && <>({mode === "add" ? "add new" : mode})</>}
    </div>
  </div>
)

PageHeaderComponent.displayName = "PageHeader"

export const PageHeader = memo(PageHeaderComponent)
