declare type MappingAction = 'erase' | 'cast/int' | 'cast/double' | 'cast/date' | 'move' | 'constant';

declare interface MappingRow {
  _srcField: string;
  _dstField: string;
  _action: MappingAction;
}

declare interface Mapping {
  _mapping: MappingRow[];
  _keepUnmappedFields: boolean;
}
