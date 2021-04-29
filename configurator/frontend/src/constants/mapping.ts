const MAPPING_NAMES: Record<MappingAction, string> = {
  remove: 'Remove field',
  cast: 'Cast field',
  move: 'Move field',
  constant: 'Constant field'
};

const MAPPINGS_REFERENCE_MAP = {
  facebook: 'facebookPixel',
  google_analytics: 'googleAnalytics',
  segment: 'segment'
};

export { MAPPING_NAMES, MAPPINGS_REFERENCE_MAP };
