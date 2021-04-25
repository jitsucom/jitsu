const MAPPING_NAMES: Record<MappingAction, string> = {
  erase: 'Remove field',
  'cast/int': 'Cast to INT',
  'cast/double': 'Cast to DOUBLE',
  'cast/date': 'Cast to DATE',
  move: 'Move field'
};

const MAPPINGS_REFERENCE_MAP = {
  facebook: 'facebookPixel',
  google_analytics: 'googleAnalytics',
  segment: 'segment'
};

export { MAPPING_NAMES, MAPPINGS_REFERENCE_MAP };
