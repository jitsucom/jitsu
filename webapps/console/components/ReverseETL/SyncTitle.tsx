import React from "react";
import Link from "next/link";
import { ArrowRight, Database } from "lucide-react";
import { useWorkspace } from "../../lib/context";
import { useConfigObjectList } from "../../lib/store";
import type { ReverseSyncView } from "../../lib/reverse-etl";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import { ObjectTitle } from "../ObjectTitle/ObjectTitle";

export function ReverseSyncTitle({
  sync,
  syncId,
  link = true,
}: {
  sync?: ReverseSyncView;
  syncId: string;
  link?: boolean;
}) {
  const workspace = useWorkspace();
  const destinations = useConfigObjectList("destination");
  const content = sync ? (
    <div className="flex flex-col gap-1">
      {sync.options.name && <span className="text-xs text-textLight">{sync.options.name}</span>}
      <div className="flex gap-2 items-center flex-wrap">
        <ObjectTitle size="small" title={sync.modelName} icon={<Database className="w-full h-full" />} />
        <ArrowRight className="w-4 h-4 text-textLight" />
        <DestinationTitle size="small" destination={destinations.find(d => d.id === sync.toId)} />
      </div>
    </div>
  ) : (
    <span>{syncId}</span>
  );
  return link ? <Link href={`/${workspace.slugOrId}/reverse-syncs?id=${syncId}`}>{content}</Link> : content;
}
