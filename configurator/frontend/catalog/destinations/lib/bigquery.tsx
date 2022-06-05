import { Destination } from "../types"
import { modeParameter, tableName } from "./common"
import { hiddenValue, jsonType, stringType } from "../../sources/types"

const icon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    height="100%"
    width="100%"
    viewBox="-1.633235433328256 7.0326093303156565 131.26574682416876 114.63439066968435"
  >
    <linearGradient id="bgq" gradientUnits="userSpaceOnUse" x1="64" x2="64" y1="7.034" y2="120.789">
      <stop offset="0" stopColor="#4387fd" />
      <stop offset="1" stopColor="#4683ea" />
    </linearGradient>
    <path
      d="M27.79 115.217L1.54 69.749a11.499 11.499 0 0 1 0-11.499l26.25-45.467a11.5 11.5 0 0 1 9.96-5.75h52.5a11.5 11.5 0 0 1 9.959 5.75l26.25 45.467a11.499 11.499 0 0 1 0 11.5l-26.25 45.467a11.5 11.5 0 0 1-9.959 5.749h-52.5a11.499 11.499 0 0 1-9.96-5.75z"
      fill="url(#bgq)"
    />
    <path
      clipPath="url(#b)"
      d="M119.229 86.48L80.625 47.874 64 43.425l-14.933 5.55L43.3 64l4.637 16.729 40.938 40.938 8.687-.386z"
      opacity=".07"
    />
    <g fill="#fff">
      <path d="M64 40.804c-12.81 0-23.195 10.385-23.195 23.196 0 12.81 10.385 23.195 23.195 23.195S87.194 76.81 87.194 64c0-12.811-10.385-23.196-23.194-23.196m0 40.795c-9.72 0-17.6-7.88-17.6-17.6S54.28 46.4 64 46.4 81.6 54.28 81.6 64 73.72 81.6 64 81.6" />
      <path d="M52.99 63.104v7.21a12.794 12.794 0 0 0 4.38 4.475V63.104zM61.675 57.026v19.411c.745.137 1.507.22 2.29.22.714 0 1.41-.075 2.093-.189V57.026zM70.766 66.1v8.562a12.786 12.786 0 0 0 4.382-4.7v-3.861zM80.691 78.287l-2.403 2.405a1.088 1.088 0 0 0 0 1.537l9.115 9.112a1.088 1.088 0 0 0 1.537 0l2.403-2.402a1.092 1.092 0 0 0 0-1.536l-9.116-9.116a1.09 1.09 0 0 0-1.536 0" />
    </g>
  </svg>
)

const bigQueryDestination = {
  description: (
    <>
      <a target="_blank" href="https://cloud.google.com/bigquery">
        Google BigQuery
      </a>{" "}
      is a fast, scalable, and easy-to-use data warehouse. Main advantages of Google BiqQuery are:
      <ul>
        <li>
          <b>Serverless architecture</b>.{" "}
        </li>
        <li>
          <b>Pay-as-you go</b>
        </li>
      </ul>
      Jitsu can{" "}
      <a target="_blank" href="https://cloud.google.com/bigquery/streaming-data-into-bigquery">
        stream
      </a>{" "}
      and{" "}
      <a target="_blank" href="https://cloud.google.com/bigquery/docs/batch-loading-data">
        batch
      </a>{" "}
      data to Google BigQuery. Streaming will get data to BQ immediately, however Google charges for each streamed
      record, while batching is free. Streaming is the fastest way to get started, but batching will be cheaper for
      large volumes.
    </>
  ),
  syncFromSourcesStatus: "supported",
  id: "bigquery",
  type: "database",
  displayName: "BigQuery",
  defaultTransform: "",
  hidden: false,
  deprecated: false,
  ui: {
    icon: icon,
    connectCmd: (cfg: object) => {
      return `echo '${cfg["_formData"]["bqJSONKey"].replaceAll(
        "\n",
        " "
      )}' > bqkey.json;\\\ngcloud auth activate-service-account --key-file bqkey.json;\\\nbq query "SELECT 1;"`
    },
    title: (cfg: object) => {
      return cfg["_formData"]["pghost"]
    },
  },
  parameters: [
    {
      id: "$type",
      constant: "BQConfig",
    },
    modeParameter(),
    tableName(),
    {
      id: "_formData.bqProjectId",
      displayName: "Project Id",
      required: true,
      type: stringType,
    },
    {
      id: "_formData.bqDataset",
      displayName: "Dataset",
      defaultValue: "default",
      type: stringType,
    },
    {
      id: "_formData.bqJSONKey",
      displayName: "Access Key",
      documentation: (
        <>
          Google Service Account JSON for BigQuery.{" "}
          <a
            target="_blank"
            href="https://jitsu.com/docs/configuration/google-authorization#service-account-configuration"
          >
            Read more about Google Authorization
          </a>
        </>
      ),
      required: true,
      type: jsonType,
    },
    {
      id: "_formData.bqGCSBucket",
      documentation: <>Name of GCS Bucket. The bucket should be accessible with the same Access Key as dataset</>,
      displayName: "GCS Bucket",
      required: true,
      type: stringType,
      constant: hiddenValue("", cfg => {
        return cfg?.["_formData"]?.mode !== "batch"
      }),
    },
  ],
} as const

export default bigQueryDestination
