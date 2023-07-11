import React, { useMemo } from "react";
import styles from "./DestinationsCatalog.module.css";

import { coreDestinations, DestinationType } from "../../lib/schema/destinations";
import { FaCloud, FaDatabase } from "react-icons/fa";

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

export const DestinationCatalog: React.FC<{ onClick: (destinationType: string) => void }> = ({ onClick }) => {
  const groups = useMemo(() => groupDestinationTypes(), []);
  return (
    <div className="p-12 flex flex-col flex-shrink w-full h-full overflow-y-auto">
      <div className={"flex-shrink overflow-scroll"}>
        {Object.entries(groups).map(([tag, destinations]) => (
          <div key={tag} className="">
            <div className="text-3xl text-textLight px-4 pb-0 pt-3">{tag}</div>
            <div className="flex flex-wrap">
              {destinations.map(destination => (
                <div
                  key={destination.id}
                  className={`cursor-pointer relative w-72 border border-textDisabled ${
                    !destination.comingSoon && "hover:scale-105 hover:border-primary"
                  } transition ease-in-out flex rounded-lg px-4 py-4 space-x-4 m-4`}
                  onClick={() => onClick(destination.id)}
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
};
