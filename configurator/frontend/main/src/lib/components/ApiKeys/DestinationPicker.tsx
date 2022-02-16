import React from "react"
import { observer } from "mobx-react-lite"
import { Select } from "antd"
import { DestinationsUtils } from "../../../utils/destinations.utils"
import { destinationsReferenceMap } from "@jitsu/catalog/destinations/lib"

export type DestinationPickerProps = {
  isSelected: (dst: DestinationData) => boolean
  allDestinations: DestinationData[]

  onChange?: (value: string[]) => void
}

const DestinationPickerComponent: React.FC<DestinationPickerProps> = props => {
  return (
    <Select
      mode="multiple"
      allowClear
      placeholder="Please select destinations to connect with the key"
      defaultValue={props.allDestinations.filter(props.isSelected).map(dst => dst._uid)}
      size="large"
      onChange={value => {
        props.onChange(value)
      }}
    >
      {props.allDestinations.map(dst => (
        <Select.Option value={dst._uid} key={dst._uid}>
          <div className="flex flex-nowrap space-x-1 items-center">
            {destinationsReferenceMap[dst._type]?.ui?.icon && (
              <span className="w-6 h-6">{destinationsReferenceMap[dst._type]?.ui?.icon}</span>
            )}
            <span>
              {DestinationsUtils.getDisplayName(dst)} ({destinationsReferenceMap[dst._type].displayName})
            </span>
          </div>
        </Select.Option>
      ))}
    </Select>
  )
}

export const DestinationPicker = observer(DestinationPickerComponent)
