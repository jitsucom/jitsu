// @Libs
import React, { memo } from "react"
// @Icons
import CloseOutlined from "@ant-design/icons/lib/icons/CloseOutlined"
// @Styles
import styles from "./PopoverTitle.module.less"

export interface Props {
  title: React.ReactNode
  handleClose: () => void
}

const PopoverTitleComponent = ({ handleClose, title }: Props) => (
  <p className={styles.title}>
    <span>{title}:</span> <CloseOutlined onClick={handleClose} />
  </p>
)

PopoverTitleComponent.displayName = "PopoverTitle"

export const PopoverTitle = memo(PopoverTitleComponent)
