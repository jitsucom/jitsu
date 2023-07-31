import {
  booleanType,
  intType,
  isoUtcDateType,
  jsonType,
  oauthSecretType,
  Parameter,
  ParameterType,
  passwordType,
  SdkSource,
  selectionType,
  singleSelectionType,
  SourceConnector,
  stringType,
} from "../types"
import { get } from "lodash"

export const makeSdkSource = (sdkSource: SdkSource): SourceConnector => {
  return {
    protoType: "sdk_source",
    expertMode: false,
    pic: sdkSource.pic,
    displayName: sdkSource.displayName,
    id: sdkSource.id,
    collectionTypes: [],
    documentation: sdkSource.documentation,
    collectionParameters: [],
    staticStreamsConfigEndpoint: `/sdk_source/catalog?package=${encodeURIComponent(
      sdkSource.package_name + "@" + sdkSource.package_version
    )}`,
    specEndpoint: `/sdk_source/spec?package=${encodeURIComponent(
      sdkSource.package_name + "@" + sdkSource.package_version
    )}`,
    configParameters: [
      {
        displayName: "Sdk Source Package Name",
        id: "config.package_name",
        type: stringType,
        required: true,
        documentation: <>Sdk Source Package Name</>,
        constant: sdkSource.package_name,
      },
      {
        displayName: "Sdk Source Package Version",
        id: "config.package_version",
        type: stringType,
        required: true,
        documentation: <>Sdk Source Package Version</>,
        constant: sdkSource.package_version,
      },
    ],
    hasLoadableConfigParameters: true,
  }
}

export const convertSdkType = (type: any): ParameterType<any> => {
  let tp: ParameterType<any> = stringType
  switch (type) {
    case "int":
      tp = intType
      break
    case "string":
    case undefined:
      tp = stringType
      break
    case "json":
      tp = jsonType
      break
    case "boolean":
      tp = booleanType
      break
    case "password":
      tp = passwordType
      break
    case "isoUtcDate":
      tp = isoUtcDateType
      break
    case "oauthSecret":
      tp = oauthSecretType
      break
    default:
      if (type["severalOf"]) {
        tp = selectionType(type["severalOf"], type["max"])
      } else if (type["oneOf"]) {
        tp = singleSelectionType(type["oneOf"])
      }
  }
  return tp
}

/**
 * Maps the spec of the SdkSource connector to the Jitsu `Parameter` schema of the `SourceConnector`.
 * @param extensionDescriptor source plugin's descriptor.
 */
export const mapSdkSourceSpecToSourceConnectorConfig = (
  extensionDescriptor: any,
  availableOauthBackendSecrets: string[]
): Parameter[] => {
  const result: Parameter[] = []
  const configurationParameters = extensionDescriptor["configurationParameters"]
  configurationParameters.forEach(param => {
    let tp = convertSdkType(param["type"])
    if (availableOauthBackendSecrets && availableOauthBackendSecrets.includes(param["id"])) {
      tp = oauthSecretType
    }
    const relevantIf = param["relevantIf"]

    result.push({
      ...param,
      id: "config." + param["id"],
      type: tp,
      omitFieldRule: relevantIf
        ? (config: unknown) => get(config["config"], relevantIf["field"]) !== relevantIf["value"]
        : undefined,
    })
  })
  return result
}
