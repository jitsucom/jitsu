import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useWorkspace } from "../../lib/context";
import { useConfigObjectList } from "../../lib/store";
import type { ReverseSyncView } from "../../lib/reverse-etl";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import { ModelTitle } from "./ModelTitle";

export function ReverseSyncTitle({
  sync,
  syncId,
  link = true,
  className = "",
}: {
  sync?: ReverseSyncView;
  syncId: string;
  link?: boolean;
  className?: string;
}) {
  const workspace = useWorkspace();
  const destinations = useConfigObjectList("destination");
  const content = sync ? (
    <div className={`flex gap-2 items-center ${className}`}>
      <ModelTitle size="small" modelId={sync.fromId} title={sync.modelName} />
      <ArrowRight className="w-4 h-4 text-textLight" />
      <DestinationTitle size="small" destination={destinations.find(d => d.id === sync.toId)} />
    </div>
  ) : (
    <span>{syncId}</span>
  );
  return link ? <Link href={`/${workspace.slugOrId}/reverse-syncs?id=${syncId}`}>{content}</Link> : content;
}
