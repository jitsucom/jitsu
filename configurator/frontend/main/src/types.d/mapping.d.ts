declare type MappingAction = "remove" | "cast" | "move" | "constant"

declare interface DestinationMappingRow {
  _action: MappingAction
  _srcField?: string
  _dstField?: string
  _columnType?: string
  _type?: string
  _value?: string
}

declare interface DestinationMapping {
  _mappings?: DestinationMappingRow[]
  _keepUnmappedFields: boolean
}
