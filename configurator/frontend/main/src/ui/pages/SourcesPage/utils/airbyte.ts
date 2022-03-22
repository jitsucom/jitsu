import { naturalComparatorBy } from "utils/object"

/**
 *
 * Funtions to flatten Airbyte stream json schema
 *
 */

/**
 * Field extracted from a JSON schema of a stream
 */
type SyncSchemaField = {
  cleanedName: string
  type: string
  key: string
  path: string[]
  fields?: SyncSchemaField[]
}

export const getStreamFieldPaths = (stream: AirbyteStreamData): string[][] => {
  return flattenStreamFields(stream.stream).map(field => field.path)
}

const flattenStreamFields = (stream: AirbyteStreamData["stream"]): SyncSchemaField[] => {
  const fields = traverseSchemaToField(stream.json_schema, stream.name).sort(
    naturalComparatorBy(field => field.cleanedName)
  )
  return flattenFields(fields)
}

const flattenFields = (fArr: SyncSchemaField[], arr: SyncSchemaField[] = []): SyncSchemaField[] =>
  fArr.reduce<SyncSchemaField[]>((acc, f) => {
    acc.push(f)

    if (f.fields?.length) {
      return flattenFields(f.fields, acc)
    }
    return acc
  }, arr)

const traverseSchemaToField = (jsonSchema: any, key: string): SyncSchemaField[] => {
  // For the top level we should not insert an extra object
  return traverseJsonSchemaProperties(jsonSchema, key)[0].fields ?? []
}

const traverseJsonSchemaProperties = (jsonSchema: any, key: string, path: string[] = []): SyncSchemaField[] => {
  if (typeof jsonSchema === "boolean") {
    return []
  }

  let fields: SyncSchemaField[] | undefined
  if (jsonSchema.properties) {
    fields = Object.entries(jsonSchema.properties)
      .flatMap(([k, schema]) => traverseJsonSchemaProperties(schema, k, [...path, k]))
      .flat(2)
  }

  return [
    {
      cleanedName: key,
      path,
      key,
      fields,
      type:
        (Array.isArray(jsonSchema.type)
          ? jsonSchema.type.find(t => t !== "null") ?? jsonSchema.type[0]
          : jsonSchema.type) ?? "null",
    },
  ]
}
