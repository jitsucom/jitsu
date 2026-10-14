import React from "react";
import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import { useWorkspace } from "../../lib/context";
import { coreDestinationsMap } from "../../lib/schema/destinations";
import type { DestinationConfig } from "../../lib/schema";

type DestinationLink = { toId: string; type: string; deleted?: boolean };

export function DestinationConnections({
  destination,
  links,
}: {
  destination: DestinationConfig;
  links: DestinationLink[];
}) {
  const workspace = useWorkspace();
  const type = coreDestinationsMap[destination.destinationType];
  const connected = links.filter(link => link.toId === destination.id && !link.deleted);
  const destinationId = encodeURIComponent(destination.id);
  const groups = [
    { type: "push", label: "site", path: `/connections?destination=${destinationId}` },
    { type: "sync", label: "sync", path: `/syncs?destination=${destinationId}` },
    { type: "reverse-sync", label: "Reverse ETL sync", path: `/reverse-syncs?destinationId=${destinationId}` },
  ].map(group => ({ ...group, count: connected.filter(link => link.type === group.type).length }));
  // Paused syncs still belong to the destination; count all non-deleted links.
  const populated = groups.filter(group => group.count > 0);
  const creationLinks = [
    ...(type?.usesBulker ? [{ label: "sync", path: `/syncs/edit?destination=${destinationId}` }] : []),
    ...(workspace.featuresEnabled.includes("reverse-etl") && reverseDestinationMetadata.has(destination.destinationType)
      ? [{ label: "Reverse ETL sync", path: `/reverse-syncs?id=new&destinationId=${destinationId}` }]
      : []),
    ...(!type?.reverseEtlOnly
      ? [{ label: "site connection", path: `/connections/edit?destinationId=${destinationId}` }]
      : []),
  ];
  return (
    <div className="flex items-center">
      {populated.length ? (
        <Check className="h-4 w-4 mr-1 shrink-0 text-success" />
      ) : (
        <AlertTriangle className="h-4 w-4 mr-1 shrink-0 text-warning" />
      )}
      <span className="text-sm">
        {populated.length ? (
          <>
            Connected to{" "}
            {populated.map((group, index) => (
              <React.Fragment key={group.type}>
                {index > 0 && (index === populated.length - 1 ? " and " : ", ")}
                <Link href={`/${workspace.slugOrId}${group.path}`}>
                  {group.count} {group.label}
                  {group.count === 1 ? "" : "s"}
                </Link>
              </React.Fragment>
            ))}
          </>
        ) : creationLinks.length ? (
          <>
            Create a{" "}
            {creationLinks.map((option, index) => (
              <React.Fragment key={option.label}>
                {index > 0 && " or "}
                <Link href={`/${workspace.slugOrId}${option.path}`}>{option.label}</Link>
              </React.Fragment>
            ))}{" "}
            to start seeing data
          </>
        ) : (
          "No connected syncs. Reverse ETL is not enabled for this workspace."
        )}
      </span>
    </div>
  );
}
