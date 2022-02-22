import { SingerTap, jsonType, Parameter, SourceConnector, stringType } from "../types"

export const singerConfigParams: Record<string, (tap: string) => Parameter> = {
  catalogJson: (tap: string): Parameter => {
    return {
      displayName: "Singer Catalog JSON",
      id: "catalog",
      type: jsonType,
      required: true,
      documentation: (
        <>
          Singer{" "}
          <a target="_blank" href="https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#catalog">
            catalog
          </a>{" "}
          that defines data layout.{" "}
          <a href={`https://github.com/singer-io/${tap}`}>Read catalog documentation for {tap}</a>
        </>
      ),
      defaultValue: {},
    }
  },
  stateJson: (tap: string): Parameter => {
    return {
      displayName: "Singer Initial State JSON",
      id: "state",
      type: jsonType,
      documentation: (
        <>
          Singer initial{" "}
          <a target="_blank" href="https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#state">
            state
          </a>
          . For most cases should be empty
          <a href={`https://github.com/singer-io/${tap}`}>Read documentation for {tap}</a>
        </>
      ),
      defaultValue: {},
    }
  },
  propertiesJson: (tap: string): Parameter => {
    return {
      displayName: "Singer Properties JSON",
      id: "properties",
      type: jsonType,
      documentation: (
        <>
          Singer properties that defines resulting schema.{" "}
          <a href={`https://github.com/singer-io/${tap}`}>Read documentation for {tap}</a>
        </>
      ),
      defaultValue: {},
    }
  },
  configJson: (tap: string): Parameter => {
    return {
      displayName: "Singer Config JSON",
      id: "config",
      type: jsonType,
      required: true,
      documentation: (
        <>
          Singer{" "}
          <a href={"https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#state"}>configuration</a>.{" "}
          <a href={`https://github.com/singer-io/${tap}`}>Read documentation for {tap}</a>
        </>
      ),
      defaultValue: {},
    }
  },
}

export type ParametersCustomization = {
  /**
   * Replacement for singerConfigParams.customConfig
   */
  customConfig?: Parameter[]
  legacyProperties?: boolean
}

/**
 * Prefix each parameter id with given prefix
 */
export function prefixParameters(prefix: string, parameters: Parameter[]) {
  return parameters.map(p => {
    return {
      ...p,
      id: prefix + p.id,
    }
  })
}

/**
 * Customizes parameters for singer tap.
 */
export function customParameters(tap: string, params: ParametersCustomization) {
  return [
    ...(params.customConfig
      ? prefixParameters("config.", params.customConfig)
      : [singerConfigParams.customConfig(tap)]),
  ]
}

/**
 * Update Parameter.id field to make its pattern similar to destination Parameters
 * */
const fixConfigParamsPath = (params: Parameter[]) =>
  params.map((p: Parameter) => ({
    ...p,
    id: `config.${p.id}`,
  }))

/**
 * Not a common Source connector.
 */
export const makeSingerSource = (singerTap: SingerTap): SourceConnector => {
  return {
    protoType: "singer",
    expertMode: !singerTap.parameters,
    pic: singerTap.pic,
    displayName: singerTap.displayName,
    id: `singer-${singerTap.tap}` as const,
    collectionTypes: [],
    documentation: singerTap.documentation,
    collectionParameters: [],
    deprecated: singerTap.deprecated,
    configParameters: [
      {
        displayName: "Singer Tap",
        id: "config.tap",
        type: stringType,
        required: true,
        documentation: <>Id of Singer Tap</>,
        constant: singerTap.tap,
      },
      ...fixConfigParamsPath(singerTap.parameters ?? [singerConfigParams.configJson(singerTap.tap)]),
    ],
  }
}
