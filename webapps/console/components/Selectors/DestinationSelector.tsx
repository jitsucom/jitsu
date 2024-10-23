import { getCoreDestinationType } from "../../lib/schema/destinations";
import { DestinationConfig } from "../../lib/schema";
import { Disable } from "../Disable/Disable";
import { Select } from "antd";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import { WLink } from "../Workspace/WLink";
import { FaExternalLinkAlt } from "react-icons/fa";
import React from "react";

export type SelectorProps<T> = {
  enabled: boolean;
  disabledReason?: string;
  selected: string;
  items: T[];
  onSelect: (value: string) => void;
  showLink?: boolean;
};

export function DestinationSelector(props: SelectorProps<DestinationConfig>) {
  return (
    <div className="flex items-center justify-between">
      <Disable disabled={!props.enabled} disabledReason={!props.disabledReason}>
        <Select dropdownMatchSelectWidth={false} className="w-80" value={props.selected} onSelect={props.onSelect}>
          {props.items.map(destination => {
            const destinationType = getCoreDestinationType(destination.destinationType);
            return (
              <Select.Option dropdownMatchSelectWidth={false} value={destination.id} key={destination.id}>
                <DestinationTitle
                  destination={destination}
                  size={"small"}
                  title={(d, t) => {
                    return (
                      <div className={"flex flex-row items-center"}>
                        <div className="whitespace-nowrap">{destination.name}</div>
                        <div className="text-xxs text-gray-500 ml-1">({destinationType.title})</div>
                      </div>
                    );
                  }}
                />
              </Select.Option>
            );
          })}
        </Select>
      </Disable>
      {!props.enabled && props.showLink && (
        <div className="text-lg px-6">
          <WLink href={`/destinations?id=${props.selected}`}>
            <FaExternalLinkAlt />
          </WLink>
        </div>
      )}
    </div>
  );
}
