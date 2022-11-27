import {
  Parameter,
  passwordType,
  selectionType,
  stringType,
  Function,
  hiddenValue,
  jsonType,
  booleanType,
} from "../../sources/types"
import { ReactNode } from "react"
import * as React from "react"

const S3_REGIONS = [
  "us-east-2",
  "us-east-1",
  "us-west-1",
  "us-west-2",
  "ap-south-1",
  "ap-northeast-3",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ca-central-1",
  "cn-north-1",
  "cn-northwest-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-south-1",
  "eu-west-3",
  "eu-north-1",
  "me-south-1",
  "sa-east-1",
  "us-gov-east-1",
  "us-gov-west-1",
]

export const modeParameter = (constValue?: string): Parameter => {
  return {
    id: "_formData.mode",
    displayName: "Mode",
    documentation: <>In steam mode the data will be send to destination instantly.</>,
    required: true,
    defaultValue: constValue ?? "stream",
    constant: constValue ?? undefined,
    type: constValue ? stringType : selectionType(["stream", "batch"], 1),
  }
}

export const filteringExpressionDocumentation = <>Table name (or table name template).</>

/**
 * Destination table name for DBS
 */
export const tableName = (customDocs?: ReactNode): Parameter => {
  return {
    id: `_formData.tableName`,
    displayName: "Table Name",
    documentation: customDocs ?? <>Table name (or table name template).</>,
    required: true,
    defaultValue: "events",
    type: stringType,
  }
}

export function s3Credentials(
  regionField,
  bucketField,
  s3AccessKey,
  s3SecretKey,
  s3EndpointField,
  hide?: Function<any, boolean>
): Parameter[] {
  let params: Parameter[] = [
    {
      id: regionField,
      displayName: "S3 Region",
      type: selectionType(S3_REGIONS, 1),
      required: true,
      defaultValue: "us-west-1",
      constant: hiddenValue("us-west-1", hide),
    },
    {
      id: bucketField,
      displayName: "S3 Bucket",
      type: stringType,
      required: true,
      constant: hiddenValue("", hide),
    },
    {
      id: s3AccessKey,
      displayName: "S3 Access Key",
      type: stringType,
      required: true,
      constant: hiddenValue("", hide),
    },
    {
      id: s3SecretKey,
      displayName: "S3 Secret Key",
      type: passwordType,
      required: true,
      constant: hiddenValue("", hide),
    },
  ]
  if (s3EndpointField) {
    params.push({
      id: s3EndpointField,
      displayName: "S3 Endpoint",
      documentation: <>Custom S3 endpoint. To use default Amazon endpoint leave this field empty.</>,
      type: stringType,
      required: false,
      constant: hiddenValue("", hide),
    })
  }
  return params
}

export function gcsCredentials(
  accessKey,
  bucketField,
  hide?: Function<any, boolean>,
  help?: {
    bucketField?: string
  }
): Parameter[] {
  return [
    {
      id: accessKey,
      displayName: "Access Key",
      documentation: (
        <>
          Google Service Account JSON credentials for GCS Bucket.{" "}
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
      constant: hiddenValue("", hide),
    },
    {
      id: bucketField,
      documentation: <>Name of GCS Bucket.{help?.bucketField ? " " + help!.bucketField : ""}</>,
      displayName: "GCS Bucket",
      required: true,
      type: stringType,
      constant: hiddenValue("", hide),
    },
  ]
}

export function fileParameters(folderField, formatField, compressionField): Parameter[] {
  return [
    {
      id: folderField,
      displayName: "Folder",
      required: false,
      defaultValue: "",
      type: stringType,
    },
    {
      id: formatField,
      displayName: "Format",
      required: true,
      defaultValue: "json",
      type: selectionType(["json", "flat_json", "csv", "parquet"], 1),
      documentation: (
        <>
          <b>json</b> - not flattened json objects with \n delimiter
          <br />
          <b>flat_json</b> - flattened json objects with \n delimiter
          <br />
          <b>csv</b> - flattened csv objects with \n delimiter
          <br />
          <b>parquet</b> - flattened objects which are stored as apache parquet file
          <br />
        </>
      ),
    },
    {
      id: compressionField,
      displayName: "Enable gzip compression",
      required: false,
      type: booleanType,
      defaultValue: false,
      documentation: (
        <>
          If enabled - all files with events will be compressed (gzip) before uploading. All files will have the suffix
          '.gz'
        </>
      ),
    },
  ]
}
