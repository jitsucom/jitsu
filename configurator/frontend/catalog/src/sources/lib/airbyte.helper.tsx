import {
  AirbyteSource,
  arrayOf,
  booleanType,
  makeIntType,
  makeStringType,
  oauthSecretType,
  Parameter,
  passwordType,
  singleSelectionType,
  SourceConnector,
  stringType,
} from "../types"

export const makeAirbyteSource = (airbyteSource: AirbyteSource): SourceConnector => {
  const dockerImageNameWithoutPrefix = airbyteSource.docker_image_name.replace("airbyte/", "") as `source-${string}`
  return {
    protoType: "airbyte",
    expertMode: false,
    pic: airbyteSource.pic,
    displayName: airbyteSource.displayName,
    id: `airbyte-${dockerImageNameWithoutPrefix}` as const,
    collectionTypes: [],
    documentation: airbyteSource.documentation,
    deprecated: airbyteSource.deprecated,
    collectionParameters: [],
    staticStreamsConfigEndpoint: `/airbyte/${dockerImageNameWithoutPrefix}/catalog`,
    configParameters: [
      {
        displayName: "Airbyte Connector",
        id: "config.docker_image",
        type: stringType,
        required: true,
        documentation: <>Id of Connector Source</>,
        constant: dockerImageNameWithoutPrefix,
      },
    ],
    hasLoadableConfigParameters: true,
  }
}

/**
 * Airbyte Sources Specification Mapping
 */

type EnrichedAirbyteSpecNode = {
  id: string
  parentNode?: EnrichedAirbyteSpecNode
}

type AirbyteSpecNodeMappingParameters = {
  nodeName?: string
  requiredFields?: string[]
  parentNode?: EnrichedAirbyteSpecNode
  setChildrenParameters?: Partial<Parameter>
  omitFieldRule?: (config: unknown) => boolean
}

/**
 * Maps the spec of the Airbyte connector to the Jitsu `Parameter` schema of the `SourceConnector`.
 * @param spec `connectionSpecification` field which is the root of the airbyte source spec.
 */
export const mapAirbyteSpecToSourceConnectorConfig = (spec: unknown): Parameter[] => {
  return mapAirbyteSpecNode(spec, {
    nodeName: "config",
    parentNode: { id: "config" },
  })
}

const mapAirbyteSpecNode = function mapSpecNode(
  specNode: any,
  options?: AirbyteSpecNodeMappingParameters
): Parameter[] {
  const result: Parameter[] = []

  const { nodeName, parentNode, requiredFields, setChildrenParameters, omitFieldRule } = options || {}

  const id = `${parentNode.id}.${nodeName}`
  const displayName = specNode["title"] ?? nodeName
  const required = !!requiredFields?.includes(nodeName || "")
  const description = specNode["description"]
  const documentation = specNode["description"] ? (
    <span dangerouslySetInnerHTML={{ __html: specNode["description"] }} />
  ) : undefined

  switch (specNode["type"]) {
    case "array":
      return [
        {
          displayName,
          id,
          type: arrayOf({ typeName: specNode["items"]?.type ?? "string" }),
          required,
          documentation,
          omitFieldRule,
          ...setChildrenParameters,
        },
      ]

    case "string": {
      const pattern = specNode["pattern"]
      const now = new Date()
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

      let defaultValue = undefined
      if (specNode["default"] !== undefined) {
        defaultValue = specNode["default"]
      } else if (
        pattern === "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$" ||
        description?.includes("YYYY-MM-DDT00:00:00Z")
      ) {
        // defaultValue = moment().add(-1, "months").startOf("month").format("YYYY-MM-DDT00:00:00") + "Z"
        defaultValue = startOfPrevMonth.toISOString().split(".")[0] + "Z"
      } else if (
        pattern === "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}.[0-9]{3}Z$" ||
        description?.includes("YYYY-MM-DDT00:00:00.000Z")
      ) {
        defaultValue = startOfPrevMonth.toISOString()
      } else if (pattern === "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" || /YYYY-MM-DD[^T]/.test(description)) {
        // defaultValue = moment().add(-1, "months").startOf("month").format("YYYY-MM-DD")
        defaultValue = startOfPrevMonth.toISOString().split("T")[0]
      }

      const isMultiline = !!specNode["multiline"]
      const isSecret = !!specNode["airbyte_secret"]
      const isSelection = !!specNode["enum"]
      const isBackendStoredOauth = !!specNode["env_name"]
      const fieldType = isBackendStoredOauth
        ? oauthSecretType
        : isMultiline
        ? makeStringType({ multiline: true })
        : isSecret
        ? passwordType
        : isSelection
        ? singleSelectionType(specNode["enum"])
        : makeStringType(pattern ? { pattern } : {})
      const mappedStringField: Parameter = {
        displayName,
        id,
        type: fieldType,
        required,
        documentation,
        omitFieldRule,
        ...setChildrenParameters,
      }
      if (defaultValue) {
        mappedStringField.defaultValue = defaultValue
      } else {
        mappedStringField.defaultValue = null
      }
      return [mappedStringField]
    }

    case "integer": {
      const mappedIntegerField: Parameter = {
        displayName,
        id,
        type: makeIntType({
          minimum: specNode["minimum"],
          maximum: specNode["maximum"],
        }),
        required,
        documentation,
        omitFieldRule,
      }
      if (specNode["default"] !== undefined) mappedIntegerField.defaultValue = specNode["default"]
      return [mappedIntegerField]
    }

    case "boolean": {
      const mappedBooleanField: Parameter = {
        displayName,
        id,
        type: booleanType,
        required,
        documentation,
        omitFieldRule,
      }
      if (specNode["default"] !== undefined) mappedBooleanField.defaultValue = specNode["default"]
      return [mappedBooleanField]
    }

    case "object": {
      let optionsEntries: [string, unknown][] = []
      let listOfRequiredFields: string[] = []

      if (specNode["properties"]) {
        optionsEntries = getEntriesFromPropertiesField(specNode)
        const _listOfRequiredFields: string[] = specNode["required"] || []
        listOfRequiredFields = _listOfRequiredFields
      } else if (specNode["oneOf"]) {
        // this is a rare case, see the Postgres source spec for an example
        const name = specNode["title"] ?? nodeName
        optionsEntries = getEntriesFromOneOfField(specNode, nodeName)
        const [optionsFieldName] = Object.entries(optionsEntries[0][1]["properties"]).find(([fieldName, fieldNode]) => {
          return !!fieldNode["const"] || fieldNode["enum"]?.length == 1
        })

        const options = optionsEntries.map(
          ([_, childNode]) =>
            childNode["properties"]?.[optionsFieldName]?.["const"] ||
            childNode["properties"]?.[optionsFieldName]?.["enum"][0]
        )
        const defaultAuthOption = options.find(option => option.toLowerCase?.().includes("oauth"))
        const defaultOption = defaultAuthOption ?? options[0]
        const mappedSelectionField: Parameter = {
          displayName: name,
          id: `${parentNode.id}.${nodeName}.${optionsFieldName}`,
          type: singleSelectionType(options),
          defaultValue: defaultOption,
          required,
          documentation,
          omitFieldRule,
        }

        mappedSelectionField.defaultValue = specNode?.["default"] || options[0]
        result.push(mappedSelectionField)
      } else {
        throw new Error("Failed to parse Airbyte source spec -- unknown field of `object` type")
      }

      const parentId = id
      optionsEntries.forEach(([nodeName, node]) =>
        result.push(
          ...mapSpecNode(node, {
            nodeName,
            requiredFields: listOfRequiredFields,
            parentNode: {
              ...specNode,
              id: parentId,
              parentNode,
            },
          })
        )
      )
      break
    }
    case undefined: {
      if (specNode["allOf"]) {
        // Case for the nodes that have the 'allOf' property
        const nodes = specNode["allOf"]
        nodes.forEach(node => {
          result.push(
            ...mapSpecNode(node, {
              nodeName,
              requiredFields,
              parentNode: {
                ...node,
                id: parentNode.id,
                parentNode,
              },
              setChildrenParameters: {
                documentation,
                required,
              },
            })
          )
        })
      } else if (specNode["$ref"]) {
        const refNode = getAirbyteSpecNodeByRef(parentNode, specNode["$ref"])
        result.push(
          ...mapSpecNode(refNode, {
            nodeName,
            parentNode,
            setChildrenParameters,
          })
        )
      } else if (isSubNodeOf_oneOf(specNode)) {
        // Special case for the nodes from the `oneOf` list in the `object` node
        const childrenNodesEntries = Object.entries(specNode["properties"]).sort(
          ([_, nodeA], [__, nodeB]) => nodeA?.["order"] - nodeB?.["order"]
        )

        const [parentNodeValueProperty, selectValueNode] = childrenNodesEntries.find(
          ([_, node]) => !!node["const"] || node["enum"]?.length == 1
        )
        const parentNodeValueKey = `${parentNode.id}.${parentNodeValueProperty}`
        const _listOfRequiredFields: string[] = specNode["required"] || []
        childrenNodesEntries
          .filter(([_, node]) => !node["const"] && node["enum"]?.length != 1) // Excludes the entry with the select option value
          .forEach(([nodeName, node]) =>
            result.push(
              ...mapSpecNode(node, {
                nodeName,
                requiredFields: _listOfRequiredFields,
                parentNode: { ...specNode, id: parentNode.id, parentNode },
                omitFieldRule: config => {
                  const parentSelectionNodeValue = parentNodeValueKey
                    .split(".")
                    .reduce((obj, key) => obj[key] || {}, config)
                  const showChildFieldIfThisParentValueSelected =
                    selectValueNode?.["const"] || selectValueNode?.["enum"]?.[0]
                  return parentSelectionNodeValue !== showChildFieldIfThisParentValueSelected
                },
              })
            )
          )
      }
      break
    }
  }
  return result
}

const getAirbyteSpecNodeByRef = (parentNode: EnrichedAirbyteSpecNode, ref: string) => {
  const rootNode = getAirbyteSpecRootNode(parentNode)
  const nodesNames = ref.replace("#/", "").split("/")

  return nodesNames.reduce((parentNode, childNodeName) => {
    if (parentNode === null) return null
    const childNode = parentNode[childNodeName]
    try {
      return childNode
    } catch {
      return null
    }
  }, rootNode)
}

const getAirbyteSpecRootNode = (node: EnrichedAirbyteSpecNode): EnrichedAirbyteSpecNode => {
  const grandparent = node?.parentNode?.parentNode
  if (!grandparent) return node

  return getAirbyteSpecRootNode(node.parentNode)
}

const getEntriesFromPropertiesField = (node: unknown): [string, unknown][] => {
  const subNodes = node["properties"] as unknown
  let entries = Object.entries(subNodes) as [string, unknown][]
  const isOrdered = entries[0][1]?.["order"]
  if (isOrdered) entries = entries.sort((a, b) => +a[1]?.["order"] - +b[1]?.["order"])
  return entries
}

const getEntriesFromOneOfField = (node: unknown, nodeName: string): [string, object][] => {
  const subNodes = node["oneOf"] as unknown

  return Object.entries(subNodes).map(([idx, subNode]) => {
    /**
     * Set subNode type to undefined so that the algorithm further
     * recognise the node as the `oneOf` node. Refer to `isSubNodeOf_oneOf` for implementation.
     */
    const newSubNode = { ...subNode, type: undefined }
    return [`${nodeName}-option-${idx}`, newSubNode]
  })
}

const isSubNodeOf_oneOf = (node: any): boolean => node.type === undefined
