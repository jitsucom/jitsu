import { Tooltip } from "antd";

interface PriorityQueueProps {
  queueSizes: number[];
  maxTotalSize?: number;
  className?: string;
}

export default function PriorityQueueBar({ queueSizes = [], className = "", maxTotalSize }: PriorityQueueProps) {
  const totalSize = queueSizes.reduce((total, size) => total + size, 0);
  const colors = ["bg-red-500", "bg-yellow-500", "bg-green-500", "bg-green-600", "bg-green-700", "bg-green-800"];
  const restPercent = maxTotalSize ? ((maxTotalSize - totalSize) / maxTotalSize) * 100 : 0;

  if (totalSize === 0) {
    return <div className="text-sm">0</div>;
  }
  return (
    <div className={`${className} w-full`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm">Total Size: {totalSize.toLocaleString()}</div>
      </div>

      <Tooltip
        placement={"bottomLeft"}
        title={
          <>
            {queueSizes.map((size, index) => {
              return (
                <div key={index} className="text-sm">
                  priority: <span className={"font-mono"}>{index}</span> – items:{" "}
                  <span className={"font-mono"}>{size.toLocaleString()}</span>
                </div>
              );
            })}
          </>
        }
      >
        <div className="h-5 w-full overflow-hidden border border-gray-400 rounded bg-gray-100 ">
          <div className="flex h-full w-full">
            {queueSizes.map((size, index) => {
              const percentage = totalSize > 0 ? (size / Math.max(totalSize, maxTotalSize ?? 0)) * 100 : 0;
              return (
                <div
                  key={index}
                  className={`h-full ${colors[index]}  transition-all duration-500 text-white text-xxs text-center`}
                  style={{ width: `${percentage}%` }}
                >
                  {size}
                </div>
              );
            })}
            {restPercent > 0 && (
              <div
                key={"rest"}
                className={`h-full  transition-all duration-500 text-white text-xxs text-center`}
                style={{ width: `${restPercent}%` }}
              />
            )}
          </div>
        </div>
      </Tooltip>
    </div>
  );
}
