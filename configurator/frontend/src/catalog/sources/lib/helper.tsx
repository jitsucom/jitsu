import { hiddenValue } from 'catalog/destinations/lib/common';
import { snakeCaseToWords, toTitleCase } from 'utils/strings';
import {
  assertIsArray,
  assertIsArrayOfTypes,
  assertIsObject
} from 'utils/typeCheck';
import {
  SingerTap,
  jsonType,
  Parameter,
  SourceConnector,
  stringType,
  AirbyteSource,
  makeStringType,
  passwordType,
  makeIntType,
  booleanType,
  singleSelectionType,
  ConstantOrFunction
} from '../types';

export const singerConfigParams: Record<string, (tap: string) => Parameter> = {
  catalogJson: (tap: string): Parameter => {
    return {
      displayName: 'Singer Catalog JSON',
      id: 'catalog',
      type: jsonType,
      required: true,
      documentation: (
        <>
          Singer{' '}
          <a href="https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#catalog">
            catalog
          </a>{' '}
          that defines data layout.{' '}
          <a href={`https://github.com/singer-io/${tap}`}>
            Read catalog documentation for {tap}
          </a>
        </>
      ),
      defaultValue: {}
    };
  },
  stateJson: (tap: string): Parameter => {
    return {
      displayName: 'Singer Initial State JSON',
      id: 'state',
      type: jsonType,
      documentation: (
        <>
          Singer initial{' '}
          <a href="https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#state">
            state
          </a>
          . For most cases should be empty
          <a href={`https://github.com/singer-io/${tap}`}>
            Read documentation for {tap}
          </a>
        </>
      ),
      defaultValue: {}
    };
  },
  propertiesJson: (tap: string): Parameter => {
    return {
      displayName: 'Singer Properties JSON',
      id: 'properties',
      type: jsonType,
      documentation: (
        <>
          Singer properties that defines resulting schema.{' '}
          <a href={`https://github.com/singer-io/${tap}`}>
            Read documentation for {tap}
          </a>
        </>
      ),
      defaultValue: {}
    };
  },
  configJson: (tap: string): Parameter => {
    return {
      displayName: 'Singer Config JSON',
      id: 'config',
      type: jsonType,
      required: true,
      documentation: (
        <>
          Singer{' '}
          <a
            href={
              'https://github.com/singer-io/getting-started/blob/master/docs/SPEC.md#state'
            }
          >
            configuration
          </a>
          .{' '}
          <a href={`https://github.com/singer-io/${tap}`}>
            Read documentation for {tap}
          </a>
        </>
      ),
      defaultValue: {}
    };
  }
};

export type ParametersCustomization = {
  /**
   * Replacement for singerConfigParams.customConfig
   */
  customConfig?: Parameter[];
  legacyProperties?: boolean;
};

/**
 * Prefix each parameter id with given prefix
 */
export function prefixParameters(prefix: string, parameters: Parameter[]) {
  return parameters.map((p) => {
    return {
      ...p,
      id: prefix + p.id
    };
  });
}

/**
 * Customizes parameters for singer tap.
 */
export function customParameters(tap: string, params: ParametersCustomization) {
  return [
    ...(params.customConfig
      ? prefixParameters('config.', params.customConfig)
      : [singerConfigParams.customConfig(tap)])
  ];
}

/**
 * Update Parameter.id field to make its pattern similar to destination Parameters
 * */
const fixConfigParamsPath = (params: Parameter[]) =>
  params.map((p: Parameter) => ({
    ...p,
    id: `config.${p.id}`
  }));

/**
 * Not a common Source connector.
 */
export const makeSingerSource = (singerTap: SingerTap): SourceConnector => {
  return {
    isSingerType: true,
    expertMode: !singerTap.parameters,
    pic: singerTap.pic,
    displayName: singerTap.displayName,
    id: `singer-${singerTap.tap}` as const,
    collectionTypes: [],
    documentation: singerTap.documentation,
    collectionParameters: [],
    configParameters: [
      {
        displayName: 'Singer Tap',
        id: 'config.tap',
        type: stringType,
        required: true,
        documentation: <>Id of Singer Tap</>,
        constant: singerTap.tap
      },
      ...fixConfigParamsPath(
        singerTap.parameters ?? [singerConfigParams.configJson(singerTap.tap)]
      )
    ]
  };
};

export const makeAirbyteSource = (
  airbyteSource: AirbyteSource
): SourceConnector => {
  return {
    isSingerType: false,
    expertMode: false,
    pic: airbyteSource.pic,
    displayName: airbyteSource.displayName,
    id: `airbyte-source-${airbyteSource.docker_image_name.replace(
      'airbyte/source-',
      ''
    )}` as const,
    collectionTypes: [],
    documentation: airbyteSource.documentation,
    collectionParameters: [],
    configParameters: [
      {
        displayName: 'Airbyte Connector',
        id: 'config.airbyte',
        type: stringType,
        required: true,
        documentation: <>Id of Connector Source</>,
        constant: airbyteSource.docker_image_name
      }
    ],
    hasLoadableParameters: true
  };
};

/**
 * Maps the spec of the Airbyte connector to the Jitsu `Parameter` schema of the `SourceConnector`.
 * @param specNode `connectionSpecification` field which is the root node of the airbyte source spec.
 */
export const mapAirbyteSpecToSourceConnectorConfig = function mapAirbyteNode(
  specNode: unknown,
  sourceName: string,
  nodeName?: string,
  requiredFields?: string[],
  parentNodeName?: string,
  constant?: ConstantOrFunction<any, any>
): Parameter[] {
  const result: Parameter[] = [];
  switch (specNode['type']) {
    case 'string':
      const fieldType = specNode['airbyte_secret']
        ? passwordType
        : specNode['enum']
        ? singleSelectionType(specNode['enum'])
        : makeStringType(specNode['pattern']);
      const mappedStringField: Parameter = {
        displayName: specNode['title']
          ? toTitleCase(specNode['title'])
          : toTitleCase(snakeCaseToWords(nodeName)),
        id: `airbyte-${sourceName}-${nodeName}`,
        type: fieldType,
        required: requiredFields.includes(nodeName),
        documentation: specNode['description']
      };
      if (specNode['default'] !== undefined)
        mappedStringField.defaultValue = specNode['default'];
      if (constant) mappedStringField.constant = constant;
      return [mappedStringField];

    case 'integer':
      const mappedIntegerField: Parameter = {
        displayName: specNode['title']
          ? toTitleCase(specNode['title'])
          : toTitleCase(snakeCaseToWords(nodeName)),
        id: `airbyte-${sourceName}-${nodeName}`,
        type: makeIntType({
          minimum: specNode['minimum'],
          maximum: specNode['maximum']
        }),
        required: requiredFields.includes(nodeName),
        documentation: specNode['description']
      };
      if (specNode['default'] !== undefined)
        mappedIntegerField.defaultValue = specNode['default'];
      if (constant) mappedIntegerField.constant = constant;
      return [mappedIntegerField];

    case 'boolean':
      const mappedBooleanField: Parameter = {
        displayName: specNode['title']
          ? toTitleCase(specNode['title'])
          : toTitleCase(snakeCaseToWords(nodeName)),
        id: `airbyte-${sourceName}-${nodeName}`,
        type: booleanType,
        required: requiredFields.includes(nodeName),
        documentation: specNode['description']
      };
      if (specNode['default'] !== undefined)
        mappedBooleanField.defaultValue = specNode['default'];
      if (constant) mappedBooleanField.constant = constant;
      return [mappedBooleanField];

    case 'object':
      let optionsEntries: [string, unknown][];
      let listOfRequiredFields: string[] = [];

      if (specNode['properties']) {
        optionsEntries = getEntriesFromPropertiesField(specNode);
        const _listOfRequiredFields: unknown = specNode['required'] || [];
        assertIsArrayOfTypes(_listOfRequiredFields, 'string');
        listOfRequiredFields = _listOfRequiredFields;
      } else if (specNode['oneOf']) {
        optionsEntries = getEntriesFromOneOfField(specNode, nodeName);
        const options = optionsEntries.map(([_, node]) => node['title']);
        const mappedSelectionField: Parameter = {
          displayName: specNode['title']
            ? toTitleCase(specNode['title'])
            : toTitleCase(snakeCaseToWords(nodeName)),
          id: `airbyte-${sourceName}-${nodeName}`,
          type: singleSelectionType(options),
          required: requiredFields.includes(nodeName),
          documentation: specNode['description']
        };
        if (specNode['default'] !== undefined) {
          mappedSelectionField.defaultValue = specNode['default'];
        } else {
          mappedSelectionField.defaultValue = options[0];
        }
        result.push(mappedSelectionField);
      } else {
        throw new Error(
          'Failed to parse Airbyte source spec -- unknown field of `object` type'
        );
      }
      optionsEntries.forEach(([nodeName, node]) =>
        result.push(
          ...mapAirbyteNode(
            node,
            sourceName,
            nodeName,
            listOfRequiredFields,
            nodeName
          )
        )
      );
      break;

    case undefined: // Special case for the nodes from the `oneOf` list in the `object` node
      const childrenNodesEntries: unknown = Object.entries(
        specNode['properties']
      ).slice(1); // Ecludes the first entry as it is a duplicate definition of the parent node
      const _listOfRequiredFields: unknown = specNode['required'] || [];
      assertIsArray(childrenNodesEntries);
      assertIsArrayOfTypes(_listOfRequiredFields, 'string');
      childrenNodesEntries.forEach(([nodeName, node]) =>
        result.push(
          ...mapAirbyteNode(
            node,
            sourceName,
            nodeName,
            _listOfRequiredFields,
            '',
            hiddenValue(
              '',
              (config) =>
                config?.['_formData']?.[parentNodeName] !== node['title']
            )
          ) // add a constant!
        )
      );
      break;
  }
  return result;
};

const getEntriesFromPropertiesField = (node: unknown): [string, unknown][] => {
  const subNodes = node['properties'] as unknown;
  assertIsObject(subNodes);
  return Object.entries(subNodes);
};

const getEntriesFromOneOfField = (
  node: unknown,
  nodeName: string
): [string, object][] => {
  const subNodes = node['oneOf'] as unknown;

  // array assertion must fail here
  assertIsArrayOfTypes(subNodes, new Object());

  return Object.entries(subNodes).map(([idx, subNode]) => [
    `${nodeName}-option-${idx}`,
    subNode
  ]);
};
