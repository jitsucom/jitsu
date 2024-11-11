import { StreamConfig } from "../../lib/schema";
import { Disable } from "../Disable/Disable";
import { Select } from "antd";
import { StreamTitle } from "../../pages/[workspaceId]/streams";
import { WLink } from "../Workspace/WLink";
import { FaExternalLinkAlt } from "react-icons/fa";
import React from "react";
import { SelectorProps } from "./DestinationSelector";

export function SourceSelector(props: SelectorProps<StreamConfig>) {
  return (
    <div className="flex items-center justify-between">
      <Disable disabled={!props.enabled} disabledReason={props.disabledReason}>
        <Select dropdownMatchSelectWidth={false} className="w-80" value={props.selected} onSelect={props.onSelect}>
          {props.items.map(stream => (
            <Select.Option key={stream.id} value={stream.id}>
              <StreamTitle stream={stream} size={"small"} />
            </Select.Option>
          ))}
        </Select>
      </Disable>
      {!props.enabled && props.showLink && (
        <div className="text-lg px-6">
          <WLink href={`/streams?id=${props.selected}`}>
            <FaExternalLinkAlt />
          </WLink>
        </div>
      )}
    </div>
  );
}
