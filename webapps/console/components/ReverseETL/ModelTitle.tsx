import React from "react";
import { Database } from "lucide-react";
import type { ModelConfig } from "../../lib/schema";
import { coreDestinationsMap } from "../../lib/schema/destinations";
import { useConfigObjectList } from "../../lib/store";
import { getDestinationIcon } from "../DestinationsCatalog/DestinationsCatalog";
import { ObjectTitle } from "../ObjectTitle/ObjectTitle";

export function ModelIcon({ model }: { model?: Pick<ModelConfig, "warehouseId"> }) {
  const warehouses = useConfigObjectList("destination");
  const warehouse = warehouses.find(w => w.id === model?.warehouseId);
  const type = warehouse && coreDestinationsMap[warehouse.destinationType];
  return (
    <span className="relative block w-full h-full">
      {type ? getDestinationIcon(type) : <Database className="w-full h-full" />}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 18 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute bottom-0 right-0 h-2.5 w-3.5 rounded-sm bg-white text-gray-700"
      >
        <path d="M5 3 2 6l3 3M11 2 7 10M13 3l3 3-3 3" />
      </svg>
    </span>
  );
}

export function ModelTitle({
  model,
  modelId,
  title,
  size,
}: {
  model?: Pick<ModelConfig, "id" | "name" | "warehouseId">;
  modelId?: string;
  title?: string;
  size?: "small" | "default" | "large";
}) {
  const models = useConfigObjectList("model");
  const resolved = model ?? models.find(m => m.id === modelId);
  return (
    <ObjectTitle
      size={size}
      title={title ?? resolved?.name ?? modelId ?? "Unknown model"}
      icon={<ModelIcon model={resolved} />}
    />
  );
}
