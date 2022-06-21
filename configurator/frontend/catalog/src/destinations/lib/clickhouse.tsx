import { modeParameter, tableName } from "./common"
import { arrayOf, booleanType, stringType } from "../../sources/types"
import { ReactNode } from "react"

let icon: ReactNode = (
  <svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 9 8">
    <style>{".o{fill:#fc0}.r{fill:red}"}</style>
    <path d="M0,7 h1 v1 h-1 z" className="r" />
    <path d="M0,0 h1 v7 h-1 z" className="o" />
    <path d="M2,0 h1 v8 h-1 z" className="o" />
    <path d="M4,0 h1 v8 h-1 z" className="o" />
    <path d="M6,0 h1 v8 h-1 z" className="o" />
    <path d="M8,3.25 h1 v1.5 h-1 z" className="o" />
  </svg>
)

const destination = {
  description: (
    <>
      ClickHouse is a fast and scalable database developed by Yandex. ClickHouse is not easy to mainatain, however the
      performance is remarkable. Managed services can be obtained from{" "}
      <a target="_blank" href="https://altinity.com/cloud-database/">
        Altinity.Cloud
      </a>
    </>
  ),
  syncFromSourcesStatus: "supported",
  id: "clickhouse",
  type: "database",
  displayName: "ClickHouse",
  defaultTransform: "",
  hidden: false,
  deprecated: false,
  ui: {
    icon,
    title: cfg => (cfg?._formData?.ch_dsns_list?.length ? cfg._formData.ch_dsns_list[0] : "Unknown"),
    connectCmd: cfg =>
      cfg?._formData?.ch_dsns_list?.length
        ? `echo 'SELECT 1' | curl '${cfg._formData.ch_dsns_list[0]}' --data-binary @-`
        : "",
  },
  parameters: [
    modeParameter(),
    tableName(),
    {
      id: "_formData.ch_dsns_list",
      displayName: "Datasources",
      required: true,
      type: arrayOf(stringType),
      documentation: (
        <>
          A list of DSNs (server names). It's recommended to add at least two servers within the cluster for redundancy{" "}
          <a target="_blank" href="https://jitsu.com/docs/destinations-configuration/clickhouse-destination#clickhouse">
            documentation
          </a>
        </>
      ),
    },
    {
      id: "_formData.ch_cluster",
      displayName: "Cluster",
      required: cfg => cfg._formData?.ch_dsns_list?.length > 1,
      type: stringType,
      documentation: (
        <>
          <p>
            Cluster name. See{" "}
            <a
              target="_blank"
              href="https://jitsu.com/docs/destinations-configuration/clickhouse-destination#clickhouse"
            >
              documentation
            </a>
            .
          </p>
          <p>
            Run <code>SELECT * from system.clusters</code> to the list of all available clusters
          </p>
        </>
      ),
    },
    {
      id: "_formData.ch_database",
      displayName: "Database",
      documentation: (
        <>
          Database name. See{" "}
          <a target="_blank" href="https://jitsu.com/docs/destinations-configuration/clickhouse-destination#clickhouse">
            documentation
          </a>
        </>
      ),
      required: true,
      type: stringType,
    },
    {
      id: "_users_recognition._enabled",
      displayName: "User Recognition",
      documentation: (
        <>
          Jitsu can retroactively update events from anonymous users with user id after users identification. See{" "}
          <a href="https://jitsu.com/docs/other-features/retroactive-user-recognition">Docs</a>.<br />
          User Recognition support for Clickhouse is limited to ReplacingMergeTree and ReplicatedReplacingMergeTree
          engine.
          <br />
          Clickhouse handles data mutation differently. Please read{" "}
          <a href="https://jitsu.com/docs/other-features/retroactive-user-recognition/clickhouse">
            Clickhouse specifics
          </a>{" "}
          to avoid unexpected results of Retroactive User Recognition on Clickhouse data tables.
        </>
      ),
      required: false,
      defaultValue: true,
      type: booleanType,
    },
  ],
} as const

export default destination
