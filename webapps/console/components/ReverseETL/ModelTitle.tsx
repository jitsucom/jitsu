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
  return type ? getDestinationIcon(type) : <Database className="w-full h-full" />;
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
