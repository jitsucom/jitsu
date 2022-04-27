import {
  booleanType,
  intType,
  jsonType,
  Parameter,
  ParameterType,
  passwordType,
  SdkSource,
  SourceConnector,
  stringType,
} from "../types"

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
    staticStreamsConfigEndpoint: `/sdk_source/${sdkSource.package_name}@${sdkSource.package_version}/catalog`,
    specEndpoint: `/sdk_source/${sdkSource.package_name}@${sdkSource.package_version}/spec`,
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

/**
 * Maps the spec of the SdkSource connector to the Jitsu `Parameter` schema of the `SourceConnector`.
 * @param extensionDescriptor source plugin's descriptor.
 */
export const mapSdkSourceSpecToSourceConnectorConfig = (extensionDescriptor: any): Parameter[] => {
  const result: Parameter[] = []
  const configurationParameters = extensionDescriptor["configurationParameters"]

  configurationParameters.forEach(param => {
    let tp: ParameterType<any> = stringType
    switch (param["type"]) {
      case "int":
        tp = intType
        break
      case "json":
        tp = jsonType
        break
      case "boolean":
        tp = booleanType
        break
      case "password":
        tp = passwordType
    }
    result.push({
      ...param,
      id: "config." + param["id"],
      type: tp,
    })
  })
  return result
}
