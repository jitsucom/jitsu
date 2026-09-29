import React, { useState } from "react";
import { Alert, Popover, Tag, Tooltip } from "antd";
import { ChevronDown } from "lucide-react";
import { reverseTaskStatus, type ReverseTask } from "../../lib/reverse-etl";
import { ReverseDeliveryStatistics } from "./DeliveryStatistics";
import { WJitsuButton } from "../JitsuButton/JitsuButton";

export function ReverseTaskStatus({ task }: { task?: ReverseTask | null }) {
  const [open, setOpen] = useState(false);
  if (!task)
    return (
      <div className="flex flex-col items-end">
        <Tag style={{ marginRight: 0 }}>NO RUNS</Tag>
        <span className="text-xxs text-gray-500">&nbsp;</span>
      </div>
    );
  const stats = task.stats;
  const status = reverseTaskStatus(task.status);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      overlayClassName="w-1/2"
      title="Record delivery statistics"
      content={
        <div className="break-words">
          {task.error && <Alert className="mb-3" type="error" title={task.error} />}
          <ReverseDeliveryStatistics task={task} />
          <div className="flex justify-end mt-3">
            <WJitsuButton href={`/reverse-syncs/logs?syncId=${task.sync_id}&taskId=${task.task_id}`} type="primary">
              Show Logs
            </WJitsuButton>
          </div>
        </div>
      }
    >
      <button
        className="relative outline-0 inline-flex flex-col items-end"
        onKeyDown={event => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        {task.latestLogLevel === "ERROR" && status !== "FAILED" && (
          <Tooltip title="The latest log entry is an error. Open logs for details.">
            <span
              role="img"
              aria-label="Latest log entry is an error"
              className="absolute -top-2 -right-2 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold"
            >
              !
            </span>
          </Tooltip>
        )}
        <ReverseTaskStatusTag status={task.status} dropdown />
        <span className="text-xxs text-gray-500">{stats ? "show stats" : "show details"}</span>
      </button>
    </Popover>
  );
}

export function ReverseTaskStatusTag({
  status: storedStatus,
  dropdown = false,
}: {
  status: string;
  dropdown?: boolean;
}) {
  const status = reverseTaskStatus(storedStatus);
  return (
    <Tag
      style={{ marginRight: 0 }}
      color={
        ["PENDING", "COMPLETE"].includes(status)
          ? "green"
          : status === "FAILED"
          ? "red"
          : status === "RUNNING"
          ? "blue"
          : undefined
      }
    >
      {status}
      {dropdown && (
        <>
          {" "}
          <ChevronDown className="inline w-3 h-3" />
        </>
      )}
    </Tag>
  );
}
