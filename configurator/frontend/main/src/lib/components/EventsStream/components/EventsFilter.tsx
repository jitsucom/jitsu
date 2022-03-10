import * as React from "react"
import { useState } from "react"
import { find } from "lodash"
import { Select, Tooltip } from "antd"
import styles from "../EventsSteam.module.less"
import { FilterOption } from "../shared"
import { reactElementToString } from "../../../commons/utils"

const { Option } = Select

/**
 * Displays string as is, if len is lesser than len. Or trims the string (middle chars) and displays tooltip
 * @param len
 * @param children
 */
const MaxLen: React.FC<{ len: number }> = ({ len, children }) => {
  const string = reactElementToString(children)
  if (string.length <= len) {
    return <>{children}</>
  } else {
    //technically it's not correct, we need to refactor that more carefully to handle
    //odd / even nulbers well
    const prefixLen = len / 2 - 2
    const suffixLen = len / 2 - 2
    return <Tooltip title={children}>{string.substr(0, prefixLen) + "..." + string.substr(-suffixLen)}</Tooltip>
  }
}

export const EventsFilter: React.FC<{
  label: string
  onChange: (selected: FilterOption) => void
  options: FilterOption[]
  initialFilter?: any
}> = ({ label, initialFilter, onChange, options }) => {
  const initialOption = options.find(o => o.value === initialFilter) ?? options[0]
  const [selectedOption, setSelectedOption] = useState(initialOption)

  const handleChange = value => {
    const selectedOption = find(options, ["value", value]) ?? options[0]
    setSelectedOption(selectedOption)
    onChange(selectedOption)
  }

  return (
    <div className="mr-5">
      <label>{label}: </label>
      <Select
        defaultValue={selectedOption.value}
        style={{ width: 170 }}
        onChange={handleChange}
        dropdownMatchSelectWidth={false}
      >
        {options.map(option => {
          return (
            <Option value={option.value} key={option.value}>
              <div className={styles.filterOption}>
                <span className={`icon-size-base ${styles.icon}`}>{option.icon}</span>{" "}
                <span className={`icon-size-base ${styles.label}`}>
                  <MaxLen len={40}>{option.label}</MaxLen>
                </span>
              </div>
            </Option>
          )
        })}
      </Select>
    </div>
  )
}
