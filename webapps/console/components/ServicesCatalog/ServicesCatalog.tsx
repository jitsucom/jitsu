import styles from "./ServicesCatalog.module.css";

import { FaCloud, FaDatabase } from "react-icons/fa";
import { useApi } from "../../lib/useApi";
import { SourceType } from "../../pages/api/sources";
import capitalize from "lodash/capitalize";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import React from "react";
import { ErrorCard } from "../GlobalError/GlobalError";
import { Input } from "antd";
import { useAppConfig, useWorkspace } from "../../lib/context";

function groupByType(sources: SourceType[]): Record<string, SourceType[]> {
  const groups: Record<string, SourceType[]> = {};
  const otherGroup = "other";
  const sortOrder = ["Datawarehouse", "Product Analytics", "CRM", "Block Storage"];

  sources.forEach(s => {
    if (s.packageId.endsWith("strict-encrypt") || s.packageId === "airbyte/source-file-secure") {
      return;
    }
    const groupName = s.meta.connectorSubtype || otherGroup;
    groups[groupName] = groups[groupName] || [];
    groups[groupName].push(s);
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

export function getServiceIcon(source: SourceType, icons: Record<string, string> = {}): React.ReactNode {
  const connectorSubtype = source.meta.connectorSubtype;

  const logoSvg = (source.logoSvg || icons[source.packageId]) as string;
  return logoSvg ? (
    <img src={"data:image/svg+xml;base64," + Buffer.from(logoSvg).toString("base64")} alt={source.meta.name} />
  ) : connectorSubtype === "database" ? (
    <FaDatabase className={"w-full h-full"} />
  ) : (
    <FaCloud className={"w-full h-full"} />
  );
}

export const ServicesCatalog: React.FC<{ onClick: (packageType, packageId: string) => void }> = ({ onClick }) => {
  const { data, isLoading, error } = useApi<{ sources: SourceType[] }>(`/api/sources?mode=meta`);
  const sourcesIconsLoader = useApi<{ sources: SourceType[] }>(`/api/sources?mode=icons-only`);
  const workspace = useWorkspace();
  const [filter, setFilter] = React.useState("");
  const appconfig = useAppConfig();
  const sourcesIcons: Record<string, string> = sourcesIconsLoader.data
    ? sourcesIconsLoader.data.sources.reduce(
        (acc, item) => ({
          ...acc,
          [item.packageId]: item.logoSvg,
        }),
        {}
      )
    : {};

  if (isLoading) {
    return <LoadingAnimation />;
  } else if (error) {
    return <ErrorCard error={error} />;
  }
  const groups = groupByType(data.sources);
  return (
    <div className="p-6 flex flex-col flex-shrink w-full h-full overflow-y-auto">
      <div key={"filter"} className={"m-4"}>
        <Input
          allowClear
          placeholder={sourcesIconsLoader.data ? `Search ${sourcesIconsLoader.data.sources.length} sources` : `Search`}
          onChange={e => {
            setFilter(e.target.value);
          }}
          className="w-full border border-textDisabled rounded-lg px-4 py-4"
        />
      </div>
      <div className={"flex-shrink overflow-auto"}>
        {Object.entries(groups).map(([group, sources]) => {
          const filtered = sources
            .filter(source => source.meta.name)
            .filter(source => source.meta.name && source.meta.name.toLowerCase().includes(filter.toLowerCase()))
            .filter(
              source =>
                !appconfig.mitCompliant || workspace.featuresEnabled.includes("ignore_sources_licenses") ||
                source.meta.license?.toLowerCase() === "mit" ||
                (source.meta.mitVersions && source.meta.mitVersions.length > 0)
            );
          if (filtered.length === 0) {
            return null;
          }
          return (
            <div key={group} className="">
              <div className="text-3xl text-textLight px-4 pb-0 pt-3">
                {group === "api" ? "API" : capitalize(group)}
              </div>
              <div className="flex flex-wrap">
                {filtered
                  .sort((a, b) => {
                    const res = (b.sortIndex || 0) - (a.sortIndex || 0);
                    return res === 0 ? a.meta.name.localeCompare(b.meta.name) : res;
                  })
                  .map(source => {
                    return (
                      <div
                        key={source.id}
                        className={`flex items-center cursor-pointer relative w-72 border border-textDisabled ${"hover:scale-105 hover:border-primary"} transition ease-in-out rounded-lg px-4 py-4 space-x-4 m-4`}
                        onClick={() => onClick(source.packageType, source.packageId)}
                      >
                        <div className={`${styles.icon} flex`}>{getServiceIcon(source, sourcesIcons)}</div>
                        <div>
                          <div className={`text-xl`}>{source.meta.name}</div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
