import React, { useState } from "react"
import { find } from "lodash"
import { Select } from "antd"
import styles from "./SelectFilter.module.less"
import { FilterOption } from "./shared"

const { Option } = Select

export const SelectFilter: React.FC<{
  label?: string
  onChange: (selected: FilterOption) => void
  options: FilterOption[]
  initialValue?: any
  className?: string
}> = ({ label = "", onChange, options, initialValue, className = "" }) => {
  const initialOption = options.find(o => o.value === initialValue) ?? options[0]
  const [selectedOption, setSelectedOption] = useState(initialOption)

  const handleChange = value => {
    const selectedOption = find(options, ["value", value]) ?? options[0]
    setSelectedOption(selectedOption)
    onChange(selectedOption)
  }

  if (!options.length) {
    return null
  }

  return (
    <div className={className}>
      {label ? <label>{label}: </label> : null}
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
                <span className={`icon-size-base ${styles.label}`}>{option.label}</span>
              </div>
            </Option>
          )
        })}
      </Select>
    </div>
  )
}
