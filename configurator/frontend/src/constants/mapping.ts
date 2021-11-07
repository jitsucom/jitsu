const MAPPING_NAMES: Record<MappingAction, string> = {
  remove: "Remove field",
  cast: "Cast field",
  move: "Move field",
  constant: "Constant field",
}

const MAPPINGS_REFERENCE_MAP = {
  facebook: "facebookPixel",
  google_analytics: "googleAnalytics",
  segment: "segment",
}

const MAPPING_ROW_PROPS_MAP = {
  _action: "action",
  _srcField: "src",
  _dstField: "dst",
  _columnType: "type",
  _type: "type",
  _value: "value",
}

export { MAPPING_NAMES, MAPPINGS_REFERENCE_MAP, MAPPING_ROW_PROPS_MAP }
