import styles from "./ServicesCatalog.module.css";

import { FaCloud, FaDatabase } from "react-icons/fa";
import { useApi } from "../../lib/useApi";
import { SourceType } from "../../pages/api/sources";
import capitalize from "lodash/capitalize";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import React from "react";
import { ErrorCard } from "../GlobalError/GlobalError";
import { Input } from "antd";

function groupByType(sources: SourceType[]): Record<string, SourceType[]> {
  const groups: Record<string, SourceType[]> = {};
  const otherGroup = "other";
  const sortOrder = ["Datawarehouse", "Product Analytics", "CRM", "Block Storage"];

  sources.forEach(s => {
    if (s.meta.license !== "MIT") {
      return;
    }
    if (s.packageId.endsWith("strict-encrypt")) {
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

export function getDestinationIcon(source: SourceType) {
  const connectorSubtype = source.meta.connectorSubtype;
  return source.logo ? (
    <img src={source.logo} alt={source.meta.name} />
  ) : connectorSubtype === "database" ? (
    <FaDatabase />
  ) : (
    <FaCloud />
  );
}

export const ServicesCatalog: React.FC<{ onClick: (packageType, packageId: string) => void }> = ({ onClick }) => {
  const { data, isLoading, error } = useApi<{ sources: SourceType[] }>(`/api/sources`);
  const [filter, setFilter] = React.useState("");

  if (isLoading) {
    return <LoadingAnimation />;
  } else if (error) {
    return <ErrorCard error={error} />;
  }
  const groups = groupByType(data.sources);
  return (
    <div className="p-12 flex flex-col flex-shrink w-full h-full overflow-y-auto">
      <div key={"filter"} className={"m-4"}>
        <Input
          allowClear
          placeholder="Search"
          onChange={e => {
            setFilter(e.target.value);
          }}
          className="w-full border border-textDisabled rounded-lg px-4 py-4"
        />
      </div>
      <div className={"flex-shrink overflow-scroll"}>
        {Object.entries(groups).map(([group, sources]) => {
          const filtered = sources.filter(source => source.meta.name.toLowerCase().includes(filter.toLowerCase()));
          if (filtered.length === 0) {
            return null;
          }
          return (
            <div key={group} className="">
              <div className="text-3xl text-textLight px-4 pb-0 pt-3">
                {group === "api" ? "API" : capitalize(group)}
              </div>
              <div className="flex flex-wrap">
                {filtered.map(source => {
                  return (
                    <div
                      key={source.id}
                      className={`flex items-center cursor-pointer relative w-72 border border-textDisabled ${"hover:scale-105 hover:border-primary"} transition ease-in-out rounded-lg px-4 py-4 space-x-4 m-4`}
                      onClick={() => onClick(source.packageType, source.packageId)}
                    >
                      <div className={`${styles.icon} flex`}>{getDestinationIcon(source)}</div>
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
