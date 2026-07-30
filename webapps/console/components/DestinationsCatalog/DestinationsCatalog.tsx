import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import styles from "./DestinationsCatalog.module.css";

import { coreDestinations, DestinationType } from "../../lib/schema/destinations";
import { FaCloud, FaDatabase } from "react-icons/fa";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { useApi } from "../../lib/useApi";
import { DestinationConfig } from "../../lib/schema";
import { Input, InputRef, Skeleton } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { ProvisionDatabaseButton } from "../ProvisionDatabaseButton/ProvisionDatabaseButton";
import { useRouter } from "next/router";
import { useJitsu } from "@jitsu/jitsu-react";

function groupDestinationTypes(): Record<string, DestinationType[]> {
  const groups: Record<string, DestinationType[]> = {};

  const sortOrder = ["Datawarehouse", "Product Analytics", "CRM", "Block Storage"];

  coreDestinations.forEach(d => {
    if (d.tags) {
      (typeof d.tags === "string" ? [d.tags] : d.tags).forEach(tag => {
        groups[tag] = groups[tag] || [];
        groups[tag].push(d);
      });
    }
  });
  return Object.entries(groups)
    .sort(([k1], [k2]) => {
      const i1 = sortOrder.indexOf(k1);
      const i2 = sortOrder.indexOf(k2);
      if (i1 === -1 && i2 === -1) {
        return k1.localeCompare(k2);
      }
      if (i1 === -1) {
        return 1;
      }
      if (i2 === -1) {
        return -1;
      }
      return i1 - i2;
    })
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
}

export function getDestinationIcon(destination?: DestinationType) {
  if (!destination) {
    return <FaCloud />;
  }
  const tags = (
    destination.tags ? (typeof destination.tags === "string" ? [destination.tags] : destination.tags) : []
  ).map(t => t.toLowerCase());
  return destination.icon || (tags.includes("datawarehouse") ? <FaDatabase /> : <FaCloud />);
}

function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(nodeText).join(" ");
  }
  if (React.isValidElement(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

function destinationMatches(d: DestinationType, filter: string): boolean {
  const tags = d.tags ? (typeof d.tags === "string" ? [d.tags] : d.tags) : [];
  return [d.title, d.id, ...tags, nodeText(d.description)].join(" ").toLowerCase().includes(filter);
}

export type DestinationCatalogHandle = {
  focusSearch: () => void;
};

export const DestinationCatalog = React.forwardRef<
  DestinationCatalogHandle,
  { onClick: (destinationType: string) => void; dismiss: () => any }
>(({ onClick, dismiss }, ref) => {
  const workspace = useWorkspace();
  const router = useRouter();
  const appConfig = useAppConfig();
  const { analytics } = useJitsu();
  const [filter, setFilter] = useState("");
  const searchRef = useRef<InputRef>(null);

  useImperativeHandle(ref, () => ({
    focusSearch: () => searchRef.current?.focus(),
  }));
  const { isLoading, data, error, refetch } = useApi<{ objects: DestinationConfig[] }>(
    `/api/${workspace.id}/config/destination`
  );
  const provisionedDestinations = data?.objects.filter(d => d.provisioned) || [];

  const loader = (
    <div className="flex flex-col justify-center mt-4" style={{ height: "200px" }}>
      <Skeleton paragraph={{ rows: 4, width: "100%" }} title={false} active />
    </div>
  );
  const allGroups = useMemo(() => groupDestinationTypes(), []);
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return allGroups;
    }
    return Object.fromEntries(
      Object.entries(allGroups)
        .map(([tag, destinations]) => [tag, destinations.filter(d => destinationMatches(d, needle))] as const)
        .filter(([, destinations]) => destinations.length > 0)
    );
  }, [allGroups, filter]);
  const resultCount = useMemo(() => Object.values(groups).reduce((acc, d) => acc + d.length, 0), [groups]);

  useEffect(() => {
    const query = filter.trim();
    if (!query) {
      return;
    }
    const timeout = setTimeout(() => {
      analytics.track("destination_catalog_search", {
        query,
        resultCount,
        noResults: resultCount === 0,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
      });
    }, 1000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, resultCount]);

  return (
    <div className="p-12 flex flex-col flex-shrink w-full h-full overflow-y-auto">
      <div className="mb-4">
        <Input
          ref={searchRef}
          autoFocus
          allowClear
          size="large"
          prefix={<SearchOutlined />}
          placeholder="Search destinations"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>
      {resultCount === 0 && (
        <div className="text-center text-textLight py-12">
          No destinations match <b>{filter}</b>
        </div>
      )}
      <div className={"flex-shrink overflow-auto"}>
        {Object.entries(groups).map(([tag, destinations]) => (
          <div key={tag} className="">
            <div className="text-3xl text-textLight px-4 pb-0 pt-3">{tag}</div>
            {tag === "Datawarehouse" &&
              appConfig.ee.available &&
              provisionedDestinations &&
              provisionedDestinations.length === 0 && (
                <div className={"px-4 mb-4 mt-6"}>
                  <ProvisionDatabaseButton
                    loader={loader}
                    createdCallback={() => {
                      dismiss();
                    }}
                  />
                </div>
              )}
            <div className="flex flex-wrap">
              {destinations.map(destination => (
                <div
                  key={destination.id}
                  className={`relative w-72 border border-textDisabled ${
                    !destination.comingSoon && "cursor-pointer hover:scale-105 hover:border-primary"
                  } transition ease-in-out flex rounded-lg px-4 py-4 space-x-4 m-4`}
                  onClick={!destination.comingSoon ? () => onClick(destination.id) : undefined}
                >
                  {destination.comingSoon && (
                    <div className="absolute -right-2 -top-2 bg-primary text-backgroundLight px-1 py-0.5 rounded">
                      Coming soon
                    </div>
                  )}
                  <div className={styles.icon}>{getDestinationIcon(destination)}</div>
                  <div>
                    <div className={`text-xl  ${destination.comingSoon && "text-textDisabled"}`}>
                      {destination.title}
                    </div>
                    {destination.description && <div className="text-xs text-textLight">{destination.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

DestinationCatalog.displayName = "DestinationCatalog";
