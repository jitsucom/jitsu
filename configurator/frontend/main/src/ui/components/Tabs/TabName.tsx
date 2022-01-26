// @Libs
import cn from "classnames"
// @Styles
import styles from "./TabName.module.less"

export interface Props {
  name: React.ReactNode
  errorsCount: number
  errorsLevel?: "warning" | "error"
  hideErrorsCount?: boolean
}

const TabNameComponent = ({ name, errorsCount, errorsLevel = "error", hideErrorsCount }: Props) => (
  <>
    {errorsCount === 0 ? (
      name
    ) : (
      <span className={cn(styles.name, errorsCount > 0 && !hideErrorsCount && styles[errorsLevel])}>
        {name}
        {!hideErrorsCount && <sup>{errorsCount}</sup>}
      </span>
    )}
  </>
)

TabNameComponent.displayName = "TabName"

export const TabName = TabNameComponent
