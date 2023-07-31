// @Libs
import React from "react"
// @Types
import { Tab } from "ui/components/Tabs/TabsConfigurator"
// @Styles
import styles from "./PopoverErrorsContent.module.less"

export interface Props {
  tabsList: Tab[]
}

const PopoverErrorsContent = ({ tabsList }: Props) => (
  <ul className={styles.list}>
    {tabsList
      .filter(t => t.errorsCount > 0)
      .map((tab: Tab) => (
        <li key={tab.key}>
          {tab.errorsCount} {`${tab.errorsLevel ?? "error"}(s)`} at `{tab.name}` tab;
        </li>
      ))}
  </ul>
)

PopoverErrorsContent.displayName = "PopoverErrorsContent"

export { PopoverErrorsContent }
