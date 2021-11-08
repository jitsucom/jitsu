// @Libs
import React, { memo, useCallback, useMemo, useState } from "react"
import { NavLink } from "react-router-dom"
import { Input } from "antd"
import debounce from "lodash/debounce"
import cn from "classnames"
// @Styles
import styles from "./DropDownList.module.less"

type DropdownListItemCommonFields = {
  id: string
  title: string
  icon?: React.ReactNode
}

type DropdownListItemActionsFields =
  | { link: string; handleClick?: undefined }
  | { link?: null; handleClick: () => void }

export type DropDownListItem = DropdownListItemCommonFields & DropdownListItemActionsFields

export interface Props {
  filterPlaceholder?: string
  list: DropDownListItem[]
  hideFilter?: boolean
  getClassName?: (list: DropDownListItem[], item: DropDownListItem, index: number) => string
}

const DropDownListComponent = ({ filterPlaceholder, list, hideFilter = false, getClassName }: Props) => {
  const [filteredParam, setFilteredParam] = useState<string>()

  const handleChange = debounce(
    useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setFilteredParam(e.target.value)
    }, []),
    500
  )

  const filteredList = useMemo(
    () =>
      filteredParam ? list.filter(item => item.title.includes(filteredParam) || item.id.includes(filteredParam)) : list,
    [list, filteredParam]
  )

  return (
    <div className={styles.dropdown}>
      {!hideFilter && (
        <div className={styles.filter}>
          <Input onChange={handleChange} placeholder={filterPlaceholder} />
        </div>
      )}

      <ul className={styles.list}>
        {filteredList.map((item: DropDownListItem, index: number) => {
          return (
            <li
              key={`${item.id}-${item.title}`}
              className={cn(styles.item, getClassName && getClassName(filteredList, item, index))}
            >
              {item.link ? (
                <NavLink to={item.link} className={styles.link}>
                  {item.icon && <span className={styles.icon}>{item.icon}</span>}
                  <span className={styles.name}>{item.title}</span>
                </NavLink>
              ) : (
                <span className={styles.clickableItemContainer} onClick={item.handleClick}>
                  {item.icon && <span className={styles.icon}>{item.icon}</span>}
                  <span className={styles.name}>{item.title}</span>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

DropDownListComponent.displayName = "DropDownList"

export const DropDownList = memo(DropDownListComponent)
