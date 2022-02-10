// @Libs
import cn from "classnames"
// @Styles
import styles from "./TabDescription.module.less"

interface Props {
  children: React.ReactNode
  className?: string
}

const TabDescription = ({ children, className }: Props) => {
  return <div className={cn(styles.description, className)}>{children}</div>
}

TabDescription.displayName = "TabDescription"

export { TabDescription }
